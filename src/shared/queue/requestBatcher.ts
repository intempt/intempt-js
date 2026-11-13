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
 * and that is a different outcome from any HTTP status. The outcome classification
 * (`neverReached`) depends on being able to tell those apart.
 */
export interface BatchSendResult {
  httpStatusCode?: number;
  ok?: boolean;
  retryAfter?: string;
  error?: string;
}

/**
 * The final outcome of one batch that was not delivered (INT-7444, CONTRACT-R2 §S2).
 * - `transport`: never reached the server; the batch is kept. Fires once per batch.
 * - `terminal`: the server answered a drop status, or the one 503/429 resend failed.
 * - `dropped`: dropped on this side (timeout after the request was written, queue cap).
 */
export interface DeliveryFailure {
  kind: 'transport' | 'terminal' | 'dropped';
  status?: number;
  eventCount: number;
  eventIds: string[];
  /** Seconds, as the server sent it. */
  retryAfter?: number;
  terminal: boolean;
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
  /** Called once per batch on its final outcome; a throw is caught and logged. */
  onDeliveryFailure?: (failure: DeliveryFailure) => void;
}

// CONTRACT-R2 §S1: 503 and 429 get one resend, after Retry-After clamped to this range.
const MIN_RESEND_WAIT_MS = 1000;
const MAX_RESEND_WAIT_MS = 60 * 1000;

/** +/-10% spread applied to the steady-state flush interval. */
const FLUSH_JITTER_RATIO = 0.1;

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
  startTime: number;
  timeoutMS: number;
}

export interface FlushOptions {
  /** Send synchronously, for an unload or a Leave Page (`flushUnload`). */
  unloading?: boolean;
  /**
   * The page is going away (`beforeunload`, a non-bfcache `pagehide`), so the
   * unload send bypasses the Retry-After hold. Ignored without `unloading`.
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
  private requestInProgress: boolean = false;
  /**
   * Queue item ids whose request is on the wire, from either a regular flush or
   * an unload send. An unload send skips them, and a regular flush neither
   * re-sends nor evicts them, so one event is never in two requests at once.
   */
  private inFlightItemIds: Set<string> = new Set();
  /**
   * A terminal unload (`beforeunload`, non-bfcache `pagehide`) has started and
   * the page has not been seen live since. Unload sends bypass the Retry-After hold
   * while it is set. See `flushUnload`.
   */
  private pageTerminating: boolean = false;
  private timeoutID: number | null = null;
  private consecutiveRemovalFailures: number = 0;
  /**
   * Not before this time does a regular flush send: the Retry-After wait of a
   * 503/429 resend. Unload sends on a live page respect it too.
   */
  private holdUntilMS: number = 0;
  /**
   * Queue items already resent once after a 503/429. Per item, not per batch:
   * `fillBatch` rebuilds from the queue head, so a newcomer joining a resent
   * batch still has its own resend. In memory only, so a reload can give an
   * item pending its resend one more attempt.
   */
  private resentItemIds: Set<string> = new Set();
  /** Items whose `transport` failure was already reported (§S2: once per batch). */
  private transportReportedItemIds: Set<string> = new Set();
  private onDeliveryFailure?: (failure: DeliveryFailure) => void;
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
    this.onDeliveryFailure = options.onDeliveryFailure;

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
      isInFlight: (id) => this.inFlightItemIds.has(id),
      errorReporter: this.reportError.bind(this),
      onOverflow: (dropped) => {
        const eventIds = dropped.flatMap((p) => this.extractEventIds(p));
        this.notifyFailure({
          kind: 'dropped',
          eventCount: Math.max(dropped.length, eventIds.length),
          eventIds,
          terminal: true,
        });
      },
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
   * Readable snapshot of the delivery pipeline: depth, latency, drops.
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
    this.armFlushTimer(flushMS);
  }

  /**
   * Arms the timer without touching `flushInterval`, which `enqueue` turns into
   * the orphan deadline (`flushAfter`): a few ms left on a hold must not let
   * another tab claim fresh items.
   */
  private armFlushTimer(delayMS: number): void {
    if (!this.stopped) {
      if (this.timeoutID) {
        clearTimeout(this.timeoutID);
      }
      this.timeoutID = window.setTimeout(() => {
        if (!this.stopped) {
          this.flush();
        }
      }, delayMS);
    }
  }

  private resetFlush(): void {
    this.scheduleFlush(jitterAroundBase(this.libConfig.batchFlushIntervalMs));
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

    // Waiting out a 503/429 Retry-After: nothing goes out before it, whoever
    // calls flush(). Events keep queueing. The timer is re-armed for the end of
    // the hold, because the caller may be the only thing that would have armed
    // it (start() after stop(), or the drain after an unload send set the hold).
    const holdLeftMS = this.holdUntilMS - Date.now();
    if (holdLeftMS > 0) {
      this.armFlushTimer(holdLeftMS);
      return;
    }

    this.requestInProgress = true;
    const timeoutMS = this.libConfig.batchRequestTimeoutMs;
    const startTime = Date.now();
    let claimed: string[] = [];

    try {
      const batch = await this.queue.fillBatch(this.batchSize);
      const attemptSecondaryFlush = batch.length === this.batchSize;
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
      // so none of them counts in this batch's outcome.
      const outcomeItemIds = batch
        .map((item) => item.id)
        .filter((id) => !built.excludedFromOutcome.has(id));

      await this.dispatch(built.items, {
        unloading: false,
        outcomeItemIds,
        attemptSecondaryFlush,
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
   * sends respect the Retry-After hold again. Called by the transport.
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
   * The Retry-After hold: an unload send on a live page (a hidden tab, an SPA
   * Leave Page) respects it, so a page that stays open does not resend before
   * the server asked. A **terminal** unload (`beforeunload`, a `pagehide`
   * that is not a bfcache entry) bypasses it: that is the last chance these
   * events get, and one keepalive request from a dying page is not the load
   * the hold exists to shed. Terminal stays in force for every unload send
   * until the page is live again (`pageResumed`, or a regular flush), so a
   * Leave Page queued by the same unload bypasses it too.
   *
   * Each request goes through `dispatch`, the same send and response handling
   * as a regular flush. Never rejects.
   */
  flushUnload(terminal: boolean = false): Promise<void> {
    if (terminal) this.pageTerminating = true;
    if (!this.pageTerminating && this.holdUntilMS > Date.now()) {
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
          return this.handleResponse(response, ctx, items);
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
            this.reportTransportOnce(items);
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
   * The send never reached the server (CONTRACT-R2 §S1.5): no result, a
   * transport error other than a timeout, or no usable status. Such a batch
   * was NOT ingested and is kept for the next flush.
   *
   * A delivered response with NO `httpStatusCode` counts as never reached, a
   * decision forced by typing the response: under `any` it fell past every
   * branch and was dequeued as a success having never been confirmed. Keeping
   * it is the safe side, because the alternative is silent loss. `navigator.onLine`
   * is deliberately not consulted: it is true on a captive portal or a dead VPN
   * (tests/unit/queueInvariants.test.ts).
   */
  private neverReached(response: BatchSendResult | null): boolean {
    if (!response) return true;
    if (response.error) return response.error !== 'timeout';
    const rawStatus: unknown = response.httpStatusCode;
    return typeof rawStatus !== 'number' || rawStatus <= 0;
  }

  /** Retry-After in seconds, or undefined when absent or not a number of seconds. */
  private retryAfterSeconds(
    response: BatchSendResult | null,
  ): number | undefined {
    const seconds = parseInt(response?.retryAfter ?? '', 10);
    return Number.isFinite(seconds) ? seconds : undefined;
  }

  private notifyFailure(failure: DeliveryFailure): void {
    this.reportError(
      `Delivery failed (${failure.kind}${failure.status ? ` ${failure.status}` : ''}); ` +
        `${failure.eventCount} event(s) ${failure.terminal ? 'dropped' : 'kept'}`,
    );
    if (!this.onDeliveryFailure) return;
    try {
      this.onDeliveryFailure(failure);
    } catch (error) {
      this.log.error('onDeliveryFailure listener threw', error);
    }
  }

  private failureFor(
    items: BuiltItem[],
    kind: DeliveryFailure['kind'],
    response: BatchSendResult | null,
  ): DeliveryFailure {
    const eventIds = items.flatMap((item) => item.eventIds);
    const failure: DeliveryFailure = {
      kind,
      eventCount: items.reduce(
        (n, item) => n + Math.max(1, item.eventIds.length),
        0,
      ),
      eventIds,
      terminal: kind !== 'transport',
    };
    if (kind === 'terminal' && response?.httpStatusCode) {
      failure.status = response.httpStatusCode;
    }
    const retryAfter = this.retryAfterSeconds(response);
    if (kind === 'terminal' && retryAfter !== undefined) {
      failure.retryAfter = retryAfter;
    }
    return failure;
  }

  /**
   * §S2: an offline tab must not refire `transport` for the same batch on every
   * flush, nor for kept events that a newcomer joined (R4: once per kept batch).
   */
  private reportTransportOnce(items: BuiltItem[]): void {
    const fresh = items.filter(
      (item) => !this.transportReportedItemIds.has(item.id),
    );
    if (fresh.length === 0) return;
    for (const item of fresh) this.transportReportedItemIds.add(item.id);
    this.notifyFailure(this.failureFor(fresh, 'transport', null));
  }

  private forgetItems(itemIds: Iterable<string>): void {
    for (const id of itemIds) {
      this.resentItemIds.delete(id);
      this.transportReportedItemIds.delete(id);
    }
  }

  private async handleResponse(
    response: BatchSendResult | null,
    ctx: SendContext,
    items: BuiltItem[],
  ): Promise<void> {
    const itemIds = ctx.outcomeItemIds;
    const inFlightIds = items.map((item) => item.id);
    const eventIdsInBatch = items.flatMap((item) => item.eventIds);
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

    // The items stay queued for another send, so neither pre-send mark may
    // stand (the eventId one would evict them, the unload one delay them).
    const rollBack = (): void => {
      this.unmarkEventIdsSent(eventIdsInBatch);
      if (ctx.unloading) this.updateUnloadSent([], inFlightIds);
    };

    // Dropped for good: removed, pre-send marks kept, reported once.
    const drop = async (
      dropIds: string[],
      dropped: BuiltItem[],
      kind: DeliveryFailure['kind'],
    ): Promise<void> => {
      const removed = await this.removeItemsFromQueue(dropIds);
      release();
      if (ctx.unloading && removed) this.updateUnloadSent([], inFlightIds);
      this.forgetItems(dropIds);
      if (dropped.length > 0) {
        this.notifyFailure(this.failureFor(dropped, kind, response));
      }
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

      if (this.neverReached(response)) {
        this.metrics.markFlushFailed();
        release();
        rollBack();
        this.reportTransportOnce(items);
        reschedule();
        return;
      }

      // Written but unanswered: the server may have it, so a resend risks a
      // duplicate (§S1.4).
      if (response?.error === 'timeout') {
        this.metrics.markFlushFailed();
        await drop(itemIds, items, 'dropped');
        reschedule();
        return;
      }

      const status = response?.httpStatusCode as number;

      if (status === 503 || status === 429) {
        this.metrics.markFlushFailed();
        const exhausted = itemIds.filter((id) => this.resentItemIds.has(id));
        const resend = itemIds.filter((id) => !this.resentItemIds.has(id));
        const exhaustedSet = new Set(exhausted);
        if (exhausted.length > 0) {
          await drop(
            exhausted,
            items.filter((item) => exhaustedSet.has(item.id)),
            'terminal',
          );
        }
        release();
        if (resend.length > 0) {
          for (const id of resend) this.resentItemIds.add(id);
          rollBack();
          const seconds = this.retryAfterSeconds(response);
          const waitMS = Math.min(
            MAX_RESEND_WAIT_MS,
            Math.max(MIN_RESEND_WAIT_MS, (seconds ?? 0) * 1000),
          );
          this.holdUntilMS = Date.now() + waitMS;
          reschedule(waitMS);
        } else {
          reschedule();
        }
        return;
      }

      // Every other status the server answered is dropped (§S1.3): 413 too,
      // with no halving and resend.
      if (status < 200 || status >= 300) {
        this.metrics.markFlushFailed();
        await drop(itemIds, items, 'terminal');
        reschedule();
        return;
      }

      const succeeded = await this.removeItemsFromQueue(itemIds);
      release();
      this.recordDeliveryAttempts(itemIds, succeeded);
      if (succeeded) this.forgetItems(itemIds);
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
