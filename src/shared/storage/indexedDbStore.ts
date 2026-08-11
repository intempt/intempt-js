/**
 * IndexedDB key-value store.
 *
 * Derived from Mixpanel's `src/storage/indexed-db.js` (Apache-2.0 — see NOTICE);
 * the open/init/promise-caching shape and the failure posture are theirs, the
 * TypeScript and the per-record API are ours.
 *
 * Why this exists at all: `localStorage` is **synchronous**, so every queue write
 * blocks the main thread of the customer's page, and it caps at ~5 MB shared with
 * that page — a cap we do not control and cannot detect until a write throws.
 * At the throughput this SDK targets, that is the bottleneck, and its failure
 * mode is silent quota loss.
 *
 * Design notes that matter:
 *  - `init()` caches its promise. Concurrent callers must not race `open()`;
 *    two opens against the same database is how you get blocked transactions
 *    that never settle.
 *  - Every method rejects rather than throwing synchronously, so callers have
 *    exactly one error path.
 *  - Nothing here is allowed to be fatal. IndexedDB is unavailable in some
 *    Safari private-mode contexts and inside sandboxed iframes, and it can fail
 *    at open() time for reasons we cannot influence. `PersistentStore` handles
 *    the fallback; this file's job is to report failure honestly and fast.
 */

const DB_VERSION = 1;

export class IndexedDbStore {
  private readonly dbName: string;
  private readonly storeName: string;
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(dbName = 'intempt', storeName = 'kv') {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  /** True when the environment exposes IndexedDB at all. Not a guarantee it opens. */
  static isSupported(): boolean {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch {
      // Accessing indexedDB itself throws in some sandboxed iframes.
      return false;
    }
  }

  init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise<void>((resolve, reject) => {
      if (!IndexedDbStore.isSupported()) {
        reject(new Error('IndexedDB not available'));
        return;
      }

      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(this.dbName, DB_VERSION);
      } catch (error) {
        reject(error);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };

      request.onsuccess = () => {
        this.db = request.result;

        // A second tab upgrading the schema fires this; close so we do not block
        // it. The next call re-opens, which is cheaper than deadlocking a tab.
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;
          this.initPromise = null;
        };

        resolve();
      };

      request.onerror = () =>
        reject(request.error || new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });

    // A failed init must not be cached as permanently failed-but-settled; drop it
    // so a later attempt can retry (e.g. after the blocking tab closes).
    this.initPromise = this.initPromise.catch((error) => {
      this.initPromise = null;
      throw error;
    });

    return this.initPromise;
  }

  private async transaction(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    await this.init();
    if (!this.db) {
      throw new Error('IndexedDB not initialized');
    }
    return this.db
      .transaction(this.storeName, mode)
      .objectStore(this.storeName);
  }

  private request<T>(
    makeRequest: (store: IDBObjectStore) => IDBRequest,
    mode: IDBTransactionMode,
  ): Promise<T> {
    return this.transaction(mode).then(
      (store) =>
        new Promise<T>((resolve, reject) => {
          let req: IDBRequest;
          try {
            req = makeRequest(store);
          } catch (error) {
            reject(error);
            return;
          }
          req.onsuccess = () => resolve(req.result as T);
          req.onerror = () =>
            reject(req.error || new Error('IndexedDB request failed'));
        }),
    );
  }

  async getItem(key: string): Promise<any> {
    const value = await this.request<any>(
      (store) => store.get(key),
      'readonly',
    );
    return value === undefined ? null : value;
  }

  async setItem(key: string, value: any): Promise<void> {
    await this.request<void>((store) => store.put(value, key), 'readwrite');
  }

  async removeItem(key: string): Promise<void> {
    await this.request<void>((store) => store.delete(key), 'readwrite');
  }

  async clear(): Promise<void> {
    await this.request<void>((store) => store.clear(), 'readwrite');
  }

  /**
   * Remove several keys inside ONE transaction.
   *
   * This is the property `localStorage` cannot offer and the reason the queue
   * wants IndexedDB: either every key in a batch is removed or none is. A
   * partial removal is precisely what produces duplicate sends.
   */
  async removeItems(keys: string[]): Promise<void> {
    if (!keys.length) {
      return;
    }

    const store = await this.transaction('readwrite');
    await new Promise<void>((resolve, reject) => {
      const tx = store.transaction;
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error || new Error('IndexedDB batch delete failed'));
      tx.onabort = () =>
        reject(tx.error || new Error('IndexedDB batch delete aborted'));

      for (const key of keys) {
        store.delete(key);
      }
    });
  }

  /**
   * Every entry whose key starts with `prefix`, in key order, up to `limit`.
   *
   * Uses a cursor over a bounded key range rather than `getAll()`, so a queue
   * with 100k pending events still costs one batch's worth of deserialisation
   * to read one batch. `\uffff` is the standard upper sentinel for a string
   * prefix range in IndexedDB.
   */
  async entries(
    prefix: string,
    limit?: number,
  ): Promise<Array<{ key: string; value: any }>> {
    const store = await this.transaction('readonly');
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);

    return new Promise((resolve, reject) => {
      const out: Array<{ key: string; value: any }> = [];
      const request = store.openCursor(range);

      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || (typeof limit === 'number' && out.length >= limit)) {
          resolve(out);
          return;
        }
        out.push({ key: String(cursor.key), value: cursor.value });
        cursor.continue();
      };
      request.onerror = () =>
        reject(request.error || new Error('IndexedDB cursor failed'));
    });
  }

  /** Keys under `prefix`, in FIFO order. */
  async keys(prefix: string): Promise<string[]> {
    const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
    const keys = await this.request<IDBValidKey[]>(
      (store) => store.getAllKeys(range),
      'readonly',
    );
    return (keys || []).map(String);
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.initPromise = null;
  }
}
