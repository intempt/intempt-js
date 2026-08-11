import { QueueStorage } from '../storage/queueStorage.ts';
import { SharedLock } from '../storage/sharedLock.ts';

export interface QueueEntry {
  id: string;
  flushAfter: number; // Timestamp when item can be considered orphaned
  payload: any;
  orphaned?: boolean;
}

export interface RequestQueueOptions {
  usePersistence?: boolean;
  queueStorage?: QueueStorage;
  sharedLockStorage?: Storage;
  sharedLockTimeoutMS?: number;
  enqueueThrottleMs?: number;
  errorReporter?: (msg: string, err?: any) => void;
  pid?: string;
}

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
  private queueStorage: QueueStorage;
  private lock: SharedLock | null = null;
  private memQueue: QueueEntry[] = [];
  private initialized: boolean = false;
  private migrated: boolean = false;
  private reportError: (msg: string, err?: any) => void;
  private sequence: number = 0;

  constructor(storageKey: string, options: RequestQueueOptions = {}) {
    this.storageKey = storageKey;
    this.itemPrefix = `${storageKey}:i:`;
    this.usePersistence = options.usePersistence !== false;
    this.queueStorage = options.queueStorage || new QueueStorage(options.sharedLockStorage);
    this.reportError = options.errorReporter || (() => {});

    if (this.usePersistence) {
      this.lock = new SharedLock(storageKey, {
        storage: options.sharedLockStorage || window.localStorage,
        timeoutMS: options.sharedLockTimeoutMS || 5000,
        pid: options.pid
      });
    }
  }

  async ensureInit(): Promise<void> {
    if (this.initialized || !this.usePersistence) return;

    try {
      await this.queueStorage.init();
      this.initialized = true;
    } catch (error) {
      this.reportError('Error initializing queue persistence. Disabling persistence', error);
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

  async enqueue(item: any, flushInterval: number): Promise<boolean> {
    const now = Date.now();
    const queueEntry: QueueEntry = {
      id: this.generateId(),
      flushAfter: now + flushInterval * 2,
      payload: item
    };

    if (!this.usePersistence) {
      this.memQueue.push(queueEntry);
      return true;
    }

    await this.ensureInit();
    if (!this.usePersistence) {
      // ensureInit downgraded us to memory-only.
      this.memQueue.push(queueEntry);
      return true;
    }

    const key = this.makeItemKey(queueEntry.id, now);
    try {
      // No lock: the key is unique to this event, so there is nothing to race.
      await this.queueStorage.setItem(key, { ...queueEntry, key });
      this.memQueue.push({ ...queueEntry, key } as QueueEntry & { key: string });
      return true;
    } catch (error) {
      this.reportError('Error enqueueing item', error);
      // Keep the event in memory rather than dropping it — a failed write must
      // not also mean a lost event.
      this.memQueue.push(queueEntry);
      return false;
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
      const legacy = await this.queueStorage.getItem(this.storageKey);
      if (!Array.isArray(legacy) || legacy.length === 0) {
        return;
      }

      const importLegacy = async () => {
        for (const entry of legacy) {
          if (!entry || typeof entry !== 'object' || !entry.id) continue;
          const key = this.makeItemKey(entry.id, entry.flushAfter || Date.now());
          await this.queueStorage.setItem(key, { ...entry, key });
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

  private async readFromStorage(limit?: number): Promise<Array<QueueEntry & { key: string }>> {
    await this.ensureInit();
    if (!this.usePersistence) return [];

    try {
      await this.migrateLegacyQueue();
      const entries = await this.queueStorage.entries(this.itemPrefix, limit);
      return entries
        .map(({ key, value }) => (value && typeof value === 'object' ? { ...value, key } : null))
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
      this.memQueue = stored.map(item => (now > item.flushAfter ? { ...item, orphaned: true } : item));
    }

    const batch = this.memQueue.slice(0, batchSize);

    // If we need more items and persistence is enabled, check for orphaned items
    // left behind by another tab.
    if (this.usePersistence && batch.length < batchSize) {
      const stored = await this.readFromStorage(batchSize);
      const idsInBatch = new Set(batch.map(item => item.id));

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

    // Resolve storage keys before dropping the items from memory.
    const keysFromMemory = this.memQueue
      .filter(item => idSet.has(item.id))
      .map(item => (item as QueueEntry & { key?: string }).key)
      .filter(Boolean) as string[];

    this.memQueue = this.memQueue.filter(item => !idSet.has(item.id));

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
        keys = stored.filter(key => {
          for (const id of idSet) {
            if (key.endsWith(`_${id}`)) return true;
          }
          return false;
        });
      }

      // Atomic on the IndexedDB tier; per-key on localStorage. Either way there
      // is no stale-array write-back, which is what used to lose events.
      await this.queueStorage.removeItems(keys);
      return true;
    } catch (error) {
      this.reportError('Error removing items', error);
      return false;
    }
  }

  async clear(): Promise<void> {
    this.memQueue = [];
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
    return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}
