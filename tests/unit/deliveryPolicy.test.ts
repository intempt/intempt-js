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

  it.each([500, 502, 504, 400, 401, 404, 408, 300, 199])(
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

  it('a dropped report carries neither status nor retryAfter', async () => {
    responses.push({ httpStatusCode: 504, error: 'timeout', retryAfter: '5' });
    await batcher.enqueue(event('e1'));
    await batcher.flush();

    expect(failures).toHaveLength(1);
    expect(failures[0]).toStrictEqual({
      kind: 'dropped',
      eventCount: 1,
      eventIds: ['e1'],
      terminal: true,
    });
  });

  it('counts every eventId of an item in eventCount', async () => {
    responses.push({ httpStatusCode: 500, ok: false });
    await batcher.enqueue({
      name: 'Two',
      payload: [{ eventId: 'a' }, { eventId: 'b' }],
    });
    await batcher.flush();

    expect(failures[0]).toMatchObject({ eventCount: 2, eventIds: ['a', 'b'] });
  });

  it('a flush exactly at the end of the Retry-After hold sends', async () => {
    responses.push({ httpStatusCode: 503, ok: false, retryAfter: '2' });
    // Date.now frozen first: the hold is computed from the response time.
    at(0);
    await batcher.enqueue(event('e1'));
    await batcher.flush();
    at(2_000);
    await batcher.flush();
    expect(sendCalls).toHaveLength(2);
  });

  it('a batch dropped after its one resend sets no new hold for the next event', async () => {
    responses.push(
      { httpStatusCode: 503, ok: false },
      { httpStatusCode: 503, ok: false },
    );
    await batcher.enqueue(event('e1'));
    await batcher.flush();
    at(1_100);
    await batcher.flush();
    await batcher.enqueue(event('e2'));
    at(1_200);
    await batcher.flush();

    expect(sendCalls).toHaveLength(3);
    expect(sentIds(2)).toEqual(['e2']);
  });

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

  it.each([true, false])(
    'the queue cap drops the oldest event not on the wire (persistence %s)',
    async (usePersistence) => {
      let release!: (r: any) => void;
      batcher = makeBatcher({
        libConfig: { maxQueuedEvents: 2 },
        usePersistence,
        sendRequestFunc: (data: any[]) => {
          sendCalls.push({ data });
          if (sendCalls.length > 1)
            return Promise.resolve({ httpStatusCode: 200, ok: true });
          return new Promise((r) => (release = r));
        },
      });
      await batcher.enqueue(event('e1'));
      const inFlight = batcher.flush();
      await vi.waitFor(() => expect(sendCalls).toHaveLength(1));
      await batcher.enqueue(event('e2'));
      await batcher.enqueue(event('e3'));
      release({ httpStatusCode: 200, ok: true });
      await inFlight;

      expect(failures).toEqual([
        { kind: 'dropped', eventCount: 1, eventIds: ['e2'], terminal: true },
      ]);
    },
  );

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

// Ro-bot mcp-1794565555-8 impact:F1 and R4 (ROBOT-R1-RULINGS.md): a flush that
// returns early during the Retry-After hold must leave a timer armed, or the
// flush loop stops for good.
describe('flush schedule during the Retry-After hold (R4)', () => {
  let sendCalls: Array<{ data: any[]; unloading?: boolean }>;
  let failures: DeliveryFailure[];

  function makeBatcher(
    send: (data: any[], unloading?: boolean) => Promise<any>,
  ) {
    return new RequestBatcher({
      storageKey: KEY,
      libConfig: {
        batchSize: 10,
        batchFlushIntervalMs: 1000,
        batchRequestTimeoutMs: 5000,
        batchAutostart: false,
      },
      sendRequestFunc: (data, options) => {
        sendCalls.push({ data, unloading: options.unloading });
        return send(data, options.unloading);
      },
      onDeliveryFailure: (f: DeliveryFailure) => failures.push(f),
      usePersistence: true,
      queueStorage: new QueueStorage(),
    });
  }

  const ids = (i: number) =>
    sendCalls[i].data.map((d: any) => d.payload[0].eventId);

  beforeEach(() => {
    localStorage.clear();
    sendCalls = [];
    failures = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stop() then start() during the hold still resends when the hold ends', async () => {
    const responses: any[] = [
      { httpStatusCode: 503, ok: false, retryAfter: '2' },
    ];
    const batcher = makeBatcher(async () =>
      responses.length ? responses.shift() : { httpStatusCode: 200, ok: true },
    );
    await batcher.start();
    await batcher.enqueue(event('e1'));
    await vi.advanceTimersByTimeAsync(1_200);
    expect(sendCalls).toHaveLength(1);

    batcher.stop();
    await batcher.start();
    await vi.advanceTimersByTimeAsync(2_100);

    expect(sendCalls).toHaveLength(2);
    expect(ids(1)).toEqual(['e1']);
    batcher.stop();
  });

  it('a regular flush that finishes during a hold set by an unload send re-arms the timer', async () => {
    let releaseFirst!: (r: any) => void;
    let call = 0;
    const batcher = makeBatcher((_data, unloading) => {
      call++;
      if (call === 1) return new Promise((r) => (releaseFirst = r));
      if (unloading)
        return Promise.resolve({
          httpStatusCode: 503,
          ok: false,
          retryAfter: '2',
        });
      return Promise.resolve({ httpStatusCode: 200, ok: true });
    });
    await batcher.start();
    await batcher.enqueue(event('e1'));
    await vi.advanceTimersByTimeAsync(1_200);
    expect(sendCalls).toHaveLength(1);

    await batcher.enqueue(event('e2'));
    await batcher.flush({ unloading: true });
    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[1].unloading).toBe(true);

    releaseFirst({ httpStatusCode: 200, ok: true });
    await vi.advanceTimersByTimeAsync(2_100);

    expect(sendCalls).toHaveLength(3);
    expect(ids(2)).toEqual(['e2']);
    batcher.stop();
  });

  it('the flush loop keeps running after a batch is dropped on its resend', async () => {
    const responses: any[] = [
      { httpStatusCode: 503, ok: false, retryAfter: '1' },
      { httpStatusCode: 503, ok: false, retryAfter: '1' },
    ];
    const batcher = makeBatcher(async () =>
      responses.length ? responses.shift() : { httpStatusCode: 200, ok: true },
    );
    await batcher.start();
    await batcher.enqueue(event('e1'));
    await vi.advanceTimersByTimeAsync(1_200);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(sendCalls).toHaveLength(2);

    await batcher.enqueue(event('e2'));
    await vi.advanceTimersByTimeAsync(1_200);
    expect(sendCalls).toHaveLength(3);
    expect(ids(2)).toEqual(['e2']);
    batcher.stop();
  });

  it('a newcomer joining a kept batch does not re-report the kept events', async () => {
    const batcher = makeBatcher(async () => null);
    await batcher.enqueue(event('e1'));
    await batcher.flush();
    await batcher.enqueue(event('e2'));
    await batcher.flush();
    await batcher.flush();

    expect(failures).toEqual([
      { kind: 'transport', eventCount: 1, eventIds: ['e1'], terminal: false },
      { kind: 'transport', eventCount: 1, eventIds: ['e2'], terminal: false },
    ]);
  });
});
