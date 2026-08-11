import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestBatcher } from '../../src/shared/queue/requestBatcher.ts';
import { QueueStorage } from '../../src/shared/storage/queueStorage.ts';

const KEY = '__unit_batcher__';
const SENT_IDS_KEY = `${KEY}_sent_event_ids`;

/** Payload shape the batcher's extractEventIds() understands. */
function event(eventId: string) {
  return { name: 'Test Event', payload: [{ eventId, sessionId: 's', profileId: 'p' }] };
}

describe('RequestBatcher', () => {
  let sendCalls: any[];
  let responses: any[];
  let defaultResponse: any;
  let batcher: RequestBatcher;

  function makeBatcher(overrides: Record<string, any> = {}) {
    return new RequestBatcher({
      storageKey: KEY,
      libConfig: {
        batchSize: 10,
        batchFlushIntervalMs: 1000,
        batchRequestTimeoutMs: 5000,
        batchAutostart: false,
      },
      sendRequestFunc: async (data, options) => {
        sendCalls.push({ data, options });
        return responses.length ? responses.shift() : defaultResponse;
      },
      usePersistence: true,
      queueStorage: new QueueStorage(),
      ...overrides,
    });
  }

  beforeEach(() => {
    localStorage.clear();
    sendCalls = [];
    responses = [];
    defaultResponse = { httpStatusCode: 200, ok: true };
    batcher = makeBatcher();
  });

  // --- Dedupe structure lifecycle (memory-leak defect) -----------------------

  describe('dedupe bookkeeping', () => {
    it('drops the per-item attempt counter once the item leaves the queue', async () => {
      for (let i = 0; i < 5; i++) {
        await batcher.enqueue(event(`evt-${i}`));
      }
      await batcher.flush();

      // The counter only matters for items still in the queue. Keeping an entry
      // per event ever sent was an unbounded leak on any long-lived tab.
      expect((batcher as any).itemIdsSentSuccessfully.size).toBe(0);
    });

    it('keeps the counter only while removal keeps failing', async () => {
      await batcher.enqueue(event('evt-stuck'));
      (batcher as any).removeItemsFromQueue = async () => false;

      await batcher.flush();

      const counters: Map<string, number> = (batcher as any).itemIdsSentSuccessfully;
      expect(counters.size).toBe(1);
      expect([...counters.values()][0]).toBe(1);
    });

    it('never re-sends an item whose removal failed after a successful delivery', async () => {
      await batcher.enqueue(event('evt-poison'));
      (batcher as any).removeItemsFromQueue = async () => false;

      for (let i = 0; i < 7; i++) {
        await batcher.flush();
      }

      // The delivery succeeded; only the queue write failed. The eventId mark
      // therefore stands, and every later flush filters the item out. A broken
      // queue must not become an infinite send loop against ingest — that is
      // precisely the failure that amplifies an outage.
      expect(sendCalls).toHaveLength(1);
    });

    it('caps the in-memory sent-event-id set', async () => {
      (batcher as any).markEventIdsSent(Array.from({ length: 1500 }, (_, i) => `bulk-${i}`));

      const sent: Set<string> = (batcher as any).sentEventIds;
      expect(sent.size).toBe(1000);
      expect(sent.has('bulk-0')).toBe(false);
      expect(sent.has('bulk-1499')).toBe(true);
    });

    it('caps the attempt map even under a pathological removal-failure loop', async () => {
      const counters: Map<string, number> = (batcher as any).itemIdsSentSuccessfully;
      (batcher as any).recordDeliveryAttempts(
        Array.from({ length: 1500 }, (_, i) => `id-${i}`),
        false,
      );
      expect(counters.size).toBe(1000);
    });

    it('trims an over-sized persisted set on load', () => {
      localStorage.setItem(
        SENT_IDS_KEY,
        JSON.stringify(Array.from({ length: 1500 }, (_, i) => `stored-${i}`)),
      );
      expect(((makeBatcher() as any).sentEventIds as Set<string>).size).toBe(1000);
    });

    it('survives a corrupt persisted set', () => {
      localStorage.setItem(SENT_IDS_KEY, 'not json');
      expect(() => makeBatcher()).not.toThrow();
    });
  });

  // --- Unload path (duplicate-send defect) ----------------------------------

  describe('unload', () => {
    it('dequeues when the server definitely accepted the batch', async () => {
      await batcher.enqueue(event('evt-unload-ok'));
      await batcher.flush({ unloading: true });

      expect(sendCalls).toHaveLength(1);
      expect(await (batcher as any).queue.fillBatch(10)).toHaveLength(0);
    });

    it.each([
      ['a timeout', { error: 'timeout', httpStatusCode: 0 }],
      ['a 500', { httpStatusCode: 500, ok: false }],
      ['no response at all', undefined],
    ])('keeps the batch queued when the outcome is %s', async (_label, response) => {
      await batcher.enqueue(event('evt-unload-unknown'));
      defaultResponse = response;

      await batcher.flush({ unloading: true });

      // Losing events is worse than a possible duplicate, so ambiguity retains.
      expect(await (batcher as any).queue.fillBatch(10)).toHaveLength(1);
    });

    it('marks event ids as sent before the request leaves', async () => {
      await batcher.enqueue(event('evt-premark'));
      let sentIdsDuringRequest: string[] = [];

      const b = makeBatcher({
        sendRequestFunc: async () => {
          sentIdsDuringRequest = [...((b as any).sentEventIds as Set<string>)];
          return { httpStatusCode: 200, ok: true };
        },
      });
      await b.flush();

      // The page can die mid-request; the mark has to be durable before then.
      expect(sentIdsDuringRequest).toContain('evt-premark');
      expect(JSON.parse(localStorage.getItem(SENT_IDS_KEY) as string)).toContain('evt-premark');
    });
  });

  // --- Already-sent eviction ------------------------------------------------

  describe('already-sent items', () => {
    it('evicts them instead of skipping them forever', async () => {
      await batcher.enqueue(event('evt-already'));
      (batcher as any).markEventIdsSent(['evt-already']);

      await batcher.flush();

      expect(sendCalls).toHaveLength(0);
      // Skipping alone left the item at the head of the queue, so every future
      // flush burned part of its batch on it.
      expect(await (batcher as any).queue.fillBatch(10)).toHaveLength(0);
    });

    it('does not stop the rest of the batch from sending', async () => {
      await batcher.enqueue(event('evt-dupe'));
      await batcher.enqueue(event('evt-fresh'));
      (batcher as any).markEventIdsSent(['evt-dupe']);

      await batcher.flush();

      expect(sendCalls).toHaveLength(1);
      expect(sendCalls[0].data).toHaveLength(1);
      expect(sendCalls[0].data[0].payload[0].eventId).toBe('evt-fresh');
    });
  });

  // --- Response handling ----------------------------------------------------

  describe('retry and backoff', () => {
    it('schedules a backoff instead of hammering ingest on a 500', async () => {
      vi.useFakeTimers();
      // Pin the jitter draw high. Without this the test is flaky by
      // construction: full jitter picks uniformly in [0, ceiling), so a low draw
      // legitimately retries inside the 500ms window below.
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      await batcher.enqueue(event('evt-500'));
      defaultResponse = { httpStatusCode: 500, ok: false };

      await batcher.flush();
      expect(sendCalls).toHaveLength(1);

      // Nothing more should go out until the backoff elapses — an SDK that
      // retries immediately turns a partial outage into a self-inflicted DDoS.
      vi.advanceTimersByTime(500);
      expect(sendCalls).toHaveLength(1);
    });

    it('jitters the backoff so a fleet does not retry in lockstep', async () => {
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 500, ok: false };

      // One fresh batcher per sample stands in for one client in the fleet: each
      // fails once, from the same base interval, exactly as a fleet does when
      // ingest wobbles.
      const delays = new Set<number>();
      for (let i = 0; i < 100; i++) {
        // Own storage key per client — they are separate browsers, and sharing
        // one key would let the queues and dedupe sets interfere.
        const client = makeBatcher({ storageKey: `${KEY}_fleet_${i}` });
        await client.enqueue(event(`evt-fleet-${i}`));
        await client.flush();
        delays.add((client as any).flushInterval);
      }

      // The actual property under test. Deterministic backoff collapses this to
      // a single value — which is the thundering herd, stated as an assertion.
      expect(delays.size).toBeGreaterThan(50);
    });

    it('doubles the ceiling from the true schedule, not from the jittered draw', async () => {
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 500, ok: false };
      // A very low draw: the sleep is near zero, but it must NOT become the base
      // the next ceiling doubles from, or repeated failures stop backing off at
      // all and the fleet creeps back to hammering.
      vi.spyOn(Math, 'random').mockReturnValue(0);

      // Base interval is 1000ms, so the ceiling walks 2000 -> 4000 -> 8000 even
      // though every scheduled sleep was 0.
      await batcher.enqueue(event('evt-ceiling-1'));
      await batcher.flush();
      expect((batcher as any).retryCeilingMS).toBe(2000);

      await batcher.enqueue(event('evt-ceiling-2'));
      await batcher.flush();
      expect((batcher as any).retryCeilingMS).toBe(4000);

      await batcher.enqueue(event('evt-ceiling-3'));
      await batcher.flush();
      expect((batcher as any).retryCeilingMS).toBe(8000);
    });

    it('caps the jittered backoff ceiling at ten minutes', async () => {
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 500, ok: false };
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      for (let i = 0; i < 20; i++) {
        await batcher.enqueue(event(`evt-cap-${i}`));
        await batcher.flush();
      }

      expect((batcher as any).retryCeilingMS).toBe(10 * 60 * 1000);
      expect((batcher as any).flushInterval).toBe(5 * 60 * 1000);
    });

    it('resets the backoff ceiling after a success', async () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      defaultResponse = { httpStatusCode: 500, ok: false };
      await batcher.enqueue(event('evt-reset-fail'));
      await batcher.flush();
      expect((batcher as any).retryCeilingMS).toBeGreaterThan(0);

      // A later, unrelated failure must start from the base interval again
      // rather than resuming the previous incident's ceiling.
      defaultResponse = { httpStatusCode: 200, ok: true };
      await batcher.enqueue(event('evt-reset-ok'));
      await batcher.flush();

      expect((batcher as any).retryCeilingMS).toBe(0);
    });

    it('honours Retry-After over its own backoff', async () => {
      vi.useFakeTimers();
      await batcher.enqueue(event('evt-429'));
      defaultResponse = { httpStatusCode: 429, ok: false, retryAfter: '30' };

      await batcher.flush();

      expect((batcher as any).flushInterval).toBe(30000);
    });

    it('caps backoff at ten minutes', async () => {
      vi.useFakeTimers();
      await batcher.enqueue(event('evt-cap'));
      defaultResponse = { httpStatusCode: 503, ok: false, retryAfter: '99999' };

      await batcher.flush();

      expect((batcher as any).flushInterval).toBe(10 * 60 * 1000);
    });

    it('halves the batch size on a 413 rather than dropping events', async () => {
      for (let i = 0; i < 8; i++) {
        await batcher.enqueue(event(`evt-big-${i}`));
      }
      defaultResponse = { httpStatusCode: 413, ok: false };

      await batcher.flush();

      expect((batcher as any).batchSize).toBeLessThan(10);
      expect(await (batcher as any).queue.fillBatch(10)).toHaveLength(8);
    });

    it('drops a single event that is too large, since retrying cannot help', async () => {
      await batcher.enqueue(event('evt-huge'));
      defaultResponse = { httpStatusCode: 413, ok: false };

      await batcher.flush();

      expect(await (batcher as any).queue.fillBatch(10)).toHaveLength(0);
    });

    it('removes items on a 400 — a rejected payload will never succeed', async () => {
      await batcher.enqueue(event('evt-400'));
      defaultResponse = { httpStatusCode: 400, ok: false };

      await batcher.flush();

      expect(await (batcher as any).queue.fillBatch(10)).toHaveLength(0);
    });

    it('disables batching after repeated queue-removal failures', async () => {
      const reported: string[] = [];
      const b = makeBatcher({ errorReporter: (m: string) => reported.push(m) });
      (b as any).removeItemsFromQueue = async () => false;

      // Each flush needs a *fresh* event: once an id is marked sent, the item is
      // filtered out and the flush stops reaching the removal path at all.
      for (let i = 0; i < 7; i++) {
        await b.enqueue(event(`evt-rm-${i}`));
        await b.flush();
      }

      expect(reported.join(' ')).toContain('disabling batching system');
      expect((b as any).stopped).toBe(true);
    });

    it('does not run two flushes concurrently', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const b = makeBatcher({
        sendRequestFunc: async () => {
          maxInFlight = Math.max(maxInFlight, ++inFlight);
          await Promise.resolve();
          inFlight--;
          return { httpStatusCode: 200, ok: true };
        },
      });
      await b.enqueue(event('evt-c1'));

      await Promise.all([b.flush(), b.flush(), b.flush()]);

      expect(maxInFlight).toBe(1);
    });

    it('recovers from a transport that throws', async () => {
      const reported: string[] = [];
      const b = makeBatcher({
        sendRequestFunc: async () => {
          throw new Error('network exploded');
        },
        errorReporter: (m: string) => reported.push(m),
      });
      await b.enqueue(event('evt-throw'));

      await b.flush();

      expect(reported.join(' ')).toContain('Error flushing request queue');
      // requestInProgress must be released, or the batcher is wedged forever.
      expect((b as any).requestInProgress).toBe(false);
    });
  });

  describe('lifecycle', () => {
    it('does not send an empty queue', async () => {
      await batcher.flush();
      expect(sendCalls).toHaveLength(0);
    });

    it('stop() cancels the scheduled flush', async () => {
      vi.useFakeTimers();
      await batcher.enqueue(event('evt-stop'));
      await batcher.flush();
      const before = sendCalls.length;

      batcher.stop();
      vi.advanceTimersByTime(60_000);

      expect(sendCalls.length).toBe(before);
    });
  });
});
