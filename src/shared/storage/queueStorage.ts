/**
 * Wrapper for localStorage-based queue storage
 * Handles initialization and error recovery
 */
export interface StoredEntry {
  key: string;
  value: any;
}

export class QueueStorage {
  private storage: Storage;
  private initialized: boolean = false;

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    // Test write/read to ensure localStorage works
    try {
      const testKey = '__intempt_test__';
      this.storage.setItem(testKey, 'test');
      this.storage.removeItem(testKey);
      this.initialized = true;
    } catch (error) {
      throw new Error('localStorage not available');
    }
  }

  async getItem(key: string): Promise<any> {
    await this.init();
    try {
      const item = this.storage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      return null;
    }
  }

  async setItem(key: string, value: any): Promise<void> {
    await this.init();
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Handle quota exceeded
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    await this.init();
    this.storage.removeItem(key);
  }

  /**
   * Every entry whose key starts with `prefix`, in key order, up to `limit`.
   *
   * Key order is the queue's FIFO order — see `RequestQueue.makeItemKey`, which
   * builds keys that sort chronologically. Reading a bounded number of entries
   * is the point: the queue no longer has to deserialise every pending event to
   * fill one batch.
   *
   * Corrupt individual entries are skipped rather than failing the read. One
   * unparseable record must not make the whole queue unreadable — that would
   * turn a single bad write into total event loss.
   */
  async entries(prefix: string, limit?: number): Promise<StoredEntry[]> {
    await this.init();

    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    keys.sort();

    const selected = typeof limit === 'number' ? keys.slice(0, limit) : keys;
    const out: StoredEntry[] = [];
    for (const key of selected) {
      try {
        const raw = this.storage.getItem(key);
        if (raw !== null) {
          out.push({ key, value: JSON.parse(raw) });
        }
      } catch {
        // Skip the corrupt record; the rest of the queue is still good.
      }
    }
    return out;
  }

  /** Keys under `prefix`, in FIFO order. Cheaper than `entries` when only counting. */
  async keys(prefix: string): Promise<string[]> {
    await this.init();
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key && key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys.sort();
  }

  /**
   * Remove several keys.
   *
   * localStorage has no transactions, so this is not atomic — unlike the
   * IndexedDB tier. Each removal is individually atomic, which is enough for the
   * queue: a partial removal leaves the un-removed events queued, and they are
   * filtered by the batcher's already-sent check rather than re-sent.
   */
  async removeItems(keys: string[]): Promise<void> {
    await this.init();
    for (const key of keys) {
      this.storage.removeItem(key);
    }
  }
}
