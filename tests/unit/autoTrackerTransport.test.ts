import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoTrackerTransport } from '../../src/intemptJs/modules/autoTracker/autoTracker.transport.ts';
import { IntemptConfig } from '../../src/intemptJs/types/intemptJs.types.ts';

/**
 * Exercises the `fetch(keepalive)` -> XHR fallback chain on
 * `AutoTrackerTransport['_sendBatchRequest']`. The method is private; these
 * tests reach it via a typed cast, which is the narrowest way to drive the
 * exact behaviour `RequestBatcher` depends on (a single `BatchSendResult`
 * per call, `httpStatusCode` used for its failure/recovery classification).
 */

type PrivateSend = (
  data: unknown[],
  options: { unloading?: boolean; keepalive?: boolean; timeout_ms?: number },
) => Promise<{
  httpStatusCode: number;
  ok?: boolean;
  retryAfter?: string;
  error?: string;
}>;

function makeTransport(
  overrides: Partial<IntemptConfig> = {},
): AutoTrackerTransport {
  const config: IntemptConfig = {
    organization: 'org',
    sourceId: 'src',
    project: 'proj',
    writeKey: 'user.pass',
    ...overrides,
  } as IntemptConfig;
  return new AutoTrackerTransport(config, 'https://api.example.com');
}

function send(
  transport: AutoTrackerTransport,
  options: Record<string, unknown> = {},
) {
  const fn = (transport as unknown as { _sendBatchRequest: PrivateSend })
    ._sendBatchRequest;
  return fn.call(transport, [{ eventId: 'e1' }], options);
}

class FakeXHR {
  static instances: FakeXHR[] = [];
  status = 0;
  timeout = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  private headers: Record<string, string> = {};
  sentBody: unknown = null;
  behavior: 'success' | 'error' | 'timeout' = 'success';
  responseStatus = 200;

  constructor() {
    FakeXHR.instances.push(this);
  }

  open(): void {}
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  getResponseHeader(): string | null {
    return null;
  }
  send(body: unknown): void {
    this.sentBody = body;
    queueMicrotask(() => {
      if (this.behavior === 'error') {
        this.onerror?.();
      } else if (this.behavior === 'timeout') {
        this.ontimeout?.();
      } else {
        this.status = this.responseStatus;
        this.onload?.();
      }
    });
  }
}

describe('AutoTrackerTransport fetch -> XHR fallback', () => {
  const originalFetch = globalThis.fetch;
  const originalXHR = globalThis.XMLHttpRequest;

  beforeEach(() => {
    FakeXHR.instances = [];
    (globalThis as any).XMLHttpRequest = FakeXHR;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).XMLHttpRequest = originalXHR;
    vi.restoreAllMocks();
  });

  it('uses fetch on success and never constructs an XHR', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200, headers: {} }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = makeTransport();
    const result = await send(transport);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.httpStatusCode).toBe(200);
    expect(result.ok).toBe(true);
    expect(FakeXHR.instances.length).toBe(0);
  });

  it('falls back to XHR when fetch rejects at the network layer, and XHR succeeding reports success', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = makeTransport();
    const resultPromise = send(transport);
    const result = await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeXHR.instances.length).toBe(1);
    expect(result.httpStatusCode).toBe(200);
    expect(result.ok).toBe(true);
  });

  it('reports a single delivery failure when both fetch and XHR fail, not two', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = makeTransport();
    // Make the XHR instance fail too.
    const origCtor = FakeXHR;
    (globalThis as any).XMLHttpRequest = class extends origCtor {
      constructor() {
        super();
        this.behavior = 'error';
      }
    };
    FakeXHR.instances = [];

    const result = await send(transport);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeXHR.instances.length).toBe(1);
    // Exactly one BatchSendResult surfaces to the batcher, and it is a
    // transport failure (httpStatusCode 0 / no ok), not an HTTP response.
    expect(result.httpStatusCode).toBe(0);
    expect(result.ok).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it('does not fall back to XHR on an HTTP 400 — the server already rejected the payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 400, headers: {} }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const transport = makeTransport();
    const result = await send(transport);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(FakeXHR.instances.length).toBe(0);
    expect(result.httpStatusCode).toBe(400);
    expect(result.ok).toBe(false);
  });
});

// The `?ip=` flag is written in two places -- the event pool and here. Only the pool
// copy was covered, so this one could have drifted or been dropped without a single
// test noticing, on the batch path that carries most production traffic.
describe('AutoTrackerTransport geolocation flag', () => {
  it('sends ?ip=0 when the customer has switched geolocation off', async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await send(makeTransport({ useIpAddressForGeolocation: false }));

    // Exact match, not .toContain: '?ip=0' would also pass for a stray '?ip=00'
    // or '?ip=01' -- toContain has no word boundary.
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\?ip=0$/);
  });

  it('sends ?ip=1 when the switch is absent, matching what ingestion assumes', async () => {
    // Absent must not read as an opt-out: the server treats a missing `?ip=` as
    // "derive location", so an unset switch and an unpatched server agree.
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response('{}', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await send(makeTransport());

    // Exact match, not .toContain: '?ip=1' would also pass for '?ip=10' etc.
    expect(String(fetchMock.mock.calls[0]![0])).toMatch(/\?ip=1$/);
  });
});
