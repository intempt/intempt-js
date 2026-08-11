import { RequestQueue, QueueEntry } from './requestQueue.ts';
import { EnvConfig } from '../envConfig.ts';

export interface BatcherConfig {
  batchSize: number;
  batchFlushIntervalMs: number;
  batchRequestTimeoutMs: number;
  batchAutostart: boolean;
}

export interface RequestBatcherOptions {
  storageKey: string;
  libConfig: BatcherConfig;
  sendRequestFunc: (data: any[], options: any) => Promise<any>;
  errorReporter?: (msg: string, err?: any) => void;
  beforeSendHook?: (payload: any) => any;
  queueStorage?: any;
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
export class RequestBatcher {
  private queue: RequestQueue;
  private libConfig: BatcherConfig;
  private sendRequest: (data: any[], options: any) => Promise<any>;
  private beforeSendHook?: (payload: any) => any;
  private errorReporter: (msg: string, err?: any) => void;
  private flushOnlyOnInterval: boolean;

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
  private timeoutID: number | null = null;
  private consecutiveRemovalFailures: number = 0;
  private itemIdsSentSuccessfully: Map<string, number> = new Map();
  private sentEventIds: Set<string> = new Set();
  private sentEventIdsKey: string;

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
    this.loadSentEventIds();

    this.queue = new RequestQueue(options.storageKey, {
      usePersistence: options.usePersistence,
      queueStorage: options.queueStorage,
      sharedLockStorage: options.sharedLockStorage,
      errorReporter: this.reportError.bind(this)
    });
  }

  async enqueue(item: any): Promise<boolean> {
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

  private resetFlush(): void {
    // Leaving the backoff ceiling set here would make a later, unrelated failure
    // resume from the previous incident's ceiling instead of from the base
    // interval.
    this.retryCeilingMS = 0;
    this.scheduleFlush(this.libConfig.batchFlushIntervalMs);
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
            Array.isArray(ids) ? ids.slice(-MAX_SENT_EVENT_IDS) : []
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
   * Record a delivery attempt per queue item ID, and drop the entries that can
   * no longer matter.
   *
   * This counter exists only to detect an item being sent more than 5 times,
   * which can only happen if it is still in the queue — i.e. if removal FAILED.
   * When removal succeeds the item is gone for good and its counter is dead
   * weight, so retaining it was a pure leak: one Map entry per event ever sent,
   * for the life of the tab.
   */
  private recordDeliveryAttempts(itemIds: string[], removalSucceeded: boolean): void {
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
  private extractEventIds(payload: any): string[] {
    const eventIds: string[] = [];
    
    if (payload && Array.isArray(payload.payload)) {
      for (const item of payload.payload) {
        if (item && item.eventId && typeof item.eventId === 'string') {
          eventIds.push(item.eventId);
        }
      }
    }
    
    return eventIds;
  }

  async flush(options: { unloading?: boolean } = {}): Promise<void> {
    if (this.requestInProgress) {
      return;
    }

    this.requestInProgress = true;
    const timeoutMS = this.libConfig.batchRequestTimeoutMs;
    const startTime = Date.now();
    const currentBatchSize = this.batchSize;
    // Declared outside the try so the catch can roll the pre-send mark back.
    const eventIdsInBatch: string[] = [];

    try {
      const batch = await this.queue.fillBatch(currentBatchSize);
      const attemptSecondaryFlush = batch.length === currentBatchSize;
      const dataForRequest: any[] = [];
      const transformedItems: Map<string, any> = new Map();
      const alreadySentItemIds: string[] = []; // Queue items to evict, not just skip

      // Process batch items
      for (const item of batch) {
        let payload = item.payload;

        // Extract eventIds from payload to check if already sent
        const eventIds = this.extractEventIds(payload);

        // Filter out items that have already been sent (by eventId)
        const alreadySent = eventIds.some(id => this.sentEventIds.has(id));
        if (alreadySent) {
          // Skipping is not enough: the item stays at the head of the queue and
          // fillBatch hands it back on every future flush, so the queue head is
          // permanently blocked and each flush burns part of its batch on
          // garbage. Worse, if its eventId later ages out of the capped
          // sentEventIds window, the item becomes eligible again and IS resent.
          // It can never legitimately be sent, so evict it.
          alreadySentItemIds.push(item.id);
          continue;
        }

        if (this.beforeSendHook && !item.orphaned) {
          payload = this.beforeSendHook(payload);
        }

        if (payload) {
          // Deduplication check (by queue item ID)
          const itemId = item.id;
          const timesSent = this.itemIdsSentSuccessfully.get(itemId) || 0;
          
          if (timesSent > 5) {
            this.reportError('[dupe] item ID sent too many times, not sending', {
              item,
              timesSent
            });
            continue;
          }

          dataForRequest.push(payload);
          transformedItems.set(itemId, payload);
          eventIdsInBatch.push(...eventIds); // Collect eventIds for this batch
        }
      }

      // Evict items that can never be sent, whether or not this flush has work.
      if (alreadySentItemIds.length > 0) {
        await this.removeItemsFromQueue(alreadySentItemIds);
      }

      if (dataForRequest.length === 0) {
        this.requestInProgress = false;
        this.resetFlush();
        return;
      }

      // CRITICAL: Mark eventIds as sent BEFORE sending request
      // This prevents duplicates even if request is canceled during navigation
      this.markEventIdsSent(eventIdsInBatch);
      this.saveSentEventIds(); // Persist immediately

      // Send request
      // Use fetch with keepalive for all requests (including page unload)
      // This ensures Authorization header is included and requests are reliable during unload
      const requestOptions: any = {
        method: 'POST',
        timeout_ms: timeoutMS,
        keepalive: true,
        unloading: options.unloading || false
      };

      const response = await this.sendRequest(dataForRequest, requestOptions);
      
      // Handle response
      // The already-sent items were just evicted above, so they must not be
      // counted in this batch's outcome (a 413 halving decision, for instance,
      // should reflect what was actually sent).
      const evicted = new Set(alreadySentItemIds);
      await this.handleResponse(
        response,
        batch.map(item => item.id).filter(id => !evicted.has(id)),
        attemptSecondaryFlush,
        currentBatchSize,
        startTime,
        timeoutMS,
        options.unloading || false,
        eventIdsInBatch
      );

    } catch (error) {
      this.reportError('Error flushing request queue', error);
      // The transport threw rather than returning a response. On a live page we
      // will retry, so the pre-send mark has to come off or the retry evicts the
      // events instead of sending them. On unload, the page is probably gone and
      // the request may well have left, so the mark stands.
      if (!options.unloading) {
        this.unmarkEventIdsSent(eventIdsInBatch);
      }
      this.requestInProgress = false;
      this.resetFlush();
    }
  }

  private async handleResponse(
    response: any,
    itemIds: string[],
    attemptSecondaryFlush: boolean,
    currentBatchSize: number,
    startTime: number,
    timeoutMS: number,
    unloading: boolean,
    eventIdsInBatch: string[] = []
  ): Promise<void> {
    this.requestInProgress = false;

    try {
      if (unloading) {
        // The request was fired with keepalive from a beforeunload/pagehide/
        // visibilitychange handler, so it often DOES resolve before the page
        // goes away. Previously this branch returned unconditionally without
        // dequeuing, so a confirmed-delivered batch stayed in the queue; on the
        // next page load those items were either re-sent (duplicates — any
        // payload with no eventId has no dedupe protection at all, and the
        // in-memory attempt counter starts empty on a fresh page) or skipped
        // forever without ever being removed.
        //
        // If we got a definite success back, remove them. If the response never
        // arrived or is inconclusive, keep the old behaviour and leave them
        // queued for the next load — that is the safe direction.
        if (this.isDefiniteSuccess(response)) {
          const succeeded = await this.removeItemsFromQueue(itemIds);
          this.recordDeliveryAttempts(itemIds, succeeded);
        } else if (response) {
          // We got an answer and it was not a success, so the batch was not
          // ingested. Roll the pre-send mark back, otherwise the next page load
          // finds these items queued but marked and evicts them — silent loss on
          // every failed unload flush, which is the common case on a flaky
          // network. Only a *missing* response (page died first) keeps the mark.
          this.unmarkEventIdsSent(eventIdsInBatch);
        }
        this.resetFlush();
        return;
      }

      // Check for timeout
      if (response?.error === 'timeout' && Date.now() - startTime >= timeoutMS) {
        this.reportError('Network timeout; retrying');
        this.unmarkEventIdsSent(eventIdsInBatch);
        await this.flush();
        return;
      }

      // Check for retryable errors.
      //
      // `response.error` is set by the transport when the request never
      // completed (network failure, abort, timeout). Such a batch was NOT
      // ingested, so it must be retried.
      //
      // This used to require `!navigator.onLine` alongside a <=0 status, which
      // meant a network error while the browser still believed it was online
      // fell through every branch below and was treated as a SUCCESS — the
      // events were dequeued having never been delivered. navigator.onLine only
      // reports link-layer state: it is true on a captive portal, a dead VPN, or
      // when the API itself is unreachable. Found by the property tests in
      // tests/unit/queueInvariants.test.ts.
      const transportFailed = !response || !!response.error;
      if (
        transportFailed ||
        response?.httpStatusCode >= 500 ||
        response?.httpStatusCode === 429 ||
        response?.httpStatusCode <= 0
      ) {
        // Retry with exponential backoff, spread across the fleet with full
        // jitter. The ceiling doubles deterministically; the sleep is a random
        // point below it. See `fullJitter` for why.
        let ceilingMS = Math.min(
          MAX_RETRY_INTERVAL_MS,
          (this.retryCeilingMS || this.flushInterval) * 2
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
        this.reportError(`Error; retry in ${retryMS} ms`);
        // Definitely not ingested — release the pre-send mark so the retry can
        // actually send these rather than evicting them as duplicates.
        this.unmarkEventIdsSent(eventIdsInBatch);
        this.scheduleFlush(retryMS);
        return;
      }

      // Handle 413 Payload Too Large
      if (response?.httpStatusCode === 413) {
        if (itemIds.length > 1) {
          const halvedBatchSize = Math.max(1, Math.floor(currentBatchSize / 2));
          this.batchSize = Math.min(this.batchSize, halvedBatchSize, itemIds.length - 1);
          this.reportError(`413 response; reducing batch size to ${this.batchSize}`);
          // These items stay queued to be re-sent in smaller batches.
          this.unmarkEventIdsSent(eventIdsInBatch);
          this.resetFlush();
          return;
        } else {
          this.reportError('Single-event request too large; dropping', itemIds);
          this.resetBatchSize();
          await this.removeItemsFromQueue(itemIds);
          this.resetFlush();
          return;
        }
      }

      // Success - remove items from queue
      const succeeded = await this.removeItemsFromQueue(itemIds);
      this.recordDeliveryAttempts(itemIds, succeeded);

      if (succeeded) {
        this.consecutiveRemovalFailures = 0;

        if (this.flushOnlyOnInterval && !attemptSecondaryFlush) {
          this.resetFlush();
        } else {
          // Continue flushing if more items in queue
          await this.flush();
        }
      } else {
        if (++this.consecutiveRemovalFailures > 5) {
          this.reportError('Too many queue failures; disabling batching system.');
          this.stop();
        } else {
          this.resetFlush();
        }
      }
    } catch (error) {
      this.reportError('Error handling API response', error);
      this.resetFlush();
    }
  }

  /**
   * True only when the server definitely accepted the batch.
   *
   * Used on the unload path, where dequeuing on a guess would lose events.
   * Anything ambiguous — no response object, a network/timeout error, a 0 or 5xx
   * status — is treated as "unknown", and the batch stays queued for next load.
   */
  private isDefiniteSuccess(response: any): boolean {
    if (!response || response.error) {
      return false;
    }
    if (response.ok === true) {
      return true;
    }
    const status = response.httpStatusCode;
    return typeof status === 'number' && status >= 200 && status < 300;
  }

  private async removeItemsFromQueue(itemIds: string[]): Promise<boolean> {
    return this.queue.removeItemsByID(itemIds);
  }

  private reportError(msg: string, err?: any): void {
    if (!EnvConfig.isProduction()) {
      console.error(`[RequestBatcher] ${msg}`, err);
    }
    if (this.errorReporter) {
      try {
        this.errorReporter(msg, err);
      } catch (e) {
        // Ignore reporter errors
      }
    }
  }
}

