import { QueueStorage, QueueStorageLike } from '../storage/queueStorage.ts';
import { SharedLock } from '../storage/sharedLock.ts';

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBase36(length: number): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  let out = '';
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < length; i++) out += BASE36[bytes[i] % 36];
    return out;
  }
  for (let i = 0; i < length; i++)
    out += BASE36[Math.floor(Math.random() * 36)];
  return out;
}

export interface QueueEntry {
  id: string;
  flushAfter: number; // Timestamp when item can be considered orphaned
  /**
   * The event body, opaque to the queue: it stores and returns it without ever
   * reading a field. `unknown` says that, and forces the batcher — the one place
   * that does look inside, for eventIds — to narrow first.
   */
  payload: unknown;
  orphaned?: boolean;
}

export interface RequestQueueOptions {
  usePersistence?: boolean;
  queueStorage?: QueueStorageLike;
  sharedLockStorage?: Storage;
  sharedLockTimeoutMS?: number;
  enqueueThrottleMs?: number;
  errorReporter?: (msg: string, err?: unknown) => void;
  /** The payloads the cap dropped (INT-7444); empty for records this tab never read. */
  onOverflow?: (dropped: unknown[]) => void;
  /**
   * Queue items on the wire. The cap skips them: dropping one would report as
   * lost an event the server is about to receive (cross-SDK parity: the oldest
   * event not in flight is dropped).
   */
  isInFlight?: (id: string) => boolean;
  pid?: string;
  maxQueuedEvents?: number;
}

/**
 * Hard cap on pending events, enforced by dropping the oldest.
 *
 * Without a cap the queue grows until the storage tier's quota fails, and a
 * quota failure is **silent**: the write throws, the event falls back to memory,
 * and nothing counts what was lost. The circuit breaker made this load-bearing
 * rather than theoretical — it deliberately stops sending for 60s at a time
 * while events keep arriving, so the queue is now guaranteed to grow during
 * exactly the situation the breaker exists to manage.
 *
 * A cap does not avoid data loss; it converts unbounded, silent, quota-driven
 * loss into bounded loss with a number attached. That number is the point.
 *
 * 10,000 events is far above any legitimate session (a heavy session is tens to
 * low hundreds) and still well inside the ~5 MB localStorage floor at typical
 * payload sizes, so reaching it means something is wrong — a sustained outage or
 * a runaway tracking loop — and dropping is the right response either way.
 */
const MAX_QUEUED_EVENTS = 10000;

/**
 * Persistent queue for tracking events.
 * Survives page reloads and handles multi-tab scenarios.
 *
 * ## Storage layout: one record per event
 *
 * Each event is stored under its own key, `<storageKey>:i:<id>`, rather than all
 * events sharing one JSON array.
 *
 * The array layout made **every** enqueue and every removal a read-modify-write
 * of the entire pending queue: serialise N events to append the (N+1)th. That is
 * O(N) CPU per event on the customer's main thread, and it is quadratic over a
 * burst — the exact shape that hurts most at high event rates, which is when the
 * queue is deepest. Per-event records make an enqueue a single O(1) write and a
 * batch read cost one batch, not one queue.
 *
 * Two further properties fall out of the layout, and both matter more than the
 * speed:
 *
 *  - **Cross-tab writes stop conflicting.** Appends carry unique keys and
 *    removals target keys, so two tabs can no longer clobber each other's
 *    events by writing back a stale array. The `SharedLock` is therefore no
 *    longer taken on the enqueue/remove hot path — it is retained only for the
 *    one-time legacy migration, where a whole-array rewrite really does race.
 *    That also removes the lock's 50 ms polling from every enqueue.
 *  - **A corrupt record costs one event, not the queue.** Readers skip entries
 *    that fail to parse. Under the array layout a single bad write made the
 *    whole queue unreadable.
 *
 * Keys sort chronologically, so key order is FIFO order — see `makeItemKey`.
 */
export class RequestQueue {
  private storageKey: string;
  private itemPrefix: string;
  private usePersistence: boolean;
  private queueStorage: QueueStorageLike;
  private lock: SharedLock | null = null;
  private memQueue: QueueEntry[] = [];
  /**
   * Entries whose storage write has not landed yet. `enqueue` only adds an
   * entry to `memQueue` after the write resolves, which on the IndexedDB tier is
   * a later task — so an event tracked just before an unload was invisible to
   * the synchronous unload send (`peekUnsent`) and waited for a page that never
   * came back (INT-5942).
   */
  private pendingWrites: Map<string, QueueEntry> = new Map();
  /**
   * Pending entries removed (delivered) before their write landed. The write
   * still lands, so its record is deleted as soon as it does instead of being
   * queued for a second send.
   */
  private discardOnLand: Set<string> = new Set();
  private initialized: boolean = false;
  private migrated: boolean = false;
  private reportError: (msg: string, err?: unknown) => void;
  private sequence: number = 0;
  private maxQueuedEvents: number;
  /**
   * Running total of events dropped to stay under the cap, for the lifetime of
   * this page. Read via `getDroppedEventCount()`.
   */
  private droppedEventCount: number = 0;
  /**
   * Cheap estimate of pending events, used to decide *whether* to run the exact
   * count.
   *
   * An exact count means listing every key, which is the O(N)-per-enqueue cost
   * the per-event layout exists to avoid — paying it on every enqueue would undo
   * that work to enforce a limit almost never reached. So this counter tracks
   * locally and only when it reaches the cap does `enforceQueueCap()` do the
   * real scan, which also resyncs this value to the truth. Being an estimate is
   * fine: it can only drift low by missing another tab's writes, and the exact
   * scan at the boundary is what actually enforces the cap.
   *
   * -1 means "not yet seeded from storage".
   */
  private approxQueuedCount: number = -1;

  private onOverflow?: (dropped: unknown[]) => void;
  private isInFlight: (id: string) => boolean;

  constructor(storageKey: string, options: RequestQueueOptions = {}) {
    this.storageKey = storageKey;
    this.itemPrefix = `${storageKey}:i:`;
    this.usePersistence = options.usePersistence !== false;
    this.queueStorage =
      options.queueStorage || new QueueStorage(options.sharedLockStorage);
    this.reportError = options.errorReporter || (() => {});
    this.onOverflow = options.onOverflow;
    this.isInFlight = options.isInFlight || (() => false);
    this.maxQueuedEvents = options.maxQueuedEvents || MAX_QUEUED_EVENTS;

    if (this.usePersistence) {
      this.lock = new SharedLock(storageKey, {
        storage: options.sharedLockStorage || window.localStorage,
        timeoutMS: options.sharedLockTimeoutMS || 5000,
        pid: options.pid,
      });
    }
  }

  async ensureInit(): Promise<void> {
    if (this.initialized || !this.usePersistence) return;

    try {
      await this.queueStorage.init();
      this.initialized = true;
    } catch (error) {
      this.reportError(
        'Error initializing queue persistence. Disabling persistence',
        error,
      );
      this.initialized = true;
      this.usePersistence = false;
    }
  }

  /**
   * Storage key for one event.
   *
   * Sorts chronologically, which is what makes key order equal FIFO order for
   * both storage tiers. The timestamp is zero-padded so string comparison stays
   * correct, and a per-instance sequence number breaks ties inside a single
   * millisecond — without it, burst-enqueued events would come back in an
   * arbitrary order.
   */
  private makeItemKey(id: string, timestamp: number): string {
    const stamp = String(timestamp).padStart(15, '0');
    const seq = String(this.sequence++).padStart(6, '0');
    return `${this.itemPrefix}${stamp}_${seq}_${id}`;
  }

  async enqueue(item: unknown, flushInterval: number): Promise<boolean> {
    const now = Date.now();
    const queueEntry: QueueEntry = {
      id: this.generateId(),
      flushAfter: now + flushInterval * 2,
      payload: item,
    };

    if (!this.usePersistence) {
      this.memQueue.push(queueEntry);
      this.capMemQueue();
      return true;
    }

    // Visible to `peekUnsent` from this synchronous point on, before any await.
    this.pendingWrites.set(queueEntry.id, queueEntry);

    await this.ensureInit();
    if (!this.usePersistence) {
      // ensureInit downgraded us to memory-only.
      if (this.landPending(queueEntry.id)) {
        this.memQueue.push(queueEntry);
        this.capMemQueue();
      }
      return true;
    }

    const key = this.makeItemKey(queueEntry.id, now);
    // The pending write is retired exactly once and the entry joins `memQueue`
    // at most once, whichever step below throws. `landPending` consumes the
    // `discardOnLand` mark, so a second call would wrongly answer "keep it" and
    // put an already-delivered entry back into the queue for a second send.
    let joins: boolean | null = null;
    let pushed = false;
    try {
      // No lock: the key is unique to this event, so there is nothing to race.
      await this.queueStorage.setItem(key, { ...queueEntry, key });
      joins = this.landPending(queueEntry.id);
      if (!joins) {
        // Delivered by an unload send while the write was in progress.
        await this.queueStorage.removeItems([key]);
        return true;
      }
      this.memQueue.push({ ...queueEntry, key } as QueueEntry & {
        key: string;
      });
      pushed = true;
      this.approxQueuedCount =
        this.approxQueuedCount < 0 ? -1 : this.approxQueuedCount + 1;
      await this.enforceQueueCap();
      return true;
    } catch (error) {
      this.reportError('Error enqueueing item', error);
      if (joins === null) joins = this.landPending(queueEntry.id);
      // Keep the event in memory rather than dropping it — a failed write must
      // not also mean a lost event. Not when it was delivered meanwhile, and not
      // a second time when it already joined before the failure.
      if (joins && !pushed) {
        this.memQueue.push(queueEntry);
      }
      return false;
    }
  }

  /**
   * Retire a pending write. Returns false when the entry was removed while its
   * write was in flight, i.e. it must not join the queue.
   */
  private landPending(id: string): boolean {
    this.pendingWrites.delete(id);
    if (this.discardOnLand.has(id)) {
      this.discardOnLand.delete(id);
      return false;
    }
    return true;
  }

  /**
   * Synchronous view of what this page has queued: `memQueue` plus entries whose
   * storage write has not landed, oldest first.
   *
   * For the unload send only. It must hand its request to the browser inside
   * the `pagehide`/`visibilitychange` handler, and `fillBatch` cannot: it awaits
   * storage, which an unloading page may never get back from (INT-5942). Items
   * only in storage (another tab's, a previous load's) are not included; the
   * next load's regular flush delivers those.
   *
   * `include` is applied before `limit`, so entries the caller cannot send
   * (already on the wire, for instance) never use up the limit and crowd out
   * the ones it can — the Leave Page behind a full batch of in-flight items.
   */
  peekUnsent(
    limit: number,
    include: (entry: QueueEntry) => boolean = () => true,
  ): QueueEntry[] {
    const out: QueueEntry[] = [];
    const seen = new Set<string>();
    for (const entry of [...this.memQueue, ...this.pendingWrites.values()]) {
      if (out.length >= limit) break;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      // Removed (delivered) or cleared while its write is still pending: it
      // stays in `pendingWrites` until the write lands, but is no longer queued.
      if (this.discardOnLand.has(entry.id)) continue;
      if (include(entry)) out.push(entry);
    }
    return out;
  }

  /** Events dropped to stay under the cap, since this page loaded. */
  getDroppedEventCount(): number {
    return this.droppedEventCount;
  }

  /**
   * Events this instance currently knows are pending.
   *
   * Read-only, and deliberately the in-memory view rather than an exact storage
   * count: an exact count means listing every key, which is the O(N) cost the
   * per-event layout exists to avoid (see `approxQueuedCount`). A metric is not
   * worth paying that for. It therefore under-reports events another tab queued
   * and this tab has not read yet, which is the right trade for a gauge.
   */
  getQueueDepth(): number {
    return this.memQueue.length;
  }

  /**
   * Cap the in-memory queue, used when persistence is off or unavailable.
   *
   * Same policy as the persistent path — drop oldest — because `memQueue` is
   * FIFO-ordered too.
   */
  private capMemQueue(): void {
    const overflow = this.memQueue.length - this.maxQueuedEvents;
    if (overflow <= 0) return;

    const doomed = new Set(
      this.memQueue
        .filter((entry) => !this.isInFlight(entry.id))
        .slice(0, overflow),
    );
    if (doomed.size === 0) return;
    const dropped = this.memQueue.filter((entry) => doomed.has(entry));
    this.memQueue = this.memQueue.filter((entry) => !doomed.has(entry));
    this.droppedEventCount += dropped.length;
    this.onOverflow?.(dropped.map((entry) => entry.payload));
    this.reportError(
      `Queue full (${this.maxQueuedEvents}); dropped ${dropped.length} oldest event(s), ` +
        `${this.droppedEventCount} total this page`,
    );
  }

  /**
   * Hold the persisted queue at or below `maxQueuedEvents` by deleting the
   * oldest records.
   *
   * Dropping the *oldest* is the deliberate policy: recent events are the more
   * valuable ones (current session, current funnel), and because keys sort
   * chronologically the oldest are a cheap prefix of `keys()` — no sorting, no
   * reading of values.
   *
   * The scan only runs once the local estimate reaches the cap, so the common
   * path stays O(1); see `approxQueuedCount`. The scan doubles as a resync, which
   * is what corrects for events another tab added or removed behind our back.
   *
   * **Known imprecision, accepted.** "Oldest" means key order, and the tiebreak
   * sequence in `makeItemKey` is per-instance, so two tabs writing inside the
   * *same millisecond* interleave arbitrarily — eviction can then drop an event
   * a fraction of a millisecond newer than another. That ordering caveat is
   * pre-existing; the cap only makes it observable. It is not worth a
   * cross-tab-coordinated counter: the cost is at most a few misordered events
   * at the boundary of a queue that is already overflowing, and the alternative
   * puts shared state back on the hot path that per-event records just cleared.
   */
  private async enforceQueueCap(): Promise<void> {
    if (
      this.approxQueuedCount >= 0 &&
      this.approxQueuedCount < this.maxQueuedEvents
    ) {
      return;
    }

    try {
      const keys = await this.queueStorage.keys(this.itemPrefix);
      this.approxQueuedCount = keys.length;
      if (keys.length <= this.maxQueuedEvents) return;

      // keys() is FIFO-ordered, so the overflow is the leading slice of the
      // keys not on the wire. A key another tab wrote is not in flight here.
      const inFlightKeys = new Set(
        this.memQueue
          .filter((entry) => this.isInFlight(entry.id))
          .map((entry) => (entry as QueueEntry & { key?: string }).key),
      );
      const doomed = keys
        .filter((key) => !inFlightKeys.has(key))
        .slice(0, keys.length - this.maxQueuedEvents);
      if (doomed.length === 0) return;
      await this.queueStorage.removeItems(doomed);

      const doomedSet = new Set(doomed);
      const isDoomed = (entry: QueueEntry): boolean =>
        doomedSet.has((entry as QueueEntry & { key?: string }).key as string);
      const doomedPayloads = this.memQueue
        .filter(isDoomed)
        .map((entry) => entry.payload);
      this.memQueue = this.memQueue.filter((entry) => !isDoomed(entry));
      this.approxQueuedCount = this.maxQueuedEvents;
      this.droppedEventCount += doomed.length;

      // The whole point of the cap: loss that is counted and reported rather
      // than a silent quota failure nobody ever hears about.
      this.reportError(
        `Queue full (${this.maxQueuedEvents}); dropped ${doomed.length} oldest event(s), ` +
          `${this.droppedEventCount} total this page`,
      );
      // Records another tab wrote are known here only by key: counted, no ids.
      this.onOverflow?.(
        doomedPayloads.concat(
          new Array(Math.max(0, doomed.length - doomedPayloads.length)).fill(
            null,
          ),
        ),
      );
    } catch (error) {
      // Never let cap enforcement break enqueueing — the event is already
      // written, and failing here would turn a housekeeping problem into a
      // rejected event.
      this.reportError('Error enforcing queue cap', error);
    }
  }

  /**
   * One-time import of events written by an older build, which stored the whole
   * queue as a JSON array under `storageKey`.
   *
   * Customers have events sitting in that format right now, so skipping this
   * would silently drop them on upgrade. Taken under the shared lock because a
   * whole-array read-modify-write across tabs is exactly what does race.
   */
  private async migrateLegacyQueue(): Promise<void> {
    if (this.migrated || !this.usePersistence) return;
    this.migrated = true;

    try {
      const importLegacy = async () => {
        const legacy = await this.queueStorage.getItem(this.storageKey);
        if (!Array.isArray(legacy) || legacy.length === 0) {
          return;
        }
        for (const entry of legacy) {
          if (!entry || typeof entry !== 'object' || !entry.id) continue;
          // The fallback deadline has to land in the *record* as well as the key.
          // It previously went only into the key, so an imported legacy entry
          // with no `flushAfter` kept `undefined` — and every later comparison
          // (`now > item.flushAfter`) is false against undefined, so such an
          // event could never be adopted as an orphan by another tab. It still
          // sent from the tab that imported it, which is why nothing caught this;
          // found by a mutation-driven test.
          const flushAfter = entry.flushAfter || Date.now();
          const key = this.makeItemKey(entry.id, flushAfter);
          await this.queueStorage.setItem(key, { ...entry, flushAfter, key });
        }
        await this.queueStorage.removeItem(this.storageKey);
      };

      if (this.lock) {
        await this.lock.withLock(importLegacy);
      } else {
        await importLegacy();
      }
    } catch (error) {
      // A failed migration must not block the queue — new events still flow.
      this.reportError('Error migrating legacy queue', error);
    }
  }

  private async readFromStorage(
    limit?: number,
  ): Promise<Array<QueueEntry & { key: string }>> {
    await this.ensureInit();
    if (!this.usePersistence) return [];

    try {
      await this.migrateLegacyQueue();
      const entries = await this.queueStorage.entries(this.itemPrefix, limit);
      return entries
        .map(({ key, value }) =>
          value && typeof value === 'object' ? { ...value, key } : null,
        )
        .filter(Boolean) as Array<QueueEntry & { key: string }>;
    } catch (error) {
      this.reportError('Error reading from storage', error);
      return [];
    }
  }

  async fillBatch(batchSize: number): Promise<QueueEntry[]> {
    const now = Date.now();

    // If memQueue is empty and persistence is enabled, initialize from storage
    if (this.memQueue.length === 0 && this.usePersistence) {
      const stored = await this.readFromStorage(batchSize);
      this.memQueue = stored.map((item) =>
        now > item.flushAfter ? { ...item, orphaned: true } : item,
      );
    }

    const batch = this.memQueue.slice(0, batchSize);

    // If we need more items and persistence is enabled, check for orphaned items
    // left behind by another tab.
    if (this.usePersistence && batch.length < batchSize) {
      const stored = await this.readFromStorage(batchSize);
      const idsInBatch = new Set(batch.map((item) => item.id));

      for (const item of stored) {
        if (batch.length >= batchSize) break;
        if (now > item.flushAfter && !idsInBatch.has(item.id)) {
          batch.push({ ...item, orphaned: true });
          idsInBatch.add(item.id);
        }
      }
    }

    return batch;
  }

  async removeItemsByID(ids: string[]): Promise<boolean> {
    const idSet = new Set(ids);

    // Not written yet: drop the record when its write lands instead.
    for (const id of ids) {
      if (this.pendingWrites.has(id)) {
        this.discardOnLand.add(id);
        idSet.delete(id);
      }
    }
    if (idSet.size === 0) return true;

    // Resolve storage keys before dropping the items from memory.
    const keysFromMemory = this.memQueue
      .filter((item) => idSet.has(item.id))
      .map((item) => (item as QueueEntry & { key?: string }).key)
      .filter(Boolean) as string[];

    this.memQueue = this.memQueue.filter((item) => !idSet.has(item.id));

    if (!this.usePersistence) {
      return true;
    }

    try {
      await this.ensureInit();
      if (!this.usePersistence) return true;

      let keys = keysFromMemory;
      if (keys.length !== idSet.size) {
        // Items queued by another tab (or before this page loaded) are not in
        // memQueue, so their keys have to come from storage.
        const stored = await this.queueStorage.keys(this.itemPrefix);
        keys = stored.filter((key) => {
          for (const id of idSet) {
            if (key.endsWith(`_${id}`)) return true;
          }
          return false;
        });
      }

      // Atomic on the IndexedDB tier; per-key on localStorage. Either way there
      // is no stale-array write-back, which is what used to lose events.
      await this.queueStorage.removeItems(keys);
      // Keep the cap estimate honest. Drifting high would trigger needless
      // scans; drifting low is harmless, since the scan at the boundary is what
      // enforces the cap.
      if (this.approxQueuedCount > 0) {
        this.approxQueuedCount = Math.max(
          0,
          this.approxQueuedCount - keys.length,
        );
      }
      return true;
    } catch (error) {
      this.reportError('Error removing items', error);
      return false;
    }
  }

  async clear(): Promise<void> {
    this.memQueue = [];
    for (const id of this.pendingWrites.keys()) this.discardOnLand.add(id);
    this.approxQueuedCount = 0;
    if (this.usePersistence) {
      await this.ensureInit();
      if (!this.usePersistence) return;
      try {
        const keys = await this.queueStorage.keys(this.itemPrefix);
        await this.queueStorage.removeItems(keys);
        await this.queueStorage.removeItem(this.storageKey); // legacy array, if any
      } catch (error) {
        this.reportError('Error clearing queue', error);
      }
    }
  }

  private generateId(): string {
    // Nine base-36 characters after the timestamp, drawn from
    // `crypto.getRandomValues` where available (INT-3937). `Math.random` is
    // only the fallback for environments without WebCrypto. The shape is
    // unchanged, so nothing parsing these ids notices.
    return `${Date.now()}_${randomBase36(9)}`;
  }
}
