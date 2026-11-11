import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeliveryFailure,
  RequestBatcher,
} from '../../src/shared/queue/requestBatcher.ts';
import { QueueStorage } from '../../src/shared/storage/queueStorage.ts';

// INT-7436 (send once; 503/429 one resend after Retry-After; never-reached kept)
// and INT-7444 (one onDeliveryFailure per batch, on the final outcome).
// Contract: reports/plan2/CONTRACT-R2.md §S1, §S2.

const KEY = '__unit_delivery_policy__';

function event(eventId: string) {
  return {
    name: 'Test Event',
    payload: [{ eventId, sessionId: 's', profileId: 'p' }],
  };
}

describe('delivery policy (INT-7436, INT-7444)', () => {
  let sendCalls: Array<{ data: any[] }>;
  let responses: any[];
  let failures: DeliveryFailure[];
  let batcher: RequestBatcher;
  let t0: number;

  function makeBatcher(overrides: Record<string, any> = {}) {
    return new RequestBatcher({
      storageKey: KEY,
      libConfig: {
        batchSize: 10,
        batchFlushIntervalMs: 1000,
        batchRequestTimeoutMs: 5000,
        batchAutostart: false,
        ...(overrides.libConfig ?? {}),
      },
      sendRequestFunc: async (data) => {
        sendCalls.push({ data });
        return responses.length
          ? responses.shift()
          : { httpStatusCode: 200, ok: true };
      },
      onDeliveryFailure: (f: DeliveryFailure) => failures.push(f),
      usePersistence: true,
      queueStorage: new QueueStorage(),
      ...overrides,
    });
  }

  const sentIds = (i: number) =>
    sendCalls[i].data.map((d: any) => d.payload[0].eventId);
  const at = (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(t0 + ms);

  beforeEach(() => {
    localStorage.clear();
    sendCalls = [];
    responses = [];
    failures = [];
    t0 = Date.now();
    batcher = makeBatcher();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([500, 502, 504, 400, 401, 404, 408])(
    'a %i is sent once, dropped and reported as terminal',
    async (status) => {
      responses.push({ httpStatusCode: status, ok: false });
      await batcher.enqueue(event('e1'));
      await batcher.flush();
      await batcher.enqueue(event('e2'));
      await batcher.flush();

      expect(sendCalls).toHaveLength(2);
      expect(sentIds(1)).toEqual(['e2']);
      expect(failures).toEqual([
        {
          kind: 'terminal',
          status,
          eventCount: 1,
          eventIds: ['e1'],
          terminal: true,
        },
      ]);
    },
  );

  it('a 413 drops the whole batch in one attempt, no halving', async () => {
    responses.push({ httpStatusCode: 413, ok: false });
    for (const id of ['e1', 'e2', 'e3', 'e4']) await batcher.enqueue(event(id));
    await batcher.flush();
    await batcher.flush();

    expect(sendCalls).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      kind: 'terminal',
      status: 413,
      eventCount: 4,
      terminal: true,
    });
  });

  it('a timeout after the request was written is dropped, not resent', async () => {
    responses.push({ httpStatusCode: 0, error: 'timeout' });
    await batcher.enqueue(event('e1'));
    await batcher.flush();
    at(10_000);
    await batcher.flush();

    expect(sendCalls).toHaveLength(1);
    expect(failures).toEqual([
      {
        kind: 'dropped',
        eventCount: 1,
        eventIds: ['e1'],
        terminal: true,
      },
    ]);
  });

  it('a 503 is resent once after Retry-After, then dropped with ONE report', async () => {
    responses.push(
      { httpStatusCode: 503, ok: false, retryAfter: '2' },
      { httpStatusCode: 503, ok: false, retryAfter: '2' },
    );
    await batcher.enqueue(event('e1'));
    await batcher.flush();
    expect(failures).toHaveLength(0);

    at(1_500);
    await batcher.flush();
    expect(sendCalls).toHaveLength(1);

    at(2_100);
    await batcher.flush();
    expect(sendCalls).toHaveLength(2);
    expect(sentIds(1)).toEqual(['e1']);

    at(10_000);
    await batcher.flush();
    expect(sendCalls).toHaveLength(2);
    expect(failures).toEqual([
      {
        kind: 'terminal',
        status: 503,
        eventCount: 1,
        eventIds: ['e1'],
        retryAfter: 2,
        terminal: true,
      },
    ]);
  });

  it('a 429 then a 200 delivers on the one resend, with no report', async () => {
    responses.push({ httpStatusCode: 429, ok: false });
    await batcher.enqueue(event('e1'));
    await batcher.flush();
    at(999);
    await batcher.flush();
    expect(sendCalls).toHaveLength(1);
    at(1_001);
    await batcher.flush();

    expect(sendCalls).toHaveLength(2);
    expect(failures).toHaveLength(0);
    at(5_000);
    await batcher.flush();
    expect(sendCalls).toHaveLength(2);
  });

  it('clamps Retry-After to 60 s', async () => {
    responses.push({ httpStatusCode: 503, ok: false, retryAfter: '120' });
    await batcher.enqueue(event('e1'));
    await batcher.flush();
    at(59_000);
    await batcher.flush();
    expect(sendCalls).toHaveLength(1);
    at(60_100);
    await batcher.flush();
    expect(sendCalls).toHaveLength(2);
  });

  it('a newcomer that joins a 503ed batch still gets its own resend', async () => {
    responses.push(
      { httpStatusCode: 503, ok: false },
      { httpStatusCode: 503, ok: false },
    );
    await batcher.enqueue(event('e1'));
    await batcher.flush();
    await batcher.enqueue(event('e2'));
    at(1_100);
    await batcher.flush();
    at(2_200);
    await batcher.flush();

    expect(sendCalls).toHaveLength(3);
    expect(sentIds(1)).toEqual(['e1', 'e2']);
    expect(sentIds(2)).toEqual(['e2']);
    expect(failures).toHaveLength(1);
    expect(failures[0].eventIds).toEqual(['e1']);
  });

  it('a batch that never reached the server is kept, and reported once as transport', async () => {
    responses.push(null, null, { httpStatusCode: 0, error: 'network error' });
    await batcher.enqueue(event('e1'));
    await batcher.flush();
    await batcher.flush();
    await batcher.flush();
    await batcher.flush();

    expect(sendCalls).toHaveLength(4);
    expect(sentIds(3)).toEqual(['e1']);
    expect(failures).toEqual([
      {
        kind: 'transport',
        eventCount: 1,
        eventIds: ['e1'],
        terminal: false,
      },
    ]);
  });

  it('has no circuit breaker: consecutive failures never stop sending', async () => {
    for (let i = 0; i < 7; i++) {
      responses.push({ httpStatusCode: 500, ok: false });
      await batcher.enqueue(event(`e${i}`));
      await batcher.flush();
    }
    expect(sendCalls).toHaveLength(7);
    expect(failures).toHaveLength(7);
  });

  it('a listener that throws is caught and does not break delivery', async () => {
    batcher = makeBatcher({
      onDeliveryFailure: () => {
        throw new Error('listener bug');
      },
    });
    responses.push({ httpStatusCode: 500, ok: false });
    await batcher.enqueue(event('e1'));
    await expect(batcher.flush()).resolves.toBeUndefined();
    await batcher.enqueue(event('e2'));
    await batcher.flush();
    expect(sendCalls).toHaveLength(2);
  });

  it('reports a queue-cap overflow as dropped', async () => {
    batcher = makeBatcher({ libConfig: { maxQueuedEvents: 2 } });
    await batcher.enqueue(event('e1'));
    await batcher.enqueue(event('e2'));
    await batcher.enqueue(event('e3'));

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      kind: 'dropped',
      eventCount: 1,
      terminal: true,
    });
  });
});
