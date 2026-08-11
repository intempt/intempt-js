import { createLogger, ScopedLogger } from './logger.ts';

/**
 * Internal metrics for the delivery pipeline.
 *
 * ## Why
 *
 * The load-shedding work (jittered retries, circuit breaker, bounded queue) gave
 * the SDK the ability to *survive* an outage by deliberately throwing events
 * away and deliberately stopping sending. Both are correct, and both are
 * invisible: `getDroppedEventCount()` was added with the drop policy and had
 * nowhere to send its number, and the breaker opens and closes with no record
 * that it ever happened. "Bounded loss with a number attached" is only worth
 * anything if somebody can read the number.
 *
 * So this holds the four things a support engineer actually asks for:
 *
 *  - **queue depth** — is the backlog draining or growing?
 *  - **flush latency** — is ingest slow, or is the client idle?
 *  - **drop count** — did we lose events, and how many?
 *  - **breaker transitions** — did we stop sending, and how often?
 *
 * ## Two different kinds of metric, handled differently
 *
 * Depth and drop count are **derived**: they already live in `RequestQueue`, so
 * copying them on every enqueue would add per-event work to the hot path that
 * the per-event storage layout exists to remove. They are read through provider
 * callbacks at snapshot time instead — sampling costs nothing until somebody
 * looks.
 *
 * Latency and breaker transitions are **events**: they have no other home, so
 * they are accumulated here. Accumulation is O(1) per flush (a running total,
 * not a list of samples) because an unbounded sample array on a tab left open
 * for days is the same leak this codebase has already fixed twice.
 */

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface MetricsSnapshot {
  /** Events currently pending delivery. */
  queueDepth: number;
  /** Events discarded by the queue cap since this page loaded. */
  droppedEvents: number;
  /** Completed send attempts (successful or not) since this page loaded. */
  flushCount: number;
  /** Of those, how many failed to reach ingest. */
  flushFailureCount: number;
  /** Duration of the most recent send attempt, or `null` if none yet. */
  lastFlushLatencyMs: number | null;
  /** Mean of all send attempts, or `null` if none yet. Rounded to a whole ms. */
  avgFlushLatencyMs: number | null;
  breakerState: BreakerState;
  /** How many times the breaker changed state. Non-zero means a real outage. */
  breakerTransitions: number;
}

export interface MetricsProviders {
  queueDepth?: () => number;
  droppedEvents?: () => number;
}

export class SdkMetrics {
  private readonly log: ScopedLogger;
  private readonly providers: MetricsProviders;

  private flushCount = 0;
  private flushFailureCount = 0;
  private lastFlushLatencyMs: number | null = null;
  private totalFlushLatencyMs = 0;
  private breakerState: BreakerState = 'closed';
  private breakerTransitions = 0;

  constructor(scope: string, providers: MetricsProviders = {}) {
    this.log = createLogger(scope);
    this.providers = providers;
  }

  /**
   * Record a completed send attempt.
   *
   * `failed` is the transport's verdict, not an HTTP classification — the
   * batcher owns that distinction and this only counts what it is told.
   */
  recordFlush(latencyMs: number, failed = false): void {
    this.flushCount++;
    if (failed) {
      this.flushFailureCount++;
    }
    this.lastFlushLatencyMs = latencyMs;
    this.totalFlushLatencyMs += latencyMs;
    // Deliberately does NOT log. This runs on every send, so a line here would be
    // the SDK's highest-frequency log call and its message template would be
    // shipped bytes, in exchange for information `snapshot()` already reports
    // more usefully as a mean. Transitions get logged; steady state gets counted.
  }

  /**
   * Mark the most recent attempt as failed.
   *
   * Separate from `recordFlush` because the two facts become known at different
   * moments: the batcher learns the *latency* when the transport returns, but
   * whether the batch was actually ingested is decided later, by response
   * classification (a 503 is a fast, failed flush). Counting it in one call
   * would mean either guessing early or double-counting the attempt.
   */
  markFlushFailed(): void {
    this.flushFailureCount++;
  }

  getBreakerState(): BreakerState {
    return this.breakerState;
  }

  /**
   * Record a breaker state change, and log it.
   *
   * Idempotent: setting the current state is a no-op, so callers can assert the
   * state unconditionally (`closeCircuit()` runs on every successful delivery)
   * without inflating the transition count or spamming the log. The transition
   * count is what tells you an outage happened at all, so it must only move on
   * a real edge.
   *
   * `open` logs at `warn` because it means the SDK has stopped sending; the
   * other two are recovery steps and log at `info`.
   */
  setBreakerState(state: BreakerState): void {
    if (state === this.breakerState) {
      return;
    }
    const previous = this.breakerState;
    this.breakerState = state;
    this.breakerTransitions++;
    const message = `circuit breaker ${previous} -> ${state}`;
    if (state === 'open') {
      this.log.warn(message);
    } else {
      this.log.info(message);
    }
  }

  /**
   * A point-in-time copy. A plain object rather than a live view, so a caller
   * cannot hold a reference that mutates under them mid-report.
   */
  snapshot(): MetricsSnapshot {
    return {
      queueDepth: this.providers.queueDepth ? this.providers.queueDepth() : 0,
      droppedEvents: this.providers.droppedEvents ? this.providers.droppedEvents() : 0,
      flushCount: this.flushCount,
      flushFailureCount: this.flushFailureCount,
      lastFlushLatencyMs: this.lastFlushLatencyMs,
      avgFlushLatencyMs: this.flushCount
        ? Math.round(this.totalFlushLatencyMs / this.flushCount)
        : null,
      breakerState: this.breakerState,
      breakerTransitions: this.breakerTransitions,
    };
  }
}
