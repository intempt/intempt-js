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

describe('AutoTrackerTransport unload sends (INT-5942)', () => {
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
    vi.useRealTimers();
  });

  /** A fetch whose request left: it fails later, from the network. */
  const failsInFlight = (error: unknown) =>
    vi.fn(
      () =>
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(error), 5),
        ),
    ) as unknown as typeof fetch;

  it('does not re-send by XHR after a keepalive fetch that was started and aborted', async () => {
    globalThis.fetch = failsInFlight(new DOMException('aborted', 'AbortError'));

    const result = await send(makeTransport(), {
      unloading: true,
      keepalive: true,
    });

    // The first request may have reached ingest; a second one would be a
    // duplicate. The batcher gets a failure and keeps the items queued.
    expect(FakeXHR.instances.length).toBe(0);
    expect(result).toEqual({ error: 'timeout', httpStatusCode: 0 });
  });

  it('does not re-send by XHR after a started keepalive fetch fails at the network layer', async () => {
    globalThis.fetch = failsInFlight(new TypeError('Failed to fetch'));

    const result = await send(makeTransport(), { unloading: true });

    expect(FakeXHR.instances.length).toBe(0);
    expect(result).toEqual({ error: 'network error', httpStatusCode: 0 });
  });

  it('falls back to XHR when the keepalive fetch is rejected before it is dispatched', async () => {
    // The browser's keepalive quota check rejects inside fetch(), before any
    // request leaves: the same task, so nothing can have reached ingest.
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new TypeError('keepalive quota exceeded'),
      ) as unknown as typeof fetch;

    const result = await send(makeTransport(), { unloading: true });

    expect(FakeXHR.instances.length).toBe(1);
    expect(result.httpStatusCode).toBe(200);
  });

  it('sends a body over the keepalive budget without keepalive instead of having it rejected', async () => {
    const fetchMock = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response('{}', { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const transport = makeTransport();
    const fn = (transport as unknown as { _sendBatchRequest: PrivateSend })
      ._sendBatchRequest;

    const big = [{ eventId: 'big', blob: 'x'.repeat(70 * 1024) }];
    await fn.call(transport, big, { unloading: true, keepalive: true });
    await fn.call(transport, [{ eventId: 'small' }], {
      unloading: true,
      keepalive: true,
    });

    expect(fetchMock.mock.calls[0]![1]!.keepalive).toBe(false);
    expect(fetchMock.mock.calls[1]![1]!.keepalive).toBe(true);
    expect(FakeXHR.instances.length).toBe(0);
  });

  it('counts keepalive bodies still in flight against the budget, and frees them after', async () => {
    const pending: Array<(r: Response) => void> = [];
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => pending.push(resolve)),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const transport = makeTransport();
    const fn = (transport as unknown as { _sendBatchRequest: PrivateSend })
      ._sendBatchRequest;
    const forty = [{ eventId: 'a', blob: 'x'.repeat(40 * 1024) }];

    const first = fn.call(transport, forty, { keepalive: true });
    const second = fn.call(transport, forty, { keepalive: true });
    expect(fetchMock.mock.calls[0]![1]!.keepalive).toBe(true);
    // 40 + 40 KiB in flight would exceed 64 KiB.
    expect(fetchMock.mock.calls[1]![1]!.keepalive).toBe(false);

    pending.forEach((resolve) => resolve(new Response('{}', { status: 200 })));
    await Promise.all([first, second]);
    void fn.call(transport, forty, { keepalive: true });
    expect(fetchMock.mock.calls[2]![1]!.keepalive).toBe(true);
  });

  it('clears the abort timer when the request rejects', async () => {
    vi.useFakeTimers();
    globalThis.fetch = failsInFlight(new TypeError('Failed to fetch'));
    const pendingSend = send(makeTransport(), { unloading: true });
    await vi.advanceTimersByTimeAsync(10);
    await pendingSend;

    expect(vi.getTimerCount()).toBe(0);
  });

  it('falls back to XHR when fetch throws before starting a request', async () => {
    globalThis.fetch = vi.fn(() => {
      throw new TypeError('keepalive not supported');
    }) as unknown as typeof fetch;

    const result = await send(makeTransport(), { unloading: true });

    expect(FakeXHR.instances.length).toBe(1);
    expect(result.httpStatusCode).toBe(200);
  });

  it('falls back to XHR when fetch is unavailable', async () => {
    (globalThis as any).fetch = undefined;

    const result = await send(makeTransport(), { unloading: true });

    expect(FakeXHR.instances.length).toBe(1);
    expect(result.httpStatusCode).toBe(200);
  });

  describe('unload triggers', () => {
    function withFakeBatcher() {
      const transport = makeTransport();
      const flush = vi.fn(() => Promise.resolve());
      const pageResumed = vi.fn();
      (transport as any)._requestBatcher = { flush, pageResumed };
      const fire = (name: string) => (transport as any)[name]();
      return { flush, pageResumed, fire };
    }
    function hide() {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'hidden',
      });
    }
    afterEach(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
    });

    it('a visibilitychange after pagehide is the same unload: one flush', () => {
      const { flush, fire } = withFakeBatcher();
      fire('_onPageHide');
      hide();
      fire('_onVisibilityChange');
      fire('_onBeforeUnload');
      fire('_onPageHide');

      expect(flush).toHaveBeenCalledTimes(1);
      expect(flush).toHaveBeenCalledWith({ unloading: true, terminal: true });
    });

    it('beforeunload then pagehide flush twice; the batcher sends only what is new', () => {
      const { flush, fire } = withFakeBatcher();
      fire('_onBeforeUnload');
      fire('_onPageHide');
      hide();
      fire('_onVisibilityChange');

      expect(flush).toHaveBeenCalledTimes(2);
    });

    it('a bfcache restore re-arms the triggers', () => {
      const { flush, fire } = withFakeBatcher();
      fire('_onPageHide');
      fire('_onPageShow');
      fire('_onPageHide');

      expect(flush).toHaveBeenCalledTimes(2);
    });

    it('a hidden tab is a live page; beforeunload and a non-bfcache pagehide are terminal', () => {
      const { flush, fire } = withFakeBatcher();
      hide();
      fire('_onVisibilityChange');
      fire('_onBeforeUnload');
      (fire as any)('_onPageHide');

      expect(flush.mock.calls).toEqual([
        [{ unloading: true, terminal: false }],
        [{ unloading: true, terminal: true }],
        [{ unloading: true, terminal: true }],
      ]);
    });

    it('a bfcache pagehide is not terminal', () => {
      const transport = makeTransport();
      const flush = vi.fn(() => Promise.resolve());
      (transport as any)._requestBatcher = { flush, pageResumed: vi.fn() };
      (transport as any)._onPageHide({ persisted: true });

      expect(flush).toHaveBeenCalledWith({ unloading: true, terminal: false });
    });

    it('the page coming back into view re-arms the triggers and ends the terminal state (frozen page, cancelled navigation)', () => {
      const { flush, pageResumed, fire } = withFakeBatcher();
      fire('_onPageHide');
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      fire('_onVisibilityChange');
      hide();
      fire('_onVisibilityChange');

      expect(pageResumed).toHaveBeenCalledTimes(1);
      expect(flush).toHaveBeenCalledTimes(2);
    });

    it('tab switches are not coalesced: each hidden tab flushes', () => {
      const { flush, fire } = withFakeBatcher();
      hide();
      fire('_onVisibilityChange');
      fire('_onVisibilityChange');

      expect(flush).toHaveBeenCalledTimes(2);
    });
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
