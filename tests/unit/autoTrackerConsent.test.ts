import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoTrackerConsent } from '../../src/intemptJs/modules/autoTracker/autoTracker.consent.ts';
import { IntemptConfig } from '../../src/intemptJs/types/intemptJs.types.ts';
import { DeliveryFailure } from '../../src/shared/queue/requestBatcher.ts';
import {
  DiagnosticRecord,
  configureLogger,
  resetLogger,
} from '../../src/shared/logger/logger.ts';

// Rulings R2 and R3 (ROBOT-R1-RULINGS.md, 2026-11-13): a consent failure is
// reported through onDeliveryFailure and logged at error level, never thrown and
// never silent; consent follows send-once (one 503/429 resend after Retry-After
// clamped to 1–60 s, every other answered status terminal, never-reached kept).

const API = 'https://api.example.com/v1';
const CONSENT_URL = `${API}/acme/projects/proj-1/consents/data`;

let fetchMock: ReturnType<typeof vi.fn>;
let failures: DeliveryFailure[];
let errors: DiagnosticRecord[];
const errorLogged = () => errors.length > 0;

function consent(config: Partial<IntemptConfig> = {}) {
  return new AutoTrackerConsent(
    {
      organization: 'acme',
      project: 'proj-1',
      sourceId: 'src-1',
      writeKey: 'user-part.password-part',
      shopify: false,
      magento: false,
      onDeliveryFailure: (f: DeliveryFailure) => failures.push(f),
      ...config,
    } as IntemptConfig,
    API,
  );
}

const answer = (status: number, retryAfter?: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h: string) => (h === 'Retry-After' ? retryAfter : null) },
});

const record = (action: string) => ({ type: 'consent', action, validUntil: 1 });
const sentActions = () =>
  fetchMock.mock.calls.map((c) => JSON.parse(c[1].body).action);

beforeEach(() => {
  vi.useFakeTimers();
  failures = [];
  fetchMock = vi.fn().mockResolvedValue(answer(200));
  vi.stubGlobal('fetch', fetchMock);
  errors = [];
  configureLogger({
    level: 'silent',
    sinkLevel: 'error',
    sink: (r) => void (r.level === 'error' && errors.push(r)),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetLogger();
});

describe('consent delivery (R2, R3)', () => {
  it('a 200 is sent once to the consent endpoint and reports nothing', async () => {
    await consent().sendConsentRecord(record('accept'));
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(CONSENT_URL);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    });
    expect(failures).toEqual([]);
  });

  it.each([400, 401, 403, 404, 408, 413, 500, 502, 504])(
    'a %i is sent once, dropped, reported terminal and logged at error level',
    async (status) => {
      fetchMock.mockResolvedValue(answer(status));
      await expect(
        consent().sendConsentRecord(record('reject')),
      ).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(failures).toEqual([
        {
          kind: 'terminal',
          status,
          eventCount: 1,
          eventIds: [],
          terminal: true,
        },
      ]);
      expect(errorLogged()).toBe(true);
    },
  );

  it('a 503 is resent once after Retry-After, then reported terminal once', async () => {
    fetchMock.mockResolvedValue(answer(503, '2'));
    await consent().sendConsentRecord(record('reject'));
    expect(failures).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(failures).toEqual([
      {
        kind: 'terminal',
        status: 503,
        eventCount: 1,
        eventIds: [],
        retryAfter: 2,
        terminal: true,
      },
    ]);
  });

  it('a 429 then a 200 delivers on the one resend with no report', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(429))
      .mockResolvedValueOnce(answer(200));
    await consent().sendConsentRecord(record('accept'));
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(failures).toEqual([]);
  });

  it('clamps Retry-After to 60 s', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(503, '120'))
      .mockResolvedValueOnce(answer(200));
    await consent().sendConsentRecord(record('accept'));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a record that never reached the server is kept, retried no sooner than the flush interval, and reported once', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(answer(200));
    await consent().sendConsentRecord(record('reject'));

    expect(failures).toEqual([
      { kind: 'transport', eventCount: 1, eventIds: [], terminal: false },
    ]);
    expect(errorLogged()).toBe(true);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentActions()).toEqual(['reject', 'reject', 'reject']);
    expect(failures).toHaveLength(1);
  });

  it('a new consent while a record is kept sends only itself', async () => {
    const c = consent();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await c.sendConsentRecord(record('reject'));
    await vi.advanceTimersByTimeAsync(1_000);
    await c.sendConsentRecord(record('accept'));

    expect(sentActions()).toEqual(['reject', 'accept']);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(sentActions()).toEqual(['reject', 'accept', 'reject']);
  });

  it('a kept record that is then answered with a drop status is reported terminal', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(answer(400));
    await consent().sendConsentRecord(record('reject'));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(failures.map((f) => f.kind)).toEqual(['transport', 'terminal']);
  });

  it('caps kept records and reports the oldest as dropped', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const c = consent();
    for (let i = 0; i < 101; i++) await c.sendConsentRecord(record('reject'));

    const dropped = failures.filter((f) => f.kind === 'dropped');
    expect(dropped).toEqual([
      { kind: 'dropped', eventCount: 1, eventIds: [], terminal: true },
    ]);
  });

  it('a listener that throws is caught; the call still resolves', async () => {
    fetchMock.mockResolvedValue(answer(400));
    const c = consent({
      onDeliveryFailure: () => {
        throw new Error('listener bug');
      },
    });
    await expect(
      c.sendConsentRecord(record('reject')),
    ).resolves.toBeUndefined();
  });

  it('without a listener a failure is still logged at error level', async () => {
    fetchMock.mockResolvedValue(answer(400));
    await consent({ onDeliveryFailure: undefined }).sendConsentRecord(
      record('reject'),
    );
    expect(errorLogged()).toBe(true);
  });

  it('a drop status without Retry-After carries no retryAfter key', async () => {
    fetchMock.mockResolvedValue(answer(400));
    await consent().sendConsentRecord(record('reject'));
    expect(failures[0]).not.toHaveProperty('retryAfter');
  });

  it('a response without headers is still reported, never rejected', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    await expect(
      consent().sendConsentRecord(record('reject')),
    ).resolves.toBeUndefined();
    expect(failures).toHaveLength(1);
  });

  it('records kept within one interval are all retried when the first timer fires', async () => {
    const c = consent();
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await c.sendConsentRecord(record('reject'));
    await vi.advanceTimersByTimeAsync(3_000);
    await c.sendConsentRecord(record('accept'));
    await vi.advanceTimersByTimeAsync(2_000);

    expect(sentActions()).toEqual(['reject', 'accept', 'reject', 'accept']);
  });

  it('a kept record answered 503 on its retry still gets its one resend', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(answer(503, '1'))
      .mockResolvedValueOnce(answer(200));
    await consent().sendConsentRecord(record('reject'));
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(failures.map((f) => f.kind)).toEqual(['transport']);
  });

  it('logs a listener that throws, and does not log one that is absent', async () => {
    fetchMock.mockResolvedValue(answer(400));
    await consent({
      onDeliveryFailure: () => {
        throw new Error('listener bug');
      },
    }).sendConsentRecord(record('reject'));
    expect(errors.some((r) => r.message.includes('listener threw'))).toBe(true);

    errors = [];
    await consent({ onDeliveryFailure: undefined }).sendConsentRecord(
      record('reject'),
    );
    expect(errors.some((r) => r.message.includes('listener threw'))).toBe(
      false,
    );
  });
});
