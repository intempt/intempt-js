import { QueueEntry, RequestQueue } from './requestQueue.ts';
import { QueueStorageLike } from '../storage/queueStorage.ts';
import { createLogger } from '../logger/logger.ts';
import { MetricsSnapshot, SdkMetrics } from '../logger/metrics.ts';

export interface BatcherConfig {
  batchSize: number;
  batchFlushIntervalMs: number;
  batchRequestTimeoutMs: number;
  batchAutostart: boolean;
  /**
   * Cap on events held in the queue before the oldest are dropped. Optional;
   * `RequestQueue` applies its own default (10,000) when this is absent.
   *
   * This was reachable only by constructing a `RequestQueue` directly until a
   * mutation-driven test tried to configure it through the batcher and found the
   * option was never threaded through — so the "overridable" cap documented in
   * CHECKPOINT.md §3c was not overridable from the SDK's only entry point.
   */
  maxQueuedEvents?: number;
}

/**
 * What `sendRequestFunc` is called with. Lives here rather than in the transport
 * that implements it, because this is the batcher's contract — the transport is one
 * implementation of it, and the tests are another.
 */
export interface BatchSendOptions {
  method?: string;
  unloading?: boolean;
  keepalive?: boolean;
  timeout_ms?: number;
}

/**
 * What a send reports back. **Every field is optional and the whole result may be
 * `null`**, which is the point: `null` means the transport never delivered at all,
 * and that is a different outcome from any HTTP status. The retry classification
 * (`isRetryableFailure`) depends on being able to tell those apart — under `any`
 * they were indistinguishable, and a missing `httpStatusCode` read as `undefined`
 * silently took the "not retryable" branch.
 */
export interface BatchSendResult {
  httpStatusCode?: number;
  ok?: boolean;
  retryAfter?: string;
  error?: string;
}

export interface RequestBatcherOptions {
  storageKey: string;
  libConfig: BatcherConfig;
  sendRequestFunc: (
    data: unknown[],
    options: BatchSendOptions,
  ) => Promise<BatchSendResult | null>;
  errorReporter?: (msg: string, err?: unknown) => void;
  /**
   * May return a falsy value to drop the event — the flush loop checks the result
   * before queuing it for the request.
   */
  beforeSendHook?: (payload: unknown) => unknown;
  queueStorage?: QueueStorageLike;
  sharedLockStorage?: Storage;
  usePersistence?: boolean;
  flushOnlyOnInterval?: boolean;
}

const MAX_RETRY_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Full jitter: wait a uniformly random time in [0, ceiling) rather than exactly
 * `ceiling`. AWS Architecture Blog formulation ("Exponential Backoff And Jitter").
 *
 * Deterministic backoff synchronises the fleet. Every client that failed at the
 * same instant retries at the same instant, and stays in phase forever after
 * because they all run the same doubling schedule. That converts a brief ingest
 * wobble into a self-reinforcing thundering herd: the same retry load, delivered
 * as narrow spikes instead of spread out, each spike large enough to re-break
 * ingest just as it recovers. At 1-10M concurrent sessions the SDK becomes the
 * amplifier. Jitter does not change how often a client retries — only that
 * clients stop retrying *together*.
 *
 * Full jitter (vs equal jitter, `ceiling/2 + random(0, ceiling/2)`) gives the
 * widest spread and the lowest expected contention. Its usual objection — that a
 * client may retry almost immediately — does not apply here: `flush()` cannot
 * start while `requestInProgress` is true, which already supplies a floor.
 *
 * `Math.random` is deliberate. This is load spreading, not security. `generateId`
 * uses `crypto.getRandomValues` for an unrelated reason (id collisions, D19) —
 * do not "make them consistent".
 */
function fullJitter(ceilingMS: number): number {
  return Math.floor(Math.random() * ceilingMS);
}

/** +/-10% spread applied to the steady-state flush interval. */
const FLUSH_JITTER_RATIO = 0.1;

/**
 * Circuit breaker. Consecutive failed sends before we stop attempting entirely,
 * and how long we then stay stopped before probing.
 *
 * Jitter spreads retries across the fleet but does not reduce how many a client
 * makes: against an ingest tier that is genuinely down, every client keeps
 * knocking indefinitely, and the moment ingest recovers is exactly when the
 * accumulated backlog hits it hardest. The breaker adds the missing behaviour —
 * conclude the service is down, stop, and test recovery with a single probe
 * rather than the whole queue.
 *
 * 5 failures spans roughly a minute or two under the jittered backoff: long
 * enough that a transient blip does not trip it, short enough to stop wasting
 * attempts early in a real outage. The 60s open window is itself jittered, so
 * probes do not arrive as a synchronised wave — a breaker that reopened every
 * client at the same instant would recreate the herd it exists to prevent.
 */
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_OPEN_MS = 60 * 1000;

/**
 * Spread the *steady-state* flush interval across a narrow band around its
 * configured value.
 *
 * `fullJitter` above handles the incident path. This handles normal operation,
 * which has the same synchronisation flaw for a different reason: the flush
 * timer is fixed, so clients that started together flush together, permanently —
 * nothing ever pulls them apart. The realistic trigger is a cohort landing at
 * once (a CDN purge, a deploy, an email blast putting 200k people on the site
 * inside a minute); that cohort then produces periodic spikes at every interval
 * boundary with no incident anywhere.
 *
 * A narrow band, not full jitter: this path is not a failure response, and the
 * configured interval is a batching-latency contract the customer set. +/-10%
 * smears a cohort apart within a few cycles while keeping delivery latency
 * essentially what was asked for. Full jitter here would halve effective
 * throughput on average and make batch sizes erratic.
 */
function jitterAroundBase(baseMS: number): number {
  const spread = baseMS * FLUSH_JITTER_RATIO;
  return Math.round(baseMS - spread + Math.random() * spread * 2);
}

/**
 * Hard caps on the two client-side dedupe structures.
 *
 * Both are unbounded-growth hazards on a long-lived tab (a dashboard left open
 * for days, or any single-page app), which is exactly the highest-volume
 * customer. The caps are backstops — the primary control is pruning entries the
 * moment they can no longer influence a decision.
 */
const MAX_TRACKED_ITEM_IDS = 1000;
const MAX_SENT_EVENT_IDS = 1000;

/**
 * Manages batching, flushing, and retrying of tracking requests
 */
/** One queue item, ready for the request. */
interface BuiltItem {
  id: string;
  payload: unknown;
  eventIds: string[];
}

/** What `buildBatch` makes of a list of queue items. */
interface BuiltBatch {
  /** What goes into the request, in queue order. */
  items: BuiltItem[];
  /** Already delivered: evict from the queue. */
  alreadySentItemIds: string[];
  /** Neither sent nor to be dequeued on this request's success. */
  excludedFromOutcome: Set<string>;
}

/** How `dispatch` sends one batch and applies its outcome. */
interface SendContext {
  /** An unload send: does not own the flush schedule, never continues. */
  unloading: boolean;
  /** Queue items this request's success dequeues. */
  outcomeItemIds: string[];
  attemptSecondaryFlush: boolean;
  /** Batch size the request was built with, for a 413 halving. */
  currentBatchSize: number;
  startTime: number;
  timeoutMS: number;
}

export interface FlushOptions {
  /** Send synchronously, for an unload or a Leave Page (`flushUnload`). */
  unloading?: boolean;
  /**
   * The page is going away (`beforeunload`, a non-bfcache `pagehide`), so the
   * unload send bypasses the breaker. Ignored without `unloading`.
   */
  terminal?: boolean;
}

/**
 * Most requests one unload send makes. Each is one batch, newest first, so the
 * Leave Page is always in the first; what is older than these stays queued
 * for the next flush or the next load.
 */
const MAX_UNLOAD_REQUESTS = 4;

/**
 * How long an item handed to an unload request is left out of every later
 * send, on this page and on the next one (INT-5942).
 *
 * A page that navigates away rarely sees its unload request answered: the
 * document is torn down first, and the persisted queue still holds the items
 * when the next page of the same site loads and flushes it. The next page
 * cannot tell "on the wire from the previous page" from "never sent", so the
 * unload send records when it handed each item over (`unloadSentKey`) and
 * every send skips an item for this long after that. An item still queued
 * once the window has passed is sent again, unless its eventId says it was
 * delivered: the window delays a retry, it never cancels one.
 */
const UNLOAD_SENT_GRACE_MS = 30 * 1000;

export class RequestBatcher {
  private queue: RequestQueue;
  private libConfig: BatcherConfig;
  private sendRequest: (
    data: unknown[],
    options: BatchSendOptions,
  ) => Promise<BatchSendResult | null>;
  private beforeSendHook?: (payload: unknown) => unknown;
  private errorReporter: (msg: string, err?: unknown) => void;
  private flushOnlyOnInterval: boolean;
  private readonly log = createLogger('RequestBatcher');
  /**
   * Pipeline metrics. Per-instance rather than a module singleton: the batcher is
   * effectively a singleton in a real page but is constructed many times in the
   * test tier, and shared counters would leak state between suites.
   */
  private readonly metrics: SdkMetrics;

  private batchSize: number;
  private flushInterval: number;
  private stopped: boolean;
  /**
   * Deterministic exponential ceiling for the retry backoff, tracked separately
   * from `flushInterval` on purpose.
   *
   * `scheduleFlush()` assigns `flushInterval = flushMS`, so the doubling used to
   * ride on the scheduled delay itself. Feeding it a *jittered* delay would make
   * the next ceiling double from that random draw instead of from the true
   * schedule — a short draw would collapse the backoff and the fleet would creep
   * back toward hammering, which is the failure this change exists to prevent.
   * So the ceiling doubles deterministically here and only the sleep is jittered.
   *
   * 0 means "not currently backing off"; reset by `resetFlush()`.
   */
  private retryCeilingMS: number = 0;
  private requestInProgress: boolean = false;
  /**
   * Queue item ids whose request is on the wire, from either a regular flush or
   * an unload send. An unload send skips them, and a regular flush neither
   * re-sends nor evicts them, so one event is never in two requests at once.
   */
  private inFlightItemIds: Set<string> = new Set();
  /**
   * A terminal unload (`beforeunload`, non-bfcache `pagehide`) has started and
   * the page has not been seen live since. Unload sends bypass the breaker
   * while it is set. See `flushUnload`.
   */
  private pageTerminating: boolean = false;
  private timeoutID: number | null = null;
  private consecutiveRemovalFailures: number = 0;
  /**
   * Circuit breaker state. Per-tab and in memory by deliberate choice: a shared
   * breaker would need persisted state, a staleness policy and cross-tab race
   * handling, right after per-event queue records got `SharedLock` off the hot
   * path. A multi-tab user sends a few more probes; that is nothing against the
   * fleet-wide reduction.
   *
   * `consecutiveSendFailures` counts *delivery* failures only — it is unrelated
   * to `consecutiveRemovalFailures` above, which counts local queue-removal
   * failures and disables batching outright.
   *
   * `breakerOpenUntilMS` of 0 means closed. When it is in the future the breaker
   * is open and `flush()` sends nothing; the first flush after it passes is the
   * half-open probe, which either closes the breaker or reopens it.
   */
  private consecutiveSendFailures: number = 0;
  private breakerOpenUntilMS: number = 0;
  private itemIdsSentSuccessfully: Map<string, number> = new Map();
  private sentEventIds: Set<string> = new Set();
  private sentEventIdsKey: string;
  /**
   * localStorage key of the queue items handed to an unload request, as
   * `{ [queueItemId]: handedOverAtMs }`. Keyed by queue item, not eventId, so
   * a payload without an eventId is covered too. Read fresh by every send,
   * because the page that wrote it may still be unloading while this one
   * loads. See `UNLOAD_SENT_GRACE_MS`.
   */
  private unloadSentKey: string;
  /**
   * Items whose send failed at the transport (no HTTP answer) while the page
   * was going away, with their eventIds. That failure is usually the
   * teardown itself, not the request: the browser keeps a keepalive request
   * going after the document is gone, and the page sees it rejected. So the
   * pre-send marks stand. If the page turns out to stay (`pageResumed`, or a
   * regular flush), it was a real failure, and these are released for retry.
   */
  private unknownOutcomes: Array<{ itemIds: string[]; eventIds: string[] }> =
    [];

  constructor(options: RequestBatcherOptions) {
    this.libConfig = options.libConfig;
    this.sendRequest = options.sendRequestFunc;
    this.beforeSendHook = options.beforeSendHook;
    this.errorReporter = options.errorReporter || (() => {});
    this.flushOnlyOnInterval = options.flushOnlyOnInterval || false;

    this.batchSize = this.libConfig.batchSize;
    this.flushInterval = this.libConfig.batchFlushIntervalMs;
    this.stopped = !this.libConfig.batchAutostart;

    // Initialize sent event IDs tracking
    this.sentEventIdsKey = `${options.storageKey}_sent_event_ids`;
    this.unloadSentKey = `${options.storageKey}_unload_sent`;
    this.loadSentEventIds();

    // The providers are lazy, so referencing `this.queue` before it is assigned
    // below is fine — they are only called from `snapshot()`.
    this.metrics = new SdkMetrics('RequestBatcher', {
      queueDepth: () => this.queue.getQueueDepth(),
      droppedEvents: () => this.queue.getDroppedEventCount(),
    });

    this.queue = new RequestQueue(options.storageKey, {
      usePersistence: options.usePersistence,
      queueStorage: options.queueStorage,
      sharedLockStorage: options.sharedLockStorage,
      maxQueuedEvents: options.libConfig.maxQueuedEvents,
      errorReporter: this.reportError.bind(this),
    });
  }

  async enqueue(item: unknown): Promise<boolean> {
    return this.queue.enqueue(item, this.flushInterval);
  }

  start(): Promise<void> {
    this.stopped = false;
    this.consecutiveRemovalFailures = 0;
    return this.flush();
  }

  stop(): void {
    this.stopped = true;
    if (this.timeoutID) {
      clearTimeout(this.timeoutID);
      this.timeoutID = null;
    }
  }

  async clear(): Promise<void> {
    return this.queue.clear();
  }

  /**
   * Events dropped by the queue cap since this page loaded.
   *
   * Non-zero means real, bounded data loss — an outage long enough to overflow
   * the queue, or a runaway tracking loop. Also reported through `errorReporter`
   * as the drops happen, and included in `getMetrics()`.
   */
  getDroppedEventCount(): number {
    return this.queue.getDroppedEventCount();
  }

  /**
   * Readable snapshot of the delivery pipeline: depth, latency, drops, breaker.
   *
   * This is the consumer the drop counter was waiting for. Reached from the
   * public API as `intempt.getDiagnostics()`, so a support case can be answered
   * with numbers from the customer's own page instead of a guess.
   */
  getMetrics(): MetricsSnapshot {
    return this.metrics.snapshot();
  }

  private scheduleFlush(flushMS: number): void {
    this.flushInterval = flushMS;
    if (!this.stopped) {
      if (this.timeoutID) {
        clearTimeout(this.timeoutID);
      }
      this.timeoutID = window.setTimeout(() => {
        if (!this.stopped) {
          this.flush();
        }
      }, this.flushInterval);
    }
  }

  /**
   * Return the breaker to closed after a confirmed delivery.
   *
   * Only a real delivery clears this. A 400 or 413 deliberately does not touch
   * the counter in either direction: those mean ingest is up and rejecting a
   * specific payload, which is neither evidence of an outage nor evidence of
   * recovery.
   */
  private closeCircuit(): void {
    this.consecutiveSendFailures = 0;
    this.breakerOpenUntilMS = 0;
    // Observation only. `setBreakerState` ignores a no-change call, so the
    // common case (every successful delivery) neither logs nor counts.
    this.metrics.setBreakerState('closed');
  }

  private resetFlush(): void {
    // Leaving the backoff ceiling set here would make a later, unrelated failure
    // resume from the previous incident's ceiling instead of from the base
    // interval.
    this.retryCeilingMS = 0;
    this.scheduleFlush(jitterAroundBase(this.libConfig.batchFlushIntervalMs));
  }

  private resetBatchSize(): void {
    this.batchSize = this.libConfig.batchSize;
  }

  /**
   * Load sent event IDs from localStorage
   */
  private loadSentEventIds(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = localStorage.getItem(this.sentEventIdsKey);
        if (stored) {
          const ids = JSON.parse(stored);
          // Trim on load too: an older build may have persisted more than the cap.
          this.sentEventIds = new Set(
            Array.isArray(ids) ? ids.slice(-MAX_SENT_EVENT_IDS) : [],
          );
        }
      }
    } catch (error) {
      this.reportError('Error loading sent event IDs', error);
    }
  }

  /**
   * Record event IDs as sent, keeping the in-memory Set bounded.
   *
   * Persistence was already capped at MAX_SENT_EVENT_IDS, but the in-memory Set
   * was not — so a long-lived tab grew it without limit while only ever writing
   * the tail. Trimming here keeps memory and storage describing the same set,
   * which also means a reload cannot resurrect an ID that memory had dropped.
   *
   * Set iteration order is insertion order, so the oldest IDs go first.
   */
  private markEventIdsSent(eventIds: string[]): void {
    for (const eventId of eventIds) {
      this.sentEventIds.add(eventId);
    }

    if (this.sentEventIds.size > MAX_SENT_EVENT_IDS) {
      const overflow = this.sentEventIds.size - MAX_SENT_EVENT_IDS;
      const iterator = this.sentEventIds.values();
      for (let i = 0; i < overflow; i++) {
        const oldest = iterator.next().value;
        if (oldest !== undefined) {
          this.sentEventIds.delete(oldest);
        }
      }
    }
  }

  /**
   * Undo a pre-send mark, because we now know the batch never reached ingest.
   *
   * `markEventIdsSent` runs BEFORE the request so that a page dying mid-flight
   * cannot produce duplicates. The cost of that is an over-approximation: the
   * mark also lands on batches that then fail. Without this rollback those
   * events are permanently unsendable — filtered as "already sent" on every
   * later flush, then evicted from the queue — i.e. **silently lost**. Found by
   * the property tests in `tests/unit/queueInvariants.test.ts`, not by review.
   *
   * Only call this on a *definite* failure. If the outcome is unknown (page
   * unloading, no response) the mark must stand, or we trade a rare duplicate
   * for a systematic one.
   */
  private unmarkEventIdsSent(eventIds: string[]): void {
    if (!eventIds.length) {
      return;
    }
    for (const eventId of eventIds) {
      this.sentEventIds.delete(eventId);
    }
    this.saveSentEventIds();
  }

  /**
   * Save sent event IDs to localStorage.
   * The Set is already capped by markEventIdsSent; the slice is a belt-and-braces
   * guard for IDs loaded by an older build.
   */
  private saveSentEventIds(): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const toSave = Array.from(this.sentEventIds).slice(-MAX_SENT_EVENT_IDS);
        localStorage.setItem(this.sentEventIdsKey, JSON.stringify(toSave));
      }
    } catch (error) {
      this.reportError('Error saving sent event IDs', error);
    }
  }

  /**
   * The unload-sent marks still inside the grace window, read from storage
   * (not cached: another page or tab may have just written them). Expired and
   * malformed entries are left out.
   */
  private readUnloadSent(now: number = Date.now()): Map<string, number> {
    const marks = new Map<string, number>();
    try {
      if (typeof window === 'undefined' || !window.localStorage) return marks;
      const stored = localStorage.getItem(this.unloadSentKey);
      const parsed: unknown = stored ? JSON.parse(stored) : null;
      if (!parsed || typeof parsed !== 'object') return marks;
      let fromTheFuture = false;
      for (const [id, at] of Object.entries(parsed)) {
        if (typeof at !== 'number') continue;
        // A mark from the future (clock moved back) counts from now, and is
        // stored as now so the grace window ends 30s from the first read.
        if (at > now) {
          fromTheFuture = true;
          marks.set(id, now);
        } else if (now - at < UNLOAD_SENT_GRACE_MS) {
          marks.set(id, at);
        }
      }
      if (fromTheFuture) {
        localStorage.setItem(
          this.unloadSentKey,
          JSON.stringify(Object.fromEntries(marks)),
        );
      }
    } catch (error) {
      this.reportError('Error loading unload-sent marks', error);
    }
    return marks;
  }

  /**
   * Add (`handedOver`) or drop (`settled`) unload-sent marks. Read-modify-write
   * of the stored map, so marks other tabs wrote are kept. Writes only when
   * something changed; a regular send of unmarked items costs one read.
   */
  private updateUnloadSent(handedOver: string[], settled: string[]): void {
    if (!handedOver.length && !settled.length) return;
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      const now = Date.now();
      const marks = this.readUnloadSent(now);
      const before = localStorage.getItem(this.unloadSentKey);
      for (const id of settled) marks.delete(id);
      for (const id of handedOver) marks.set(id, now);
      // Same backstop as `sentEventIds`; Map order is insertion order.
      const entries = [...marks].slice(-MAX_SENT_EVENT_IDS);
      const next = entries.length
        ? JSON.stringify(Object.fromEntries(entries))
        : null;
      if (next === before) return;
      if (next === null) localStorage.removeItem(this.unloadSentKey);
      else localStorage.setItem(this.unloadSentKey, next);
    } catch (error) {
      this.reportError('Error saving unload-sent marks', error);
    }
  }

  /**
   * The page is live after all: the transport failures recorded while it was
   * going away were real, so their items are released for a normal retry.
   */
  private releaseUnknownOutcomes(): void {
    if (this.unknownOutcomes.length === 0) return;
    const itemIds = this.unknownOutcomes.flatMap((o) => o.itemIds);
    const eventIds = this.unknownOutcomes.flatMap((o) => o.eventIds);
    this.unknownOutcomes = [];
    this.unmarkEventIdsSent(eventIds);
    this.updateUnloadSent([], itemIds);
  }

  /**
   * True when a send's failure says nothing about whether ingest got it: no
   * HTTP answer, and the page is going away, so the teardown itself is the
   * likely cause. See `unknownOutcomes`.
   */
  private isUnknownOutcome(response: BatchSendResult | null): boolean {
    if (!this.pageTerminating) return false;
    const status = response?.httpStatusCode;
    return (
      !response || !!response.error || typeof status !== 'number' || status <= 0
    );
  }

  /** Keep the pre-send marks of a send whose outcome is unknown. */
  private holdUnknownOutcome(itemIds: string[], eventIds: string[]): void {
    this.unknownOutcomes.push({ itemIds, eventIds });
    // Backstop only: a page going away sends at most a few requests.
    if (this.unknownOutcomes.length > MAX_UNLOAD_REQUESTS * 8) {
      this.unknownOutcomes.shift();
    }
  }

  /**
   * Record a delivery attempt per queue item ID, and drop the entries that can
   * no longer matter.
   *
   * This counter exists only to detect an item being sent more than 5 times,
   * which can only happen if it is still in the queue — i.e. if removal FAILED.
   * When removal succeeds the item is gone for good and its counter is dead
   * weight, so retaining it was a pure leak: one Map entry per event ever sent,
   * for the life of the tab.
   */
  private recordDeliveryAttempts(
    itemIds: string[],
    removalSucceeded: boolean,
  ): void {
    if (removalSucceeded) {
      for (const id of itemIds) {
        this.itemIdsSentSuccessfully.delete(id);
      }
      return;
    }

    for (const id of itemIds) {
      const current = this.itemIdsSentSuccessfully.get(id) || 0;
      this.itemIdsSentSuccessfully.set(id, current + 1);
    }

    // Backstop: a pathological removal-failure loop across many distinct items
    // must not grow the Map without bound either. Map preserves insertion order.
    if (this.itemIdsSentSuccessfully.size > MAX_TRACKED_ITEM_IDS) {
      const overflow = this.itemIdsSentSuccessfully.size - MAX_TRACKED_ITEM_IDS;
      const iterator = this.itemIdsSentSuccessfully.keys();
      for (let i = 0; i < overflow; i++) {
        const oldest = iterator.next().value;
        if (oldest !== undefined) {
          this.itemIdsSentSuccessfully.delete(oldest);
        }
      }
    }
  }

  /**
   * Extract eventIds from payload
   * Payload structure: { name: string, payload: [{ eventId: string, ... }] }
   */
  private extractEventIds(payload: unknown): string[] {
    const eventIds: string[] = [];

    // Narrowed step by step rather than cast, because this runs on data that came
    // back out of storage: an older bundle's records, or another tab's. Anything
    // that does not match the expected shape yields no ids, which downstream
    // treats as "no dedupe protection" — the pre-existing behaviour for payloads
    // without eventIds, and safer than throwing inside a flush.
    if (!payload || typeof payload !== 'object') return eventIds;

    const entries = (payload as { payload?: unknown }).payload;
    if (!Array.isArray(entries)) return eventIds;

    for (const item of entries) {
      if (!item || typeof item !== 'object') continue;
      const eventId = (item as { eventId?: unknown }).eventId;
      if (typeof eventId === 'string' && eventId) {
        eventIds.push(eventId);
      }
    }

    return eventIds;
  }

  async flush(options: FlushOptions = {}): Promise<void> {
    if (options.unloading) {
      // Not awaited before the send: see `flushUnload`.
      return this.flushUnload(options.terminal === true);
    }
    // A regular flush only runs on a live page, so a terminal unload that was
    // started here was called off (a "stay on page" answer to beforeunload).
    this.pageResumed();
    if (this.requestInProgress) {
      return;
    }

    // Breaker open: send nothing, but keep accepting events into the queue so
    // nothing is lost. Guarded here rather than only at the scheduler because
    // flush() has several other callers (enqueue-triggered flushes, the
    // post-success continuation) that would otherwise walk straight past an open
    // breaker.
    //
    // An unload send checks it too, unless the page is going away: see
    // `flushUnload`.
    if (this.breakerOpenUntilMS > Date.now()) {
      return;
    }

    // Getting here with an open-until timestamp still set means the window has
    // just expired and this flush IS the half-open probe. Recorded rather than
    // inferred, so the transition count reflects what happened. Unload sends
    // are not probes: they are not scheduled for the window's end.
    if (this.breakerOpenUntilMS > 0) {
      this.metrics.setBreakerState('half-open');
    }

    this.requestInProgress = true;
    const timeoutMS = this.libConfig.batchRequestTimeoutMs;
    const startTime = Date.now();
    const currentBatchSize = this.batchSize;
    let claimed: string[] = [];

    try {
      const batch = await this.queue.fillBatch(currentBatchSize);
      const attemptSecondaryFlush = batch.length === currentBatchSize;
      const built = this.buildBatch(batch);
      // Claimed before the first await below, so an unload send that runs
      // meanwhile does not put the same items into a second request.
      claimed = this.claim(built.items);

      // Evict items that can never be sent, whether or not this flush has work.
      if (built.alreadySentItemIds.length > 0) {
        await this.removeItemsFromQueue(built.alreadySentItemIds);
      }

      if (built.items.length === 0) {
        this.requestInProgress = false;
        this.resetFlush();
        return;
      }

      // The already-sent items were just evicted above, the in-flight ones
      // belong to another request, and the ones whose hook threw stay queued,
      // so none of them counts in this batch's outcome (a 413 halving
      // decision, for instance, should reflect what was actually sent).
      const outcomeItemIds = batch
        .map((item) => item.id)
        .filter((id) => !built.excludedFromOutcome.has(id));

      await this.dispatch(built.items, {
        unloading: false,
        outcomeItemIds,
        attemptSecondaryFlush,
        currentBatchSize,
        startTime,
        timeoutMS,
      });
    } catch (error) {
      // Only reached before the request (`dispatch` never rejects).
      this.metrics.recordFlush(Date.now() - startTime, true);
      this.reportError('Error flushing request queue', error);
      this.releaseInFlight(claimed);
      this.requestInProgress = false;
      this.resetFlush();
    }
  }

  private claim(items: BuiltItem[]): string[] {
    const ids = items.map((item) => item.id);
    for (const id of ids) this.inFlightItemIds.add(id);
    return ids;
  }

  private releaseInFlight(ids: Iterable<string>): void {
    for (const id of ids) this.inFlightItemIds.delete(id);
  }

  /**
   * Turn queue items into request payloads. Shared by `flush` and
   * `flushUnload`, so the two cannot drift on what is sent, skipped or evicted.
   *
   * - On the wire in another request: skipped. Not re-sent, and not evicted as
   *   "already sent" either: if that send fails, the item must still be queued
   *   for the retry.
   * - eventId already delivered: listed in `alreadySentItemIds` for eviction.
   *   Skipping alone is not enough — the item stays at the head of the queue
   *   and comes back on every future flush, so the head is permanently blocked
   *   and each flush burns part of its batch on garbage. Worse, if its eventId
   *   later ages out of the capped `sentEventIds` window, the item becomes
   *   eligible again and IS resent. It can never legitimately be sent.
   * - `beforeSendHook` throws: reported and left queued, so one bad payload (or
   *   a broken hook) loses neither that event nor the rest of the batch — on
   *   unload, that rest includes the Leave Page.
   * - Handed to an unload request less than `UNLOAD_SENT_GRACE_MS` ago, here
   *   or by the page before this one: skipped like an in-flight item, and
   *   sent once the window has passed if it is still queued then.
   * - Hook returns nothing, or the item was sent more than 5 times: not sent.
   */
  private buildBatch(items: QueueEntry[]): BuiltBatch {
    const built: BuiltBatch = {
      items: [],
      alreadySentItemIds: [],
      excludedFromOutcome: new Set(),
    };
    const unloadSent = items.length ? this.readUnloadSent() : null;

    for (const item of items) {
      if (this.inFlightItemIds.has(item.id)) {
        built.excludedFromOutcome.add(item.id);
        continue;
      }

      const eventIds = this.extractEventIds(item.payload);
      if (eventIds.some((id) => this.sentEventIds.has(id))) {
        built.alreadySentItemIds.push(item.id);
        built.excludedFromOutcome.add(item.id);
        continue;
      }

      if (unloadSent?.has(item.id)) {
        built.excludedFromOutcome.add(item.id);
        continue;
      }

      let payload = item.payload;
      if (this.beforeSendHook && !item.orphaned) {
        try {
          payload = this.beforeSendHook(payload);
        } catch (error) {
          this.reportError('beforeSendHook threw; item left queued', error);
          built.excludedFromOutcome.add(item.id);
          continue;
        }
      }
      if (!payload) continue;

      // Deduplication check (by queue item ID)
      const timesSent = this.itemIdsSentSuccessfully.get(item.id) || 0;
      if (timesSent > 5) {
        this.reportError('[dupe] item ID sent too many times, not sending', {
          item,
          timesSent,
        });
        continue;
      }

      built.items.push({ id: item.id, payload, eventIds });
    }

    return built;
  }

  /**
   * The page is live again (a bfcache restore, the tab shown again): unload
   * sends respect the breaker again. Called by the transport.
   */
  pageResumed(): void {
    this.pageTerminating = false;
    this.releaseUnknownOutcomes();
  }

  /**
   * A terminal unload is starting (`beforeunload`, a non-bfcache `pagehide`).
   * Called by the transport before anything is queued or sent for it, so the
   * Leave Page that unload produces is sent as part of it. `flushUnload` with
   * `terminal` sets the same state.
   */
  pageGoingAway(): void {
    this.pageTerminating = true;
  }

  /**
   * Hand what this page has queued — minus what is already on the wire — to
   * the transport, **synchronously**, for `pagehide` / `beforeunload` /
   * `visibilitychange: hidden` and for a Leave Page.
   *
   * The requests are started before this method returns: nothing here awaits
   * before `sendRequest`, whose fetch is likewise issued before its first
   * await. That is the whole point (INT-5942). The previous unload flush went
   * through `fillBatch`, which awaits storage, and when another request was in
   * flight it was deferred until that request finished. An unloading page gets
   * neither: the Leave Page queued by the same unload reached `/track` late
   * (bundled with the next page's View Page), or only on a later visit from
   * the persisted queue, or not at all.
   *
   * Items on the wire in another request are skipped, so nothing is sent twice
   * in parallel. The rest goes out in batch-size chunks, **newest first**, up
   * to `MAX_UNLOAD_REQUESTS`: the Leave Page is the newest item, so it is
   * always in the first request, which is also the one that gets the browser's
   * keepalive budget. Anything older than those chunks stays queued and
   * persisted for the next flush or the next load.
   *
   * The breaker: an unload send on a live page (a hidden tab, an SPA Leave
   * Page) respects it, so a page that stays open does not keep hitting an
   * endpoint that is down. A **terminal** unload (`beforeunload`, a `pagehide`
   * that is not a bfcache entry) bypasses it: that is the last chance these
   * events get, and one keepalive request from a dying page is not the load
   * the breaker exists to shed. Terminal stays in force for every unload send
   * until the page is live again (`pageResumed`, or a regular flush), so a
   * Leave Page queued by the same unload bypasses it too.
   *
   * Each request goes through `dispatch`, the same send and response handling
   * as a regular flush. Never rejects.
   */
  flushUnload(terminal: boolean = false): Promise<void> {
    if (terminal) this.pageTerminating = true;
    if (!this.pageTerminating && this.breakerOpenUntilMS > Date.now()) {
      return Promise.resolve();
    }

    const startTime = Date.now();
    const chunkSize = Math.max(1, this.batchSize);
    let built: BuiltBatch;
    try {
      const entries = this.queue.peekUnsent(
        Infinity,
        (item) => !this.inFlightItemIds.has(item.id),
      );
      built = this.buildBatch(entries.slice(-MAX_UNLOAD_REQUESTS * chunkSize));
    } catch (error) {
      this.reportError('Error building unload request', error);
      return Promise.resolve();
    }

    const sends: Promise<unknown>[] = [];
    for (
      let end = built.items.length;
      end > 0 && sends.length < MAX_UNLOAD_REQUESTS;
      end -= chunkSize
    ) {
      const chunk = built.items.slice(Math.max(0, end - chunkSize), end);
      const outcomeItemIds = this.claim(chunk);
      sends.push(
        this.dispatch(chunk, {
          unloading: true,
          outcomeItemIds,
          attemptSecondaryFlush: false,
          currentBatchSize: chunkSize,
          startTime,
          timeoutMS: this.libConfig.batchRequestTimeoutMs,
        }),
      );
    }

    // The same eviction as a regular flush's, started only after the
    // requests so no send waits on storage.
    if (built.alreadySentItemIds.length > 0) {
      sends.push(
        this.removeItemsFromQueue(built.alreadySentItemIds).catch((error) =>
          this.reportError('Error evicting sent items', error),
        ),
      );
    }

    return Promise.all(sends).then(() => undefined);
  }

  /**
   * Send one batch and apply its outcome. The one send routine, for a regular
   * flush and an unload send alike; `ctx.unloading` changes only who owns the
   * flush schedule afterwards.
   *
   * The request is started synchronously, before this method returns, and the
   * items must already be claimed (`claim`). Never rejects.
   */
  private dispatch(items: BuiltItem[], ctx: SendContext): Promise<void> {
    const ids = items.map((item) => item.id);
    const eventIds = items.flatMap((item) => item.eventIds);

    // CRITICAL: Mark eventIds as sent BEFORE sending request
    // This prevents duplicates even if request is canceled during navigation
    this.markEventIdsSent(eventIds);
    this.saveSentEventIds(); // Persist immediately
    // An unload request may outlive this page without it ever seeing the
    // answer; the mark keeps the next page from sending these again meanwhile.
    // A regular send of an item whose window has passed clears its old mark.
    if (ctx.unloading) this.updateUnloadSent(ids, []);
    else this.updateUnloadSent([], ids);

    // Use fetch with keepalive for all requests (including page unload)
    // This ensures Authorization header is included and requests are reliable during unload
    let sending: Promise<BatchSendResult | null>;
    try {
      sending = this.sendRequest(
        items.map((item) => item.payload),
        {
          method: 'POST',
          timeout_ms: ctx.timeoutMS,
          keepalive: true,
          unloading: ctx.unloading,
        },
      );
    } catch (error) {
      sending = Promise.reject(error);
    }

    return sending
      .then(
        (response) => {
          this.metrics.recordFlush(Date.now() - ctx.startTime);
          return this.handleResponse(response, ctx, ids, eventIds);
        },
        (error) => {
          this.metrics.recordFlush(Date.now() - ctx.startTime, true);
          this.reportError('Error flushing request queue', error);
          this.releaseInFlight(ids);
          if (this.isUnknownOutcome(null)) {
            // Rejected while the page is going away: see `unknownOutcomes`.
            this.holdUnknownOutcome(ids, eventIds);
          } else {
            // The transport threw rather than returning a response, and this
            // page is still running to see it. It will retry, so the pre-send
            // marks have to come off or the retry evicts the events (or skips
            // them for the grace window) instead of sending them.
            this.unmarkEventIdsSent(eventIds);
            if (ctx.unloading) this.updateUnloadSent([], ids);
          }
          if (!ctx.unloading) {
            this.requestInProgress = false;
            this.resetFlush();
          }
        },
      )
      .catch((error) => this.reportError('Error handling API response', error));
  }

  /**
   * True when the batch was definitely not ingested and should be retried.
   *
   * `response.error` is set by the transport when the request never completed
   * (network failure, abort, timeout). Such a batch was NOT ingested, so it
   * must be retried.
   *
   * This used to require `!navigator.onLine` alongside a <=0 status, which
   * meant a network error while the browser still believed it was online
   * fell through every branch and was treated as a SUCCESS — the events were
   * dequeued having never been delivered. navigator.onLine only reports
   * link-layer state: it is true on a captive portal, a dead VPN, or when the
   * API itself is unreachable. Found by the property tests in
   * tests/unit/queueInvariants.test.ts.
   *
   * A delivered response with NO `httpStatusCode` counts as retryable, and that
   * is a deliberate decision forced by typing the response. Under `any`,
   * `undefined >= 500`, `undefined === 429` and `undefined <= 0` are all false,
   * so such a response fell past every branch and was treated as a SUCCESS —
   * the batch dequeued having never been confirmed. That directly contradicted
   * the unload path's old success check, which required `ok === true` or a
   * 2xx and therefore called the same response inconclusive. Two classifiers
   * disagreeing about the same input is the bug (both paths now use this
   * one); retrying is the safe side of it, because the
   * alternative is silent loss. `?? 0` also keeps the existing `<= 0` intent
   * ("no usable status" and "status 0" are the same case).
   */
  private isRetryableFailure(response: BatchSendResult | null): boolean {
    const transportFailed = !response || !!response.error;
    const rawStatus: unknown = response?.httpStatusCode;
    const status = typeof rawStatus === 'number' ? rawStatus : 0;
    return transportFailed || status >= 500 || status === 429 || status <= 0;
  }

  /**
   * Record a delivery failure: count it, grow the backoff, and trip the
   * breaker once failures are consistent enough to call it an outage. With
   * `schedule`, also set the timer for the retry (or the half-open probe).
   */
  private backOffAfterFailure(
    response: BatchSendResult | null,
    schedule: boolean,
  ): void {
    this.metrics.markFlushFailed();
    // Retry with exponential backoff, spread across the fleet with full
    // jitter. The ceiling doubles deterministically; the sleep is a random
    // point below it. See `fullJitter` for why.
    // Base off the *configured* interval, not `flushInterval` — the latter
    // now carries the steady-state jitter, and the backoff schedule should
    // not inherit an unrelated random draw.
    let ceilingMS = Math.min(
      MAX_RETRY_INTERVAL_MS,
      (this.retryCeilingMS || this.libConfig.batchFlushIntervalMs) * 2,
    );
    let retryMS = fullJitter(ceilingMS);

    if (response?.retryAfter) {
      // NOT jittered, deliberately. The server named a time and we honour it
      // exactly. This leaves every client told "come back in 30s" returning
      // in the same 30th second — the same herd, just server-scheduled — so
      // it is arguably wrong. It stays as-is pending confirmation from the
      // ingest team on whether /track emits Retry-After at all, and on which
      // statuses; the branch may well be dead code today. See BACKEND.md.
      const retryAfterMS = parseInt(response.retryAfter, 10) * 1000;
      if (retryAfterMS) {
        ceilingMS = Math.min(MAX_RETRY_INTERVAL_MS, retryAfterMS);
        retryMS = ceilingMS;
      }
    }

    this.retryCeilingMS = ceilingMS;

    // Trip the breaker once failures are consistent enough to call it an
    // outage rather than a blip. A send that fails while half-open lands
    // here too and re-opens, which is the intended behaviour: one probe
    // failing means the service is still down.
    if (++this.consecutiveSendFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      const openMS = jitterAroundBase(CIRCUIT_BREAKER_OPEN_MS);
      this.breakerOpenUntilMS = Date.now() + openMS;
      this.metrics.setBreakerState('open');
      this.reportError(
        `${this.consecutiveSendFailures} consecutive failures; ` +
          `circuit breaker open for ${openMS} ms`,
      );
      // Schedule the half-open probe for when the window expires. Events
      // keep queueing meanwhile; only sending stops.
      if (schedule) this.scheduleFlush(openMS);
      return;
    }

    this.reportError(`Error; retry in ${retryMS} ms`);
    if (schedule) this.scheduleFlush(retryMS);
  }

  private async handleResponse(
    response: BatchSendResult | null,
    ctx: SendContext,
    inFlightIds: string[],
    eventIdsInBatch: string[],
  ): Promise<void> {
    const itemIds = ctx.outcomeItemIds;
    if (!ctx.unloading) {
      this.requestInProgress = false;
    }
    // An unload send that overlaps a regular flush leaves the timer to that
    // flush, which sets it when it finishes; only the counters move here.
    const ownsSchedule = !ctx.unloading || !this.requestInProgress;
    const reschedule = (ms?: number): void => {
      if (!ownsSchedule) return;
      if (ms === undefined) this.resetFlush();
      else this.scheduleFlush(ms);
    };
    // Every branch releases the in-flight claim, but a delivered batch only
    // after its removal has settled: until then the items can still be listed
    // by the queue, and an unload send in that window would deliver them a
    // second time (a payload without an eventId has no other dedupe).
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.releaseInFlight(inFlightIds);
    };

    // A definite failure: the items are retried, so neither pre-send mark
    // may stand (the eventId one would evict them, the unload one delay them).
    const rollBack = (): void => {
      this.unmarkEventIdsSent(eventIdsInBatch);
      if (ctx.unloading) this.updateUnloadSent([], inFlightIds);
    };

    try {
      // No answer while the page is going away: most likely the teardown,
      // not the request. Nothing is rolled back; see `unknownOutcomes`.
      if (this.isUnknownOutcome(response)) {
        release();
        this.holdUnknownOutcome(inFlightIds, eventIdsInBatch);
        reschedule();
        return;
      }

      // Check for timeout
      if (
        response?.error === 'timeout' &&
        Date.now() - ctx.startTime >= ctx.timeoutMS
      ) {
        release();
        this.reportError('Network timeout; retrying');
        rollBack();
        // Same path as every other retry (INT-3793): an immediate `flush()`
        // here hammered a server that had just timed out.
        reschedule(jitterAroundBase(this.libConfig.batchFlushIntervalMs));
        return;
      }

      // Check for retryable errors (see `isRetryableFailure`). A missing
      // response is one: the transport never delivered.
      if (this.isRetryableFailure(response)) {
        release();
        // Definitely not ingested — release the pre-send mark so the retry can
        // actually send these rather than evicting them as duplicates.
        rollBack();
        this.backOffAfterFailure(response, ownsSchedule);
        return;
      }

      // Handle 413 Payload Too Large
      if (response?.httpStatusCode === 413) {
        if (itemIds.length > 1) {
          const halvedBatchSize = Math.max(
            1,
            Math.floor(ctx.currentBatchSize / 2),
          );
          this.batchSize = Math.min(
            this.batchSize,
            halvedBatchSize,
            itemIds.length - 1,
          );
          this.reportError(
            `413 response; reducing batch size to ${this.batchSize}`,
          );
          release();
          // These items stay queued to be re-sent in smaller batches.
          rollBack();
          reschedule();
          return;
        } else {
          this.reportError('Single-event request too large; dropping', itemIds);
          this.resetBatchSize();
          const removed = await this.removeItemsFromQueue(itemIds);
          release();
          if (ctx.unloading && removed) this.updateUnloadSent([], inFlightIds);
          reschedule();
          return;
        }
      }

      // Success - remove items from queue
      //
      // Ingest answered, so the service is up: close the breaker. If this was
      // the half-open probe, that is what promotes it back to closed and lets
      // the queue drain normally.
      this.closeCircuit();

      const succeeded = await this.removeItemsFromQueue(itemIds);
      release();
      this.recordDeliveryAttempts(itemIds, succeeded);
      // Delivered and gone from the queue: the unload marks have done their
      // job. Kept when the removal failed, so the record left behind is not
      // sent again straight away.
      if (ctx.unloading && succeeded) this.updateUnloadSent([], inFlightIds);

      // An unload send stops here: draining the rest of the queue is the
      // regular flush's job, on its own schedule.
      if (ctx.unloading) return;

      if (succeeded) {
        this.consecutiveRemovalFailures = 0;

        if (this.flushOnlyOnInterval && !ctx.attemptSecondaryFlush) {
          this.resetFlush();
        } else {
          // Continue flushing if more items in queue
          await this.flush();
        }
      } else {
        if (++this.consecutiveRemovalFailures > 5) {
          this.reportError(
            'Too many queue failures; disabling batching system.',
          );
          this.stop();
        } else {
          this.resetFlush();
        }
      }
    } catch (error) {
      this.reportError('Error handling API response', error);
      reschedule();
    } finally {
      release();
    }
  }

  private async removeItemsFromQueue(itemIds: string[]): Promise<boolean> {
    return this.queue.removeItemsByID(itemIds);
  }

  /**
   * Both channels, deliberately.
   *
   * The logger replaces the `!EnvConfig.isProduction()` console gate — it applies
   * exactly the same policy by default (silent in production, verbose otherwise)
   * and adds the `debug: true` override plus the customer sink. The
   * `errorReporter` callback stays because it is a different contract: a
   * per-instance hook the batcher's owner wired, which the tests drive directly.
   */
  private reportError(msg: string, err?: unknown): void {
    this.log.error(msg, err);
    if (this.errorReporter) {
      try {
        this.errorReporter(msg, err);
      } catch {
        // Ignore reporter errors
      }
    }
  }
}
