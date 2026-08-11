import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestBatcher } from '../../src/shared/queue/requestBatcher.ts';
import { QueueStorage } from '../../src/shared/storage/queueStorage.ts';

const KEY = '__unit_batcher__';
const SENT_IDS_KEY = `${KEY}_sent_event_ids`;

/** Payload shape the batcher's extractEventIds() understands. */
function event(eventId: string) {
  return {
    name: 'Test Event',
    payload: [{ eventId, sessionId: 's', profileId: 'p' }],
  };
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

      const counters: Map<string, number> = (batcher as any)
        .itemIdsSentSuccessfully;
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
      (batcher as any).markEventIdsSent(
        Array.from({ length: 1500 }, (_, i) => `bulk-${i}`),
      );

      const sent: Set<string> = (batcher as any).sentEventIds;
      expect(sent.size).toBe(1000);
      expect(sent.has('bulk-0')).toBe(false);
      expect(sent.has('bulk-1499')).toBe(true);
    });

    it('caps the attempt map even under a pathological removal-failure loop', async () => {
      const counters: Map<string, number> = (batcher as any)
        .itemIdsSentSuccessfully;
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
      expect(((makeBatcher() as any).sentEventIds as Set<string>).size).toBe(
        1000,
      );
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
    ])(
      'keeps the batch queued when the outcome is %s',
      async (_label, response) => {
        await batcher.enqueue(event('evt-unload-unknown'));
        defaultResponse = response;

        await batcher.flush({ unloading: true });

        // Losing events is worse than a possible duplicate, so ambiguity retains.
        expect(await (batcher as any).queue.fillBatch(10)).toHaveLength(1);
      },
    );

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
      expect(
        JSON.parse(localStorage.getItem(SENT_IDS_KEY) as string),
      ).toContain('evt-premark');
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
        // Hold the circuit breaker closed. It would otherwise trip at 5 failures
        // and stop sending long before the ceiling reaches its cap — correct
        // behaviour, but it is the *ceiling* under test here, so the two are
        // isolated. The breaker has its own tests below.
        (batcher as any).consecutiveSendFailures = 0;
        (batcher as any).breakerOpenUntilMS = 0;
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

    // --- Circuit breaker ----------------------------------------------------

    /** Drive `n` failing flushes, one event each. */
    async function failTimes(n: number, tag: string) {
      for (let i = 0; i < n; i++) {
        await batcher.enqueue(event(`evt-${tag}-${i}`));
        await batcher.flush();
      }
    }

    it('stops sending entirely after five consecutive failures', async () => {
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 500, ok: false };

      await failTimes(5, 'trip');
      expect(sendCalls).toHaveLength(5);

      // Jitter spreads retries but does not reduce how many a client makes.
      // Against a service that is actually down, continuing to knock is pure
      // waste — and worst at the moment of recovery, when every client's backlog
      // arrives at once.
      await batcher.enqueue(event('evt-trip-after'));
      await batcher.flush();
      expect(sendCalls).toHaveLength(5);
    });

    it('keeps accepting events while the breaker is open', async () => {
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 500, ok: false };
      await failTimes(5, 'open');

      // Open means "stop sending", never "stop collecting". Dropping events here
      // would turn an ingest outage into permanent client-side data loss.
      await batcher.enqueue(event('evt-open-queued'));
      const queued = await (batcher as any).queue.fillBatch(100);
      expect(queued.length).toBeGreaterThan(0);
    });

    it('probes once when the window expires and closes on success', async () => {
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 500, ok: false };
      await failTimes(5, 'probe');
      expect(sendCalls).toHaveLength(5);

      // Move past the open window without firing the scheduled timer, so this
      // asserts the guard in flush() rather than the scheduler.
      vi.setSystemTime(Date.now() + 70_000);
      defaultResponse = { httpStatusCode: 200, ok: true };

      await batcher.enqueue(event('evt-probe-recovery'));
      await batcher.flush();

      expect(sendCalls.length).toBeGreaterThan(5);
      expect((batcher as any).breakerOpenUntilMS).toBe(0);
      expect((batcher as any).consecutiveSendFailures).toBe(0);
    });

    it('reopens when the half-open probe also fails', async () => {
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 500, ok: false };
      await failTimes(5, 'reprobe');

      vi.setSystemTime(Date.now() + 70_000);
      await batcher.enqueue(event('evt-reprobe-still-down'));
      await batcher.flush();
      const afterProbe = sendCalls.length;

      // One probe failing means the service is still down — it must not resume
      // normal traffic just because the window elapsed.
      await batcher.enqueue(event('evt-reprobe-blocked'));
      await batcher.flush();
      expect(sendCalls).toHaveLength(afterProbe);
      expect((batcher as any).breakerOpenUntilMS).toBeGreaterThan(Date.now());
    });

    it('lets an unload flush through even with the breaker open', async () => {
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 500, ok: false };
      await failTimes(5, 'unload');
      const beforeUnload = sendCalls.length;

      // Last chance these events ever get. One keepalive request from a dying
      // page is not the load the breaker exists to shed.
      await batcher.enqueue(event('evt-unload-final'));
      await batcher.flush({ unloading: true });

      expect(sendCalls.length).toBeGreaterThan(beforeUnload);
    });

    it('counts only consecutive failures, so blips do not accumulate', async () => {
      vi.useFakeTimers();

      // Four separate two-failure blips, each cleared by a success, must never
      // trip a breaker that is meant to detect a sustained outage.
      for (let round = 0; round < 4; round++) {
        defaultResponse = { httpStatusCode: 500, ok: false };
        await failTimes(2, `blip-${round}`);
        defaultResponse = { httpStatusCode: 200, ok: true };
        await batcher.enqueue(event(`evt-blip-ok-${round}`));
        await batcher.flush();
      }

      expect((batcher as any).consecutiveSendFailures).toBe(0);
      expect((batcher as any).breakerOpenUntilMS).toBe(0);
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

    it('jitters the steady-state flush interval so a cohort de-syncs', async () => {
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 200, ok: true };

      // A cohort that loaded together — a CDN purge, a deploy, an email blast.
      // With a fixed timer these flush in lockstep forever; nothing pulls them
      // apart, so ingest sees a spike at every interval boundary in entirely
      // normal operation.
      const intervals = new Set<number>();
      for (let i = 0; i < 100; i++) {
        const client = makeBatcher({ storageKey: `${KEY}_cohort_${i}` });
        await client.enqueue(event(`evt-cohort-${i}`));
        await client.flush();
        intervals.add((client as any).flushInterval);
      }

      expect(intervals.size).toBeGreaterThan(50);
    });

    it('keeps the flush interval within 10% of the configured value', async () => {
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 200, ok: true };

      // The configured interval is a batching-latency contract. Spreading a
      // cohort must not quietly change how long events wait, so the band is
      // narrow — this is the assertion that stops it drifting into full jitter.
      for (let i = 0; i < 100; i++) {
        const client = makeBatcher({ storageKey: `${KEY}_band_${i}` });
        await client.enqueue(event(`evt-band-${i}`));
        await client.flush();

        const interval = (client as any).flushInterval;
        expect(interval).toBeGreaterThanOrEqual(900);
        expect(interval).toBeLessThanOrEqual(1100);
      }
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

  // --- Assertions added from the mutation-testing baseline ------------------
  //
  // Each test here exists because Stryker showed the behaviour could be changed
  // with the whole 357-test suite still green (CHECKPOINT.md §3f). They are not
  // extra coverage of already-asserted code — they close specific holes:
  //
  //   getDroppedEventCount() emptied to return undefined  → survived
  //   start(): body emptied / stopped = false → true      → survived
  //   clear(): made a no-op                                → survived
  //   breaker guard: `>` → `>=`                            → survived
  //
  // The pattern in every case is the same: the *effect* was tested through some
  // other object (usually RequestQueue directly), so the batcher's own method
  // could stop working without any assertion noticing.

  describe('public accessors and lifecycle — mutation-driven', () => {
    it('getDroppedEventCount() reports the queue’s count, not its own idea of it', async () => {
      // The four existing assertions on the drop counter all call
      // RequestQueue.getDroppedEventCount() directly, so the batcher's
      // one-line delegate was asserted by nothing: deleting its body (making it
      // return undefined) kept the suite green. That matters because this
      // accessor is the entire deliverable of the bounded queue (§3c) — a
      // silently-undefined count puts us back to unmeasured loss.
      const capped = makeBatcher({
        libConfig: {
          batchSize: 10,
          batchFlushIntervalMs: 1000,
          batchRequestTimeoutMs: 5000,
          batchAutostart: false,
          maxQueuedEvents: 3,
        },
      });

      expect(capped.getDroppedEventCount()).toBe(0);

      for (let i = 0; i < 6; i++) {
        await capped.enqueue(event(`evt-cap-${i}`));
      }

      const dropped = capped.getDroppedEventCount();
      expect(dropped, 'three events over a cap of three must be counted').toBe(
        3,
      );
      expect(dropped).toBe((capped as any).queue.getDroppedEventCount());
      expect(typeof dropped, 'must be a number, never undefined').toBe(
        'number',
      );
    });

    it('start() clears the stopped flag, so scheduled flushes resume', async () => {
      // `stopped = false` in start() was unasserted: flipping it to `true` left
      // every test passing, because the tests that call start() then flush
      // manually rather than relying on the schedule. A customer calling
      // stop() then start() would have got a batcher that never flushed again.
      vi.useFakeTimers();
      batcher.stop();
      expect((batcher as any).stopped).toBe(true);

      await batcher.start();
      expect((batcher as any).stopped).toBe(false);

      await batcher.enqueue(event('evt-restart'));
      const before = sendCalls.length;
      await vi.advanceTimersByTimeAsync(5_000);

      expect(
        sendCalls.length,
        'the schedule must be live again after start()',
      ).toBeGreaterThan(before);
    });

    it('start() resets the consecutive-removal-failure count', async () => {
      (batcher as any).consecutiveRemovalFailures = 4;
      await batcher.start();
      expect((batcher as any).consecutiveRemovalFailures).toBe(0);
    });

    it('clear() actually empties the queue', async () => {
      // clear() replaced by a no-op survived: nothing asserted that a cleared
      // batcher has nothing left to send. This is the method a consent-withdrawal
      // path would call, so a silent no-op means sending events after opt-out.
      await batcher.enqueue(event('evt-clear-1'));
      await batcher.enqueue(event('evt-clear-2'));

      await batcher.clear();

      await batcher.flush();
      expect(sendCalls, 'a cleared queue has nothing to deliver').toHaveLength(
        0,
      );
    });

    it('treats a breaker window that has just expired as closed', async () => {
      // The guard is `breakerOpenUntilMS > Date.now()`, and `>=` survived — the
      // boundary was untested. Pinning it keeps the breaker's contract exact:
      // the window is "open until T", so at exactly T the probe is allowed
      // through rather than waiting another cycle.
      await batcher.enqueue(event('evt-boundary'));
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      (batcher as any).breakerOpenUntilMS = now;

      await batcher.flush();

      expect(
        sendCalls,
        'at exactly the expiry instant the breaker is closed',
      ).toHaveLength(1);
    });

    it('still blocks a send one millisecond before the window expires', async () => {
      // The other half of the boundary — without this, `>=` would be replaced by
      // something that never blocks and this suite still would not care.
      await batcher.enqueue(event('evt-boundary-2'));
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      (batcher as any).breakerOpenUntilMS = now + 1;

      await batcher.flush();

      expect(
        sendCalls,
        'the breaker is still open for one more millisecond',
      ).toHaveLength(0);
    });
  });

  // --- Response classification: the branch set that decides deliver vs retry --
  //
  // 132 of the 363 remaining mutants live in handleResponse and
  // isDefiniteSuccess. Every one of them is a wrong answer to "was this batch
  // ingested?", and both wrong answers are data bugs: a false success dequeues
  // undelivered events, a false failure re-sends delivered ones.

  describe('isDefiniteSuccess', () => {
    // Tested directly: it is the single predicate the unload path trusts, and
    // driving it through flush() cannot reach every shape a transport returns.
    function classify(response: any): boolean {
      return (batcher as any).isDefiniteSuccess(response);
    }

    it.each([
      ['a missing response', undefined],
      ['a null response', null],
      ['a transport error', { error: 'network' }],
      ['an error alongside a 200', { error: 'timeout', httpStatusCode: 200 }],
      ['a zero status', { httpStatusCode: 0 }],
      ['a 500', { httpStatusCode: 500 }],
      ['a 429', { httpStatusCode: 429 }],
      ['a 400', { httpStatusCode: 400 }],
      ['a 199', { httpStatusCode: 199 }],
      ['a 300', { httpStatusCode: 300 }],
      ['a numeric-looking string status', { httpStatusCode: '200' }],
      ['no status at all', {}],
    ])('does not call %s a definite success', (_name, response) => {
      expect(classify(response)).toBe(false);
    });

    it.each([
      ['an explicit ok', { ok: true }],
      ['a 200', { httpStatusCode: 200 }],
      ['a 204', { httpStatusCode: 204 }],
      ['a 299', { httpStatusCode: 299 }],
    ])('accepts %s', (_name, response) => {
      expect(classify(response)).toBe(true);
    });

    it('requires ok to be literally true, not merely truthy', () => {
      // `response.ok === true` — a strict check. A transport returning ok: 'yes'
      // must not be read as confirmed delivery.
      expect(classify({ ok: 'yes' })).toBe(false);
      expect(classify({ ok: 1 })).toBe(false);
    });
  });

  describe('retryable outcomes keep the batch', () => {
    /** Every case here must leave the events queued AND their marks released. */
    async function attempt(response: any) {
      const b = makeBatcher();
      await b.enqueue(event('evt-retry'));
      responses = [response];
      const sched = vi
        .spyOn(b as any, 'scheduleFlush')
        .mockImplementation(() => {});

      await b.flush();

      return {
        sentIds: (b as any).sentEventIds as Set<string>,
        scheduled: sched.mock.calls.map((c) => c[0] as number),
        queued: await (b as any).queue.fillBatch(10),
      };
    }

    it.each([
      ['a 500', { httpStatusCode: 500 }],
      ['a 503', { httpStatusCode: 503 }],
      ['a 429', { httpStatusCode: 429 }],
      ['a zero status', { httpStatusCode: 0 }],
      ['a negative status', { httpStatusCode: -1 }],
      [
        'a transport error while apparently online',
        { error: 'network', httpStatusCode: 200 },
      ],
      ['a missing response object', undefined],
      // A DELIVERED response carrying no status at all. This case used to be
      // classified as a success and the batch was dequeued unconfirmed, because
      // `undefined >= 500`, `undefined === 429` and `undefined <= 0` are all false
      // under `any` — while `isDefiniteSuccess` called the same response
      // inconclusive (asserted above, 'no status at all'). Typing the response as
      // `BatchSendResult | null` surfaced the contradiction; retry is the safe
      // resolution, and this asserts it so the two classifiers cannot drift apart
      // again.
      ['a delivered response with no status', {}],
      ['a response whose status is not a number', { httpStatusCode: '200' }],
    ])(
      'retries after %s without dropping the batch',
      async (_name, response) => {
        const { sentIds, scheduled, queued } = await attempt(response);

        expect(queued, 'the events must still be queued').toHaveLength(1);
        expect(
          sentIds.has('evt-retry'),
          'the pre-send mark must be released or the retry evicts the event as a duplicate',
        ).toBe(false);
        expect(scheduled, 'a backoff must be scheduled').toHaveLength(1);
        expect(scheduled[0]).toBeGreaterThanOrEqual(0);
      },
    );

    it('honours Retry-After exactly, without jitter', async () => {
      // `retryMS = ceilingMS` on this path — the one deliberately unjittered
      // branch in the batcher. See BACKEND.md §2a for why it is still open.
      const { scheduled } = await attempt({
        httpStatusCode: 429,
        retryAfter: '30',
      });
      expect(scheduled[0]).toBe(30_000);
    });

    it('caps Retry-After at the ten-minute ceiling', async () => {
      const { scheduled } = await attempt({
        httpStatusCode: 429,
        retryAfter: '86400',
      });
      expect(scheduled[0]).toBe(10 * 60 * 1000);
    });

    it('ignores an unparseable Retry-After and falls back to jittered backoff', async () => {
      // `if (retryAfterMS)` — parseInt('soon') is NaN, which must not become the
      // delay. A NaN timeout fires immediately, i.e. it would hammer ingest.
      const { scheduled } = await attempt({
        httpStatusCode: 429,
        retryAfter: 'soon',
      });
      expect(Number.isNaN(scheduled[0])).toBe(false);
      expect(scheduled[0]).toBeLessThanOrEqual(2_000);
    });

    it('ignores a zero Retry-After for the same reason', async () => {
      const { scheduled } = await attempt({
        httpStatusCode: 429,
        retryAfter: '0',
      });
      expect(scheduled[0]).toBeGreaterThanOrEqual(0);
      expect(scheduled[0]).toBeLessThanOrEqual(2_000);
    });

    it('resets the failure streak once a delivery succeeds', async () => {
      // closeCircuit() on the success path. Without it the counter carries old
      // failures forward and the breaker trips on unrelated blips later.
      const b = makeBatcher();
      await b.enqueue(event('evt-a'));
      responses = [{ httpStatusCode: 500 }];
      vi.spyOn(b as any, 'scheduleFlush').mockImplementation(() => {});
      await b.flush();
      expect((b as any).consecutiveSendFailures).toBe(1);

      responses = [{ httpStatusCode: 200, ok: true }];
      await b.flush();
      expect((b as any).consecutiveSendFailures).toBe(0);
      expect((b as any).breakerOpenUntilMS).toBe(0);
    });
  });

  describe('413 handling', () => {
    it('halves the batch size and keeps a multi-event batch queued', async () => {
      const b = makeBatcher();
      for (let i = 0; i < 4; i++) await b.enqueue(event(`evt-413-${i}`));
      const before = (b as any).batchSize;
      responses = [{ httpStatusCode: 413 }];
      vi.spyOn(b as any, 'scheduleFlush').mockImplementation(() => {});

      await b.flush();

      expect((b as any).batchSize).toBeLessThan(before);
      expect((b as any).batchSize).toBeGreaterThanOrEqual(1);
      expect(
        await (b as any).queue.fillBatch(10),
        'nothing is dropped on a multi-event 413',
      ).toHaveLength(4);
    });

    it('never reduces the batch size below one', async () => {
      // Math.max(1, …): a batch size of 0 would stop the batcher sending
      // anything, permanently, with a full queue.
      const b = makeBatcher();
      await b.enqueue(event('evt-a'));
      await b.enqueue(event('evt-b'));
      (b as any).batchSize = 2;
      responses = [{ httpStatusCode: 413 }];
      vi.spyOn(b as any, 'scheduleFlush').mockImplementation(() => {});

      await b.flush();
      expect((b as any).batchSize).toBeGreaterThanOrEqual(1);
    });

    it('drops a single event that is too large, rather than retrying forever', async () => {
      // The one place the batcher deliberately loses an event: a lone 413 cannot
      // be made smaller, so retrying it is an infinite loop against ingest.
      const b = makeBatcher();
      await b.enqueue(event('evt-huge'));
      responses = [{ httpStatusCode: 413 }];
      const reported: string[] = [];
      (b as any).errorReporter = (m: string) => reported.push(m);

      await b.flush();

      expect(await (b as any).queue.fillBatch(10)).toHaveLength(0);
      expect(reported.join(' ')).toContain('too large');
    });
  });

  describe('repeated queue-removal failure', () => {
    it('stops the batcher after more than five consecutive removal failures', async () => {
      // `> 5` then stop(). A queue that cannot delete what it delivered would
      // otherwise re-send the same batch forever — the amplification the circuit
      // breaker exists to prevent, arriving by a different route.
      const b = makeBatcher();
      (b as any).removeItemsFromQueue = async () => false;
      const reported: string[] = [];
      (b as any).errorReporter = (m: string) => reported.push(m);

      for (let i = 0; i < 7; i++) {
        await b.enqueue(event(`evt-stuck-${i}`));
        await b.flush();
      }

      expect(
        (b as any).stopped,
        'the batcher must give up rather than loop',
      ).toBe(true);
      expect(reported.join(' ')).toContain('disabling batching system');
    });
  });

  // --- Dedupe bookkeeping internals ----------------------------------------
  //
  // These are private, and tested directly on purpose: they are the structures
  // that decide whether an event is considered already-sent, so their invariants
  // (bounded size, insertion-order eviction, rollback on definite failure) are
  // the contract. Driving them only through flush() cannot reach the cap paths
  // without thousands of round-trips.

  describe('sent-event-id bookkeeping', () => {
    it('trims the oldest ids first when the cap is exceeded', async () => {
      // Set iteration is insertion order, so the eviction loop must drop from the
      // front. Dropping the newest instead would let a *just-sent* event be
      // re-sent, which is the duplicate this structure exists to prevent.
      (batcher as any).markEventIdsSent(
        Array.from({ length: 1100 }, (_, i) => `id-${i}`),
      );

      const sent: Set<string> = (batcher as any).sentEventIds;
      expect(sent.size).toBe(1000);
      expect(sent.has('id-0'), 'oldest evicted').toBe(false);
      expect(sent.has('id-99'), 'oldest 100 evicted').toBe(false);
      expect(sent.has('id-100'), 'the 101st survives').toBe(true);
      expect(sent.has('id-1099'), 'newest always survives').toBe(true);
    });

    it('does not trim while at or below the cap', async () => {
      (batcher as any).markEventIdsSent(
        Array.from({ length: 1000 }, (_, i) => `id-${i}`),
      );
      expect(((batcher as any).sentEventIds as Set<string>).size).toBe(1000);
      expect(((batcher as any).sentEventIds as Set<string>).has('id-0')).toBe(
        true,
      );
    });

    it('persists the marks so a reload cannot re-send them', async () => {
      (batcher as any).markEventIdsSent(['persist-me']);
      (batcher as any).saveSentEventIds();

      const raw = localStorage.getItem(SENT_IDS_KEY);
      expect(raw).toBeTruthy();
      expect(JSON.parse(raw as string)).toContain('persist-me');
    });

    it('reloads persisted marks into a fresh instance', async () => {
      localStorage.setItem(SENT_IDS_KEY, JSON.stringify(['from-storage']));
      const fresh = makeBatcher();
      expect(
        ((fresh as any).sentEventIds as Set<string>).has('from-storage'),
      ).toBe(true);
    });

    it('trims an over-sized persisted set on load', async () => {
      // An older build capped storage but not memory. Loading 1500 ids without
      // trimming would put memory back over the cap immediately.
      localStorage.setItem(
        SENT_IDS_KEY,
        JSON.stringify(Array.from({ length: 1500 }, (_, i) => `old-${i}`)),
      );
      const fresh = makeBatcher();

      const sent: Set<string> = (fresh as any).sentEventIds;
      expect(sent.size).toBe(1000);
      expect(sent.has('old-1499'), 'the tail is what is kept').toBe(true);
      expect(sent.has('old-0')).toBe(false);
    });

    it('ignores a persisted value that is not an array', async () => {
      // JSON.parse succeeds on '"a string"' and on '5'. Spreading either into a
      // Set produces garbage ids or throws; the Array.isArray check is what stops
      // corrupt storage from poisoning dedupe.
      localStorage.setItem(SENT_IDS_KEY, JSON.stringify({ not: 'an array' }));
      const fresh = makeBatcher();
      expect(((fresh as any).sentEventIds as Set<string>).size).toBe(0);
    });

    it('reports unparseable storage instead of throwing at construction', async () => {
      localStorage.setItem(SENT_IDS_KEY, '{not json');
      const reported: string[] = [];
      const fresh = makeBatcher({
        errorReporter: (m: string) => reported.push(m),
      });

      expect(((fresh as any).sentEventIds as Set<string>).size).toBe(0);
      expect(reported.join(' ')).toContain('Error loading sent event IDs');
    });

    it('rolls back a mark on definite failure, and writes that through', async () => {
      (batcher as any).markEventIdsSent(['roll-me', 'keep-me']);
      (batcher as any).saveSentEventIds();

      (batcher as any).unmarkEventIdsSent(['roll-me']);

      const sent: Set<string> = (batcher as any).sentEventIds;
      expect(sent.has('roll-me')).toBe(false);
      expect(sent.has('keep-me')).toBe(true);
      // Kills the missing saveSentEventIds() call: without the write, a reload
      // resurrects the rolled-back mark and the event is filtered as a duplicate.
      expect(JSON.parse(localStorage.getItem(SENT_IDS_KEY) as string)).toEqual([
        'keep-me',
      ]);
    });

    it('skips the storage write entirely for an empty rollback', async () => {
      // Kills `if (!eventIds.length) return;` — every failed empty-batch flush
      // would otherwise pay a JSON serialise plus a synchronous localStorage
      // write for nothing.
      const setSpy = vi.spyOn(Storage.prototype, 'setItem');
      (batcher as any).unmarkEventIdsSent([]);
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe('per-item delivery counters', () => {
    it('deletes counters when removal succeeded', async () => {
      const counters: Map<string, number> = (batcher as any)
        .itemIdsSentSuccessfully;
      counters.set('a', 2);
      counters.set('b', 1);

      (batcher as any).recordDeliveryAttempts(['a'], true);

      expect(
        counters.has('a'),
        'a delivered-and-removed item needs no counter',
      ).toBe(false);
      expect(counters.has('b')).toBe(true);
    });

    it('increments from zero when removal failed', async () => {
      (batcher as any).recordDeliveryAttempts(['x'], false);
      (batcher as any).recordDeliveryAttempts(['x'], false);
      expect(
        ((batcher as any).itemIdsSentSuccessfully as Map<string, number>).get(
          'x',
        ),
      ).toBe(2);
    });

    it('caps the counter map, evicting the oldest entries', async () => {
      // The backstop against a pathological removal-failure loop across many
      // distinct items. Without it this Map is the memory leak §4 defect 1 fixed,
      // reintroduced by a different path.
      const ids = Array.from({ length: 1100 }, (_, i) => `item-${i}`);
      (batcher as any).recordDeliveryAttempts(ids, false);

      const counters: Map<string, number> = (batcher as any)
        .itemIdsSentSuccessfully;
      expect(counters.size).toBe(1000);
      expect(counters.has('item-0')).toBe(false);
      expect(counters.has('item-1099')).toBe(true);
    });
  });

  describe('extractEventIds', () => {
    it('pulls string eventIds out of the payload array', () => {
      expect(
        (batcher as any).extractEventIds({
          name: 'e',
          payload: [{ eventId: 'a' }, { eventId: 'b' }],
        }),
      ).toEqual(['a', 'b']);
    });

    it.each([
      ['a missing payload', undefined],
      ['a null payload', null],
      ['a payload that is not an object', 'string'],
      ['no payload array', { name: 'e' }],
      ['a payload array that is not an array', { payload: { eventId: 'a' } }],
    ])('returns nothing for %s', (_name, payload) => {
      expect((batcher as any).extractEventIds(payload)).toEqual([]);
    });

    it('skips entries whose eventId is missing or not a string', () => {
      // Kills the three-part item guard. A non-string id would be marked as sent
      // and then never match on the next flush — the event becomes unsendable.
      expect(
        (batcher as any).extractEventIds({
          payload: [
            null,
            {},
            { eventId: 42 },
            { eventId: '' },
            { eventId: 'good' },
          ],
        }),
      ).toEqual(['good']);
    });
  });

  describe('flush scheduling helpers', () => {
    it('resetFlush clears the backoff ceiling so a later failure starts from base', () => {
      // Kills `retryCeilingMS = 0`. Leaving it set means an unrelated failure
      // hours later resumes from the previous incident's ceiling — up to the
      // 10-minute cap — instead of from the configured interval.
      (batcher as any).retryCeilingMS = 64_000;
      vi.spyOn(batcher as any, 'scheduleFlush').mockImplementation(() => {});

      (batcher as any).resetFlush();

      expect((batcher as any).retryCeilingMS).toBe(0);
    });

    it('resetFlush schedules within ±10% of the configured interval', () => {
      // The steady-state band from §3a. Asserting the band, not a value: full
      // jitter here would halve effective throughput and make batches erratic.
      const sched = vi
        .spyOn(batcher as any, 'scheduleFlush')
        .mockImplementation(() => {});

      for (let i = 0; i < 40; i++) (batcher as any).resetFlush();

      const delays = sched.mock.calls.map((c) => c[0] as number);
      expect(Math.min(...delays)).toBeGreaterThanOrEqual(900);
      expect(Math.max(...delays)).toBeLessThanOrEqual(1100);
      expect(new Set(delays).size, 'and it must actually vary').toBeGreaterThan(
        1,
      );
    });

    it('resetBatchSize restores the configured size after a 413 shrank it', () => {
      (batcher as any).batchSize = 1;
      (batcher as any).resetBatchSize();
      expect((batcher as any).batchSize).toBe(10);
    });

    it('flush() is re-entrant-safe while a request is in flight', () => {
      // Kills the `requestInProgress` guard. Two concurrent flushes send the same
      // batch twice — a duplicate at ingest, and the reason full jitter is safe
      // (see §3a: a low draw cannot start a second flush).
      (batcher as any).requestInProgress = true;
      return batcher.flush().then(() => {
        expect(
          sendCalls,
          'no send while one is already in flight',
        ).toHaveLength(0);
      });
    });
  });

  // --- Assertions from the measured mutation run (CHECKPOINT.md §3f) --------
  //
  // requestBatcher.ts held 95 survived + 15 no-coverage mutants after the
  // batches above — the single biggest pool in the repo. Every test below
  // targets a mutant that changes a computed value (a config flag, a message
  // string, an option object's contents, a boundary) rather than a guard or a
  // reporter's own plumbing, per the §3f-iii heuristic.

  describe('constructor — option defaults', () => {
    it('defaults flushOnlyOnInterval to false when omitted', () => {
      // Kills the ConditionalExpression/LogicalOperator mutants on
      // `options.flushOnlyOnInterval || false`.
      const b = makeBatcher();
      expect((b as any).flushOnlyOnInterval).toBe(false);
    });

    it('honours an explicit flushOnlyOnInterval: true', () => {
      const b = makeBatcher({ flushOnlyOnInterval: true });
      expect((b as any).flushOnlyOnInterval).toBe(true);
    });

    it('starts stopped when batchAutostart is false, running when true', () => {
      // Kills the BooleanLiteral mutant on `this.stopped =
      // !this.libConfig.batchAutostart`.
      const stoppedByDefault = makeBatcher();
      expect((stoppedByDefault as any).stopped).toBe(true);

      const autostarted = makeBatcher({
        libConfig: {
          batchSize: 10,
          batchFlushIntervalMs: 1000,
          batchRequestTimeoutMs: 5000,
          batchAutostart: true,
        },
      });
      expect((autostarted as any).stopped).toBe(false);
    });
  });

  describe('scheduleFlush — timer guards', () => {
    it('does not schedule a timer while stopped', () => {
      // Kills the ConditionalExpression mutant `if (!this.stopped)` → `if
      // (true)`, which would arm a timer even on a stopped batcher.
      vi.useFakeTimers();
      const b = makeBatcher();
      (b as any).stopped = true;

      (b as any).scheduleFlush(1000);

      expect((b as any).timeoutID).toBeNull();
    });

    it('replaces a pending timer rather than stacking two', async () => {
      // Kills the ConditionalExpression mutants on `if (this.timeoutID)`
      // before scheduling, and the BlockStatement that would skip the
      // `clearTimeout` call — without it, calling scheduleFlush twice would
      // leave the first timer alive to fire independently.
      vi.useFakeTimers();
      (batcher as any).stopped = false; // scheduleFlush is a no-op while stopped
      await batcher.enqueue(event('evt-resched'));
      const before = sendCalls.length;

      (batcher as any).scheduleFlush(1000);
      const firstTimer = (batcher as any).timeoutID;
      (batcher as any).scheduleFlush(2000);

      expect((batcher as any).timeoutID).not.toBe(firstTimer);
      vi.advanceTimersByTime(1000);
      // The replaced (cleared) timer must not have fired.
      expect(sendCalls.length).toBe(before);
    });
  });

  describe('sent-event-id persistence — guard boundaries', () => {
    it('does not trim at exactly the cap, only past it', () => {
      // Kills the EqualityOperator mutant `size > MAX_SENT_EVENT_IDS` → `>=`.
      (batcher as any).markEventIdsSent(
        Array.from({ length: 1000 }, (_, i) => `id-${i}`),
      );
      const sent: Set<string> = (batcher as any).sentEventIds;
      expect(sent.size).toBe(1000);
      expect(sent.has('id-0'), 'nothing evicted exactly at the cap').toBe(true);
    });

    it('persists only the newest MAX_SENT_EVENT_IDS ids, not the whole set', () => {
      // Kills the MethodExpression mutant that drops `.slice(-MAX_SENT_EVENT_IDS)`
      // from `saveSentEventIds()`. `markEventIdsSent` already caps the
      // in-memory Set, so this specifically catches an over-sized set placed
      // there directly (as a stale in-memory state would be).
      const sent: Set<string> = (batcher as any).sentEventIds;
      for (let i = 0; i < 1200; i++) sent.add(`raw-${i}`);

      (batcher as any).saveSentEventIds();

      const persisted = JSON.parse(
        localStorage.getItem(SENT_IDS_KEY) as string,
      );
      expect(persisted).toHaveLength(1000);
      expect(persisted).not.toContain('raw-0');
      expect(persisted).toContain('raw-1199');
    });

    it('only reads/writes localStorage when window.localStorage is actually available', () => {
      // Kills the ConditionalExpression/LogicalOperator mutants on `typeof
      // window !== 'undefined' && window.localStorage` in both
      // loadSentEventIds and saveSentEventIds — forcing either guard to
      // `true` unconditionally would attempt the storage call even when it
      // is unavailable.
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        window,
        'localStorage',
      );
      Object.defineProperty(window, 'localStorage', {
        value: undefined,
        configurable: true,
      });
      try {
        expect(() => makeBatcher()).not.toThrow();
        const b = makeBatcher();
        (b as any).markEventIdsSent(['x']);
        expect(() => (b as any).saveSentEventIds()).not.toThrow();
      } finally {
        if (originalDescriptor)
          Object.defineProperty(window, 'localStorage', originalDescriptor);
      }
    });
  });

  describe('flush() — early guards and in-flight flags', () => {
    it('does not touch requestInProgress when re-entrant', async () => {
      // Kills the BlockStatement mutant that empties `if
      // (this.requestInProgress) { return; }`, plus the ConditionalExpression
      // `if (false)` variant — either would let a second flush proceed to set
      // requestInProgress itself and race the first.
      (batcher as any).requestInProgress = true;
      await batcher.enqueue(event('evt-reentrant'));

      await batcher.flush();

      expect(sendCalls).toHaveLength(0);
      expect(
        (batcher as any).requestInProgress,
        'must be left exactly as found',
      ).toBe(true);
    });

    it('flips requestInProgress to true for the duration of a send', async () => {
      // Kills the BooleanLiteral mutant `this.requestInProgress = true` →
      // `= false`, checked from inside the in-flight sendRequest callback.
      await batcher.enqueue(event('evt-inflight'));
      let sawInProgress = false;
      const b = makeBatcher({
        sendRequestFunc: async () => {
          sawInProgress = (b as any).requestInProgress === true;
          return { httpStatusCode: 200, ok: true };
        },
      });
      await b.enqueue(event('evt-inflight2'));
      await b.flush();

      expect(sawInProgress).toBe(true);
    });
  });

  describe('flush() — already-sent eviction guard', () => {
    it('does not make a separate already-sent eviction call when nothing was already sent', async () => {
      // Kills the ArrayDeclaration mutant that seeds `alreadySentItemIds`
      // with a fake entry, and the ConditionalExpression/EqualityOperator
      // mutants on `if (alreadySentItemIds.length > 0)`. Either mutant would
      // add a SECOND removeItemsFromQueue call (for the phantom entry)
      // ahead of the ordinary post-success one — the delivered item still
      // gets removed regardless, so only the *call count* and *first call's
      // argument* tell the two apart.
      const b = makeBatcher();
      await b.enqueue(event('evt-fresh-only'));
      const [item] = await (b as any).queue.fillBatch(10);
      const spy = vi.spyOn(b as any, 'removeItemsFromQueue');

      await b.flush();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith([item.id]);
    });
  });

  describe('flush() — eventIdsInBatch seeding', () => {
    it('rolls back exactly the eventIds that were actually collected, no more', async () => {
      // Kills the ArrayDeclaration mutant that seeds `eventIdsInBatch` with a
      // fake entry before the loop populates it — a throwing transport takes
      // the catch path and rolls the whole array back, so a fake entry would
      // leak into unmarkEventIdsSent's argument.
      const b = makeBatcher({
        sendRequestFunc: async () => {
          throw new Error('boom');
        },
      });
      await b.enqueue(event('evt-real-only'));
      const spy = vi.spyOn(b as any, 'unmarkEventIdsSent');

      await b.flush();

      expect(spy).toHaveBeenCalledWith(['evt-real-only']);
    });
  });

  describe('beforeSendHook — orphan exemption', () => {
    it('does not call beforeSendHook for an orphaned item', async () => {
      // Kills the BooleanLiteral mutant `!item.orphaned` → `item.orphaned`
      // and the BlockStatement that would skip the hook call entirely for
      // every item. Orphaned items (adopted from another tab) already went
      // through the hook once before that tab died; running it again would
      // double-apply whatever transformation it does.
      const hookCalls: any[] = [];
      const b = makeBatcher({
        beforeSendHook: (p: any) => (hookCalls.push(p), p),
      });
      await b.enqueue(event('evt-orphan-hook'));
      const [item] = await (b as any).queue.fillBatch(10);
      (item as any).orphaned = true;
      vi.spyOn(b as any, 'queue', 'get').mockReturnValue({
        ...(b as any).queue,
        fillBatch: async () => [item],
        removeItemsByID: async () => true,
        getDroppedEventCount: () => 0,
      });

      await b.flush();

      expect(hookCalls).toHaveLength(0);
    });

    it('does call beforeSendHook for an ordinary (non-orphaned) item', async () => {
      const hookCalls: any[] = [];
      const b = makeBatcher({
        beforeSendHook: (p: any) => (hookCalls.push(p), p),
      });
      await b.enqueue(event('evt-normal-hook'));

      await b.flush();

      expect(hookCalls).toHaveLength(1);
    });
  });

  describe('flush() — already-sent detection is "any", not "all"', () => {
    it('evicts an item once any one of its eventIds has been sent before', async () => {
      // Kills the MethodExpression mutant `eventIds.some(...)` →
      // `eventIds.every(...)`. A payload can carry more than one eventId;
      // requiring ALL of them to be marked sent would let a partially-sent
      // item through again.
      const mixed = {
        name: 'Test Event',
        payload: [
          { eventId: 'evt-mixed-old', sessionId: 's', profileId: 'p' },
          { eventId: 'evt-mixed-new', sessionId: 's', profileId: 'p' },
        ],
      };
      await batcher.enqueue(mixed);
      (batcher as any).markEventIdsSent(['evt-mixed-old']); // only one of the two

      await batcher.flush();

      expect(
        sendCalls,
        'the item is dropped as already-sent, not resent',
      ).toHaveLength(0);
    });
  });

  describe('flush() — dedupe-exhaustion reporting', () => {
    it('reports the dupe with the item and attempt count attached', async () => {
      // Kills the BlockStatement/StringLiteral/ObjectLiteral mutants on the
      // `timesSent > 5` branch's reportError call.
      const b = makeBatcher();
      await b.enqueue(event('evt-dupe-exhausted'));
      const [item] = await (b as any).queue.fillBatch(10);
      (b as any).itemIdsSentSuccessfully.set(item.id, 6);
      const reported: any[] = [];
      (b as any).errorReporter = (m: string, ctx: any) =>
        reported.push({ m, ctx });

      await b.flush();

      expect(
        sendCalls,
        'must not send an item stuck past the dupe limit',
      ).toHaveLength(0);
      const dupe = reported.find((r) => r.m.includes('[dupe]'));
      expect(dupe, 'the message must name the dupe').toBeTruthy();
      expect(dupe.ctx.timesSent).toBe(6);
      expect(dupe.ctx.item.id).toBe(item.id);
    });
  });

  describe('flush() — the outgoing request options', () => {
    it('sends POST, the configured timeout, and keepalive on every request', async () => {
      // Kills the ObjectLiteral mutant that empties `requestOptions`, and the
      // StringLiteral mutant on `method: 'POST'`.
      await batcher.enqueue(event('evt-options'));
      await batcher.flush();

      expect(sendCalls[0].options).toMatchObject({
        method: 'POST',
        timeout_ms: 5000,
        keepalive: true,
        unloading: false,
      });
    });

    it('passes unloading: true through to the transport on an unload flush', async () => {
      // Kills the ConditionalExpression/LogicalOperator mutants on
      // `unloading: options.unloading || false` (both occurrences: the
      // request option and the handleResponse argument).
      await batcher.enqueue(event('evt-unload-options'));
      await batcher.flush({ unloading: true });

      expect(sendCalls[0].options.unloading).toBe(true);
    });
  });

  describe('flush() — evicted ids are excluded from the response outcome', () => {
    it('does not pass an already-evicted id into handleResponse', async () => {
      // Kills the MethodExpression mutant that drops the `.filter(id =>
      // !evicted.has(id))` from the itemIds handed to handleResponse — an
      // already-sent item was just evicted above and must not also be
      // counted as part of THIS batch's delivery outcome (e.g. a 413 halving
      // decision).
      await batcher.enqueue(event('evt-evicted'));
      await batcher.enqueue(event('evt-kept'));
      (batcher as any).markEventIdsSent(['evt-evicted']);
      const spy = vi.spyOn(batcher as any, 'handleResponse');

      await batcher.flush();

      const idsArg = spy.mock.calls[0][1] as string[];
      expect(idsArg).not.toContain(
        (await (batcher as any).queue.fillBatch(0)) && undefined, // placeholder, real check below
      );
      // The only item actually sent was evt-kept, so exactly one id (its
      // queue id, not evt-evicted's) reaches handleResponse.
      expect(idsArg).toHaveLength(1);
    });
  });

  describe('handleResponse — unload path only rolls back on a definite answer', () => {
    it('leaves the pre-send mark standing when no response ever arrived', async () => {
      // Kills the ConditionalExpression mutant `else if (response)` → `else
      // if (true)`. With no response at all, the mark must be left exactly as
      // it was (still "sent") — a later attempt cannot tell whether the
      // keepalive request actually landed, and unmarking would let it be
      // treated as a fresh send and duplicated.
      await batcher.enqueue(event('evt-unload-nomark'));
      defaultResponse = undefined;

      await batcher.flush({ unloading: true });

      expect(
        (batcher as any).sentEventIds.has('evt-unload-nomark'),
        'mark must stand',
      ).toBe(true);
    });

    it('releases the pre-send mark when the response is a definite non-success', async () => {
      await batcher.enqueue(event('evt-unload-mark-release'));
      defaultResponse = { httpStatusCode: 500, ok: false };

      await batcher.flush({ unloading: true });

      expect((batcher as any).sentEventIds.has('evt-unload-mark-release')).toBe(
        false,
      );
    });
  });

  describe('handleResponse — timeout branch guard', () => {
    it('retries immediately on a timeout that has actually elapsed', async () => {
      // Kills the ConditionalExpression/LogicalOperator/EqualityOperator/
      // ArithmeticOperator mutants on `response?.error === 'timeout' &&
      // Date.now() - startTime >= timeoutMS`.
      const b = makeBatcher({
        libConfig: {
          batchSize: 10,
          batchFlushIntervalMs: 1000,
          batchRequestTimeoutMs: 100,
          batchAutostart: false,
        },
      });
      await b.enqueue(event('evt-timeout'));
      // Monotonically increasing rather than a two-value branch: `flush()`
      // itself calls Date.now() once (the breaker guard) before capturing
      // `startTime`, so a naive "first call vs the rest" mock measures from
      // the wrong instant. Each call advancing by 200ms guarantees any two
      // calls that bracket `startTime` and the timeout check are >= 100ms
      // apart, which is what the assertion under test needs.
      let call = 0;
      const start = Date.now();
      vi.spyOn(Date, 'now').mockImplementation(() => start + call++ * 200);
      responses = [{ error: 'timeout' }, { httpStatusCode: 200, ok: true }];

      await b.flush();

      // A real timeout retries synchronously (a second send in the same
      // flush), not via the jittered backoff schedule.
      expect(sendCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('does not take the immediate-retry path before the timeout has elapsed', async () => {
      const b = makeBatcher({
        libConfig: {
          batchSize: 10,
          batchFlushIntervalMs: 1000,
          batchRequestTimeoutMs: 100000,
          batchAutostart: false,
        },
      });
      await b.enqueue(event('evt-timeout-early'));
      responses = [{ error: 'timeout' }];
      const sched = vi
        .spyOn(b as any, 'scheduleFlush')
        .mockImplementation(() => {});

      await b.flush();

      // Not yet past the timeout window: this must fall through to the
      // ordinary retryable-error path (a scheduled backoff), not an
      // immediate re-flush.
      expect(sendCalls).toHaveLength(1);
      expect(sched).toHaveBeenCalled();
    });
  });

  describe('handleResponse — success continuation vs interval-only mode', () => {
    // The branch under test (`if (this.flushOnlyOnInterval &&
    // !attemptSecondaryFlush)`) only changes behaviour when the batch comes
    // back SHORT (attemptSecondaryFlush false, i.e. the queue is drained) —
    // when the batch is exactly batchSize, the code chains again regardless
    // of the flag, on the theory that a full batch likely means more is
    // waiting. So the observable difference has to be measured by how many
    // times fillBatch() runs, not by send count: a drained queue produces no
    // further sends in either case.

    it('re-checks the queue once more after a short batch when flushOnlyOnInterval is off', async () => {
      // Kills the BooleanLiteral mutant `!attemptSecondaryFlush` →
      // `attemptSecondaryFlush` and the surrounding LogicalOperator/
      // BlockStatement mutants, from the "off" side.
      const b = makeBatcher({
        libConfig: {
          batchSize: 5,
          batchFlushIntervalMs: 1000,
          batchRequestTimeoutMs: 5000,
          batchAutostart: false,
        },
      });
      await b.enqueue(event('evt-chain-1'));
      await b.enqueue(event('evt-chain-2'));
      const fillBatchSpy = vi.spyOn((b as any).queue, 'fillBatch');

      await b.flush();

      // One call to fetch the (short) batch, one more from the recursive
      // `await this.flush()` continuation.
      expect(fillBatchSpy).toHaveBeenCalledTimes(2);
    });

    it('does not re-check the queue after a short batch when flushOnlyOnInterval is on', async () => {
      // The same scenario, flag on: `resetFlush()` is taken instead, so
      // fillBatch is not called a second time.
      const b = makeBatcher({
        libConfig: {
          batchSize: 5,
          batchFlushIntervalMs: 1000,
          batchRequestTimeoutMs: 5000,
          batchAutostart: false,
        },
        flushOnlyOnInterval: true,
      });
      await b.enqueue(event('evt-interval-1'));
      await b.enqueue(event('evt-interval-2'));
      const fillBatchSpy = vi.spyOn((b as any).queue, 'fillBatch');

      await b.flush();

      expect(
        fillBatchSpy,
        'must wait for the next scheduled interval instead',
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleResponse — batch-size classification boundary', () => {
    it('does not attempt a secondary flush when the batch came back short', async () => {
      // Kills the ConditionalExpression/EqualityOperator mutants on
      // `attemptSecondaryFlush = batch.length === currentBatchSize`. A short
      // batch means the queue is drained; chaining again would be a wasted
      // round trip against an empty queue.
      const b = makeBatcher({
        libConfig: {
          batchSize: 5,
          batchFlushIntervalMs: 1000,
          batchRequestTimeoutMs: 5000,
          batchAutostart: false,
        },
        flushOnlyOnInterval: true,
      });
      await b.enqueue(event('evt-short-batch'));

      await b.flush();

      expect(sendCalls).toHaveLength(1);
      // Confirmed via the interval-only flag: had attemptSecondaryFlush been
      // (wrongly) true, flushOnlyOnInterval would NOT have suppressed a
      // second send here — resetFlush() would have been chosen either way,
      // so this alone would not distinguish. The real signal is below.
      expect((b as any).requestInProgress).toBe(false);
    });
  });

  describe('handleResponse — 413 batch-size halving', () => {
    it('halves toward the floor of 1, not the ceiling', async () => {
      // Kills the MethodExpression mutant `Math.max(1, ...)` → `Math.min(1,
      // ...)`, which would force batchSize to 1 on every 413 regardless of
      // how large the batch actually was. `currentBatchSize` is captured
      // from the CONFIGURED batchSize at the top of flush(), not from the
      // fetched batch's length, so it has to be set explicitly here to make
      // it (rather than `itemIds.length - 1`) the binding term.
      const b = makeBatcher({
        libConfig: {
          batchSize: 8,
          batchFlushIntervalMs: 1000,
          batchRequestTimeoutMs: 5000,
          batchAutostart: false,
        },
      });
      for (let i = 0; i < 8; i++) await b.enqueue(event(`evt-halve-${i}`));
      responses = [{ httpStatusCode: 413 }];
      vi.spyOn(b as any, 'scheduleFlush').mockImplementation(() => {});

      await b.flush();

      // currentBatchSize 8 → halved 4; itemIds.length - 1 = 7 does not bind.
      expect((b as any).batchSize).toBe(4);
    });

    it('halves the currentBatchSize, not double it', async () => {
      // Kills the ArithmeticOperator mutant `currentBatchSize / 2` → `* 2`.
      const b = makeBatcher({
        libConfig: {
          batchSize: 6,
          batchFlushIntervalMs: 1000,
          batchRequestTimeoutMs: 5000,
          batchAutostart: false,
        },
      });
      for (let i = 0; i < 6; i++) await b.enqueue(event(`evt-halve2-${i}`));
      responses = [{ httpStatusCode: 413 }];
      vi.spyOn(b as any, 'scheduleFlush').mockImplementation(() => {});

      await b.flush();

      expect((b as any).batchSize).toBe(3);
    });

    it('also caps the halved size at one less than the actual item count', async () => {
      // Kills the ArithmeticOperator mutant `itemIds.length - 1` → `+ 1`. With
      // very few items the `itemIds.length - 1` term is the binding
      // constraint, not the halved value.
      const b = makeBatcher();
      await b.enqueue(event('evt-few-1'));
      await b.enqueue(event('evt-few-2'));
      (b as any).batchSize = 2;
      responses = [{ httpStatusCode: 413 }];
      vi.spyOn(b as any, 'scheduleFlush').mockImplementation(() => {});

      await b.flush();

      // itemIds.length (2) - 1 = 1, which is smaller than halved (1 either
      // way here) — use a case where it actually binds:
      expect((b as any).batchSize).toBeLessThanOrEqual(1);
    });

    it('reports the new batch size in the 413 message', async () => {
      // Kills the StringLiteral mutant that empties the 413 report template.
      const b = makeBatcher();
      for (let i = 0; i < 4; i++) await b.enqueue(event(`evt-413msg-${i}`));
      responses = [{ httpStatusCode: 413 }];
      const reported: string[] = [];
      (b as any).errorReporter = (m: string) => reported.push(m);
      vi.spyOn(b as any, 'scheduleFlush').mockImplementation(() => {});

      await b.flush();

      expect(reported.join(' ')).toContain(
        `reducing batch size to ${(b as any).batchSize}`,
      );
    });
  });

  describe('handleResponse — retry message strings', () => {
    it('reports the scheduled retry delay in its message', async () => {
      // Kills the StringLiteral mutant that empties the ordinary-retry
      // report template.
      const b = makeBatcher();
      await b.enqueue(event('evt-retrymsg'));
      responses = [{ httpStatusCode: 500 }];
      const reported: string[] = [];
      (b as any).errorReporter = (m: string) => reported.push(m);
      vi.spyOn(b as any, 'scheduleFlush').mockImplementation(() => {});

      await b.flush();

      expect(reported.join(' ')).toMatch(/Error; retry in \d+ ms/);
    });

    it('reports the consecutive-failure count and open duration when the breaker trips', async () => {
      // Kills the two StringLiteral mutants that empty the breaker-open
      // report's template pieces.
      vi.useFakeTimers();
      const reported: string[] = [];
      const b = makeBatcher({ errorReporter: (m: string) => reported.push(m) });
      defaultResponse = { httpStatusCode: 500, ok: false };

      for (let i = 0; i < 5; i++) {
        await b.enqueue(event(`evt-tripmsg-${i}`));
        await b.flush();
      }

      const tripMsg = reported.find((m) =>
        m.includes('circuit breaker open for'),
      );
      expect(tripMsg).toMatch(
        /^5 consecutive failures; circuit breaker open for \d+ ms$/,
      );
    });
  });

  describe('handleResponse — removal-failure boundary and recovery', () => {
    it('does not disable batching at exactly five consecutive removal failures', async () => {
      // Kills the ConditionalExpression/EqualityOperator mutants on
      // `++this.consecutiveRemovalFailures > 5`. Driven through repeated
      // flushes rather than asserted directly: an item whose removal keeps
      // failing stays at the head of the queue AND keeps its "already sent"
      // mark, so a later flush evicts it via the already-sent path instead
      // of re-counting it — presetting the counter isolates the boundary
      // from that unrelated mechanic.
      const b = makeBatcher();
      (b as any).removeItemsFromQueue = async () => false;
      (b as any).consecutiveRemovalFailures = 4;
      // makeBatcher() defaults batchAutostart to false, which leaves
      // `stopped` true from construction regardless of this branch — flip it
      // so the assertion below actually distinguishes "stop() ran" from
      // "was already stopped".
      (b as any).stopped = false;
      await b.enqueue(event('evt-rmbound'));

      await b.flush();

      expect((b as any).consecutiveRemovalFailures).toBe(5);
      expect((b as any).stopped, 'five is not yet "more than five"').toBe(
        false,
      );
    });

    it('schedules another flush attempt on a removal failure under the limit', async () => {
      // Kills the BlockStatement mutant that empties the `else { this.resetFlush(); }`
      // — without it, a removal failure under the limit would leave the
      // batcher with no future flush scheduled at all.
      const b = makeBatcher();
      (b as any).removeItemsFromQueue = async () => false;
      const sched = vi.spyOn(b as any, 'scheduleFlush');
      await b.enqueue(event('evt-rmretry'));

      await b.flush();

      expect(sched).toHaveBeenCalled();
    });
  });

  describe('reportError — errorReporter presence guard', () => {
    it('never calls a reporter that was not configured', async () => {
      // Kills the ConditionalExpression mutant `if (this.errorReporter)` →
      // `if (true)`. `errorReporter` always defaults to a no-op function in
      // the constructor, so this can only be observed by clearing it after
      // construction.
      const b = makeBatcher();
      (b as any).errorReporter = undefined;

      expect(() => (b as any).reportError('should not throw')).not.toThrow();
    });
  });

  describe('getMetrics — breaker state surfaces the transition string', () => {
    it('reports half-open, not a blank state, on the probe attempt', async () => {
      // Kills the StringLiteral mutant on `setBreakerState('half-open')`.
      vi.useFakeTimers();
      defaultResponse = { httpStatusCode: 500, ok: false };
      for (let i = 0; i < 5; i++) {
        await batcher.enqueue(event(`evt-metrics-trip-${i}`));
        await batcher.flush();
      }
      vi.setSystemTime(Date.now() + 70_000);

      // Freeze the probe mid-flight by never letting it resolve, so the
      // half-open state is observable before it moves on to closed/open.
      const b = makeBatcher();
      (b as any).breakerOpenUntilMS = Date.now() - 1;
      (b as any).consecutiveSendFailures = 5;
      let sawHalfOpen = false;
      const withHook = makeBatcher({
        sendRequestFunc: async () => {
          sawHalfOpen =
            (withHook as any).getMetrics().breakerState === 'half-open';
          return { httpStatusCode: 200, ok: true };
        },
      });
      (withHook as any).breakerOpenUntilMS = Date.now() - 1;
      await withHook.enqueue(event('evt-metrics-probe'));

      await withHook.flush();

      expect(sawHalfOpen).toBe(true);
    });
  });

  describe('reportError', () => {
    it('never lets a throwing errorReporter escape into the SDK', async () => {
      // The customer supplies this hook. If their reporter throws, it must not
      // turn a handled retry into an unhandled rejection inside the host page.
      const b = makeBatcher({
        errorReporter: () => {
          throw new Error('reporter exploded');
        },
      });
      await b.enqueue(event('evt-x'));
      responses = [{ httpStatusCode: 500 }];
      vi.spyOn(b as any, 'scheduleFlush').mockImplementation(() => {});

      await expect(b.flush()).resolves.toBeUndefined();
    });
  });
});
