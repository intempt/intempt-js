import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SdkMetrics } from '../../src/shared/logger/metrics.ts';
import { configureLogger, DiagnosticRecord, resetLogger } from '../../src/shared/logger/logger.ts';
import { RequestBatcher } from '../../src/shared/queue/requestBatcher.ts';
import { QueueStorage } from '../../src/shared/storage/queueStorage.ts';
import { RequestQueue } from '../../src/shared/queue/requestQueue.ts';
import { EnvConfig } from '../../src/shared/envConfig.ts';

/**
 * Tests for the internal metrics, and for the batcher wiring that feeds them.
 *
 * The load-shedding work gave the SDK the ability to survive an outage by
 * deliberately dropping events and deliberately stopping sending. Both are
 * correct and both were **invisible**: `getDroppedEventCount()` shipped with the
 * queue cap and had no consumer at all, and the circuit breaker opened and closed
 * without leaving a trace. "Bounded loss with a number attached" is only worth
 * something if the number can be read, so these tests assert that it can — from
 * the batcher's public surface, not from its internals.
 *
 * Two design properties are asserted deliberately, because both are the kind of
 * thing a later change would quietly undo:
 *
 *  - **Depth and drop count are sampled, not pushed.** They already live in
 *    `RequestQueue`; copying them on every enqueue would put O(1)-per-event work
 *    back on the hot path that per-event storage records exist to keep clear.
 *  - **Breaker transitions only count edges.** `closeCircuit()` runs on every
 *    successful delivery, so a transition counter that moved on every call would
 *    report thousands of "outages" on a healthy page and be worthless.
 */

const KEY = '__unit_metrics_batcher__';

function event(eventId: string) {
  return { name: 'Test Event', payload: [{ eventId, sessionId: 's', profileId: 'p' }] };
}

describe('SdkMetrics', () => {
  /** Keep the suite's own output clean; the console channel has its own tests. */
  function muteConsole() {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  }

  beforeEach(() => {
    resetLogger();
    muteConsole();
  });

  afterEach(() => {
    resetLogger();
    EnvConfig.reset();
  });

  describe('snapshot', () => {
    it('starts empty, with latency null rather than zero', () => {
      const snapshot = new SdkMetrics('Test').snapshot();

      // null and 0 mean different things to whoever reads this: "no flush has
      // happened" versus "flushes are instant".
      expect(snapshot).toEqual({
        queueDepth: 0,
        droppedEvents: 0,
        flushCount: 0,
        flushFailureCount: 0,
        lastFlushLatencyMs: null,
        avgFlushLatencyMs: null,
        breakerState: 'closed',
        breakerTransitions: 0,
      });
    });

    it('samples depth and drops at read time, not at record time', () => {
      let depth = 0;
      let dropped = 0;
      const metrics = new SdkMetrics('Test', {
        queueDepth: () => depth,
        droppedEvents: () => dropped,
      });

      expect(metrics.snapshot().queueDepth).toBe(0);
      depth = 7;
      dropped = 3;

      // Sampling is what keeps these metrics off the per-event hot path: nothing
      // was notified of the change, and the next read still tells the truth.
      expect(metrics.snapshot().queueDepth).toBe(7);
      expect(metrics.snapshot().droppedEvents).toBe(3);
    });

    it('returns a copy, so a held snapshot cannot mutate under the reader', () => {
      const metrics = new SdkMetrics('Test');
      const first = metrics.snapshot();

      metrics.recordFlush(10);

      expect(first.flushCount).toBe(0);
      expect(metrics.snapshot().flushCount).toBe(1);
    });
  });

  describe('flush latency', () => {
    it('tracks the last value and the mean across attempts', () => {
      const metrics = new SdkMetrics('Test');

      metrics.recordFlush(100);
      metrics.recordFlush(200);
      metrics.recordFlush(303);

      const snapshot = metrics.snapshot();
      expect(snapshot.flushCount).toBe(3);
      expect(snapshot.lastFlushLatencyMs).toBe(303);
      // A running total, not a sample array: an unbounded list of samples on a
      // tab left open for days is the leak this codebase has already fixed twice.
      expect(snapshot.avgFlushLatencyMs).toBe(201);
    });

    it('counts a failed attempt as an attempt, and as a failure', () => {
      const metrics = new SdkMetrics('Test');

      metrics.recordFlush(50, true);

      const snapshot = metrics.snapshot();
      expect(snapshot.flushCount).toBe(1);
      expect(snapshot.flushFailureCount).toBe(1);
      // Latency is still meaningful — a failure that took 50 ms is different from
      // one that took 90 s against the request timeout.
      expect(snapshot.lastFlushLatencyMs).toBe(50);
    });

    it('can be marked failed after the fact without double-counting the attempt', () => {
      const metrics = new SdkMetrics('Test');

      // The batcher learns the latency when the transport returns but only learns
      // the batch was rejected later, from response classification.
      metrics.recordFlush(20);
      metrics.markFlushFailed();

      expect(metrics.snapshot()).toMatchObject({ flushCount: 1, flushFailureCount: 1 });
    });
  });

  describe('breaker state transitions', () => {
    it('counts edges only, so a healthy page reports no transitions', () => {
      const metrics = new SdkMetrics('Test');

      // closeCircuit() runs on every successful delivery.
      for (let i = 0; i < 50; i++) {
        metrics.setBreakerState('closed');
      }

      expect(metrics.snapshot().breakerTransitions).toBe(0);
    });

    it('records the full open -> half-open -> closed recovery', () => {
      const metrics = new SdkMetrics('Test');

      metrics.setBreakerState('open');
      expect(metrics.getBreakerState()).toBe('open');
      metrics.setBreakerState('half-open');
      metrics.setBreakerState('closed');

      const snapshot = metrics.snapshot();
      expect(snapshot.breakerState).toBe('closed');
      // Non-zero is the signal that an outage happened at all — the state alone
      // looks identical to a page that never had a problem.
      expect(snapshot.breakerTransitions).toBe(3);
    });

    it('emits each transition through the logger, at a level matching its severity', () => {
      const received: DiagnosticRecord[] = [];
      configureLogger({ debug: true, sink: r => received.push(r) });
      const metrics = new SdkMetrics('RequestBatcher');

      metrics.setBreakerState('open');
      metrics.setBreakerState('closed');

      // "Stopped sending" is a warning; recovery is informational. And the scope
      // is the batcher's, so a telemetry backend groups it with the rest of the
      // delivery pipeline rather than under a separate "metrics" subsystem.
      expect(received.map(r => [r.level, r.scope, r.message])).toEqual([
        ['warn', 'RequestBatcher', 'circuit breaker closed -> open'],
        ['info', 'RequestBatcher', 'circuit breaker open -> closed'],
      ]);
    });

    it('does not log a no-op transition', () => {
      const received: DiagnosticRecord[] = [];
      configureLogger({ debug: true, sink: r => received.push(r) });
      const metrics = new SdkMetrics('Test');

      metrics.setBreakerState('closed');

      expect(received).toEqual([]);
    });
  });
});

describe('RequestQueue depth gauge', () => {
  it('reports pending events without listing storage keys', async () => {
    const queue = new RequestQueue(KEY, { usePersistence: false });

    expect(queue.getQueueDepth()).toBe(0);
    await queue.enqueue({ event: 'a' }, 1000);
    await queue.enqueue({ event: 'b' }, 1000);

    // The in-memory view, deliberately: an exact count means an O(N) key scan per
    // read, which is the cost the per-event layout exists to avoid.
    expect(queue.getQueueDepth()).toBe(2);
  });
});

describe('RequestBatcher metrics wiring', () => {
  let sendCalls: any[];
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
      sendRequestFunc: async (data: any[], options: any) => {
        sendCalls.push({ data, options });
        return defaultResponse;
      },
      usePersistence: true,
      queueStorage: new QueueStorage(),
      ...overrides,
    });
  }

  /** Keep the suite's own output clean; the console channel has its own tests. */
  function muteConsole() {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  }

  beforeEach(() => {
    localStorage.clear();
    resetLogger();
    muteConsole();
    sendCalls = [];
    defaultResponse = { httpStatusCode: 200, ok: true };
    batcher = makeBatcher();
  });

  afterEach(() => {
    resetLogger();
    EnvConfig.reset();
  });

  it('exposes queue depth for events waiting to be sent', async () => {
    await batcher.enqueue(event('evt-depth-1'));
    await batcher.enqueue(event('evt-depth-2'));

    expect(batcher.getMetrics().queueDepth).toBe(2);
  });

  it('gives the queue cap drop counter a consumer at last', async () => {
    const capped = makeBatcher({ libConfig: {
      batchSize: 10,
      batchFlushIntervalMs: 1000,
      batchRequestTimeoutMs: 5000,
      batchAutostart: false,
      maxQueuedEvents: 2,
    } });

    for (let i = 0; i < 5; i++) {
      await capped.enqueue(event(`evt-drop-${i}`));
    }

    // The number the cap was built to produce. It existed with nowhere to go
    // until this snapshot; a non-zero value here is real, bounded data loss.
    expect(capped.getDroppedEventCount()).toBeGreaterThan(0);
    expect(capped.getMetrics().droppedEvents).toBe(capped.getDroppedEventCount());
  });

  it('records a completed send as one flush with a latency', async () => {
    await batcher.enqueue(event('evt-latency'));
    await batcher.flush();

    const snapshot = batcher.getMetrics();
    expect(snapshot.flushCount).toBe(1);
    expect(snapshot.flushFailureCount).toBe(0);
    expect(snapshot.lastFlushLatencyMs).not.toBeNull();
    expect(snapshot.lastFlushLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('counts a rejected batch as a failed flush, not a successful one', async () => {
    defaultResponse = { httpStatusCode: 503, ok: false };
    vi.useFakeTimers();

    await batcher.enqueue(event('evt-5xx'));
    await batcher.flush();

    // A fast 503 is still a failure: latency alone cannot distinguish "ingest is
    // healthy" from "ingest is refusing everything quickly".
    expect(batcher.getMetrics()).toMatchObject({ flushCount: 1, flushFailureCount: 1 });
  });

  it('surfaces the breaker opening, which was previously untraceable', async () => {
    vi.useFakeTimers();
    defaultResponse = { httpStatusCode: 500, ok: false };

    for (let i = 0; i < 5; i++) {
      await batcher.enqueue(event(`evt-open-${i}`));
      await batcher.flush();
    }

    const snapshot = batcher.getMetrics();
    expect(snapshot.breakerState).toBe('open');
    expect(snapshot.breakerTransitions).toBe(1);
    // The events are still queued, not lost — the breaker stops sending, and the
    // metrics are how anyone finds out that is why nothing is arriving.
    expect(snapshot.queueDepth).toBeGreaterThan(0);
  });

  it('records the half-open probe and the close that follows a recovery', async () => {
    vi.useFakeTimers();
    defaultResponse = { httpStatusCode: 500, ok: false };
    for (let i = 0; i < 5; i++) {
      await batcher.enqueue(event(`evt-recover-${i}`));
      await batcher.flush();
    }
    expect(batcher.getMetrics().breakerState).toBe('open');

    // Let the open window expire, then answer the probe successfully.
    vi.setSystemTime(Date.now() + 120_000);
    defaultResponse = { httpStatusCode: 200, ok: true };
    await batcher.flush();

    const snapshot = batcher.getMetrics();
    expect(snapshot.breakerState).toBe('closed');
    // closed -> open -> half-open -> closed. Three edges, so a support engineer
    // can tell one outage from a service that is flapping.
    expect(snapshot.breakerTransitions).toBe(3);
  });

  it('reports batcher failures through the logger as well as the errorReporter', async () => {
    const reported: string[] = [];
    const received: DiagnosticRecord[] = [];
    configureLogger({ debug: true, sink: r => received.push(r) });
    vi.useFakeTimers();

    const wired = makeBatcher({ errorReporter: (msg: string) => reported.push(msg) });
    (wired as any).sendRequest = async () => {
      throw new Error('transport exploded');
    };
    await wired.enqueue(event('evt-both-channels'));
    await wired.flush();

    // Both channels, deliberately: the errorReporter is a per-instance hook its
    // owner wired, the logger is the global one a customer can subscribe to. The
    // logger replaced only the console.error that used to sit alongside it.
    expect(reported.join(' ')).toContain('Error flushing request queue');
    expect(received.filter(r => r.scope === 'RequestBatcher').map(r => r.message))
      .toContain('Error flushing request queue');
  });
});
