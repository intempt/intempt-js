import { IndexedDbStore } from './indexedDbStore.ts';
import { QueueStorage } from './queueStorage.ts';

/**
 * Storage with an IndexedDB tier and a localStorage fallback.
 *
 * Derived in shape from Mixpanel's `src/storage/wrapper.js` (Apache-2.0 — see
 * NOTICE).
 *
 * Deliberately implements the *same* async interface as `QueueStorage`
 * (`init` / `getItem` / `setItem` / `removeItem`), so it drops into
 * `RequestQueue` through the existing `queueStorage` option with no change to
 * the queue. That keeps this commit's blast radius to storage selection.
 *
 * Fallback policy, and why it is one-way:
 *  - IndexedDB is tried first. Async, no ~5 MB cap, no main-thread block.
 *  - If it fails to open — Safari private mode, sandboxed iframe, a corrupt
 *    profile — we fall back to localStorage **permanently for this page**.
 *    Retrying per-operation would mean every write pays the failed-open cost,
 *    and the failure causes are not transient within a page's lifetime.
 *  - If localStorage is unavailable too, the caller gets a rejection and
 *    `RequestQueue` already degrades to an in-memory queue. Events then survive
 *    only until the tab closes, which is the honest ceiling in that environment.
 *
 * What this does NOT yet do: per-event records. Reads and writes still move the
 * whole queue array under one key, so a write is O(queue depth) in CPU even
 * though it is no longer synchronous. Splitting the queue into one record per
 * event is the follow-up; it needs `RequestQueue` to change, and it is where the
 * transactional `removeItems()` on the IndexedDB tier gets used.
 */
export class PersistentStore {
  private readonly idb: IndexedDbStore;
  private readonly fallback: QueueStorage;
  private driver: 'indexeddb' | 'localstorage' | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly reportError: (msg: string, err?: any) => void;

  constructor(options: {
    dbName?: string;
    storeName?: string;
    fallbackStorage?: Storage;
    errorReporter?: (msg: string, err?: any) => void;
  } = {}) {
    this.idb = new IndexedDbStore(options.dbName, options.storeName);
    this.fallback = new QueueStorage(options.fallbackStorage);
    this.reportError = options.errorReporter || (() => {});
  }

  /** Which tier is actually in use. Exposed for diagnostics and tests. */
  getDriver(): 'indexeddb' | 'localstorage' | null {
    return this.driver;
  }

  init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        await this.idb.init();
        this.driver = 'indexeddb';
        return;
      } catch (error) {
        // Expected on some platforms — report, do not throw.
        this.reportError('IndexedDB unavailable, falling back to localStorage', error);
      }

      await this.fallback.init();
      this.driver = 'localstorage';
    })();

    this.initPromise = this.initPromise.catch(error => {
      // Neither tier came up. Clear the cached promise so a later call can retry,
      // and let the caller degrade to memory.
      this.initPromise = null;
      this.driver = null;
      throw error;
    });

    return this.initPromise;
  }

  async getItem(key: string): Promise<any> {
    await this.init();
    if (this.driver === 'indexeddb') {
      try {
        return await this.idb.getItem(key);
      } catch (error) {
        this.reportError('IndexedDB read failed, falling back to localStorage', error);
        this.driver = 'localstorage';
      }
    }
    return this.fallback.getItem(key);
  }

  async setItem(key: string, value: any): Promise<void> {
    await this.init();
    if (this.driver === 'indexeddb') {
      try {
        await this.idb.setItem(key, value);
        return;
      } catch (error) {
        // A write that fails after a successful open usually means the origin's
        // storage was evicted or the DB was deleted underneath us. Falling back
        // keeps the events rather than dropping this batch.
        this.reportError('IndexedDB write failed, falling back to localStorage', error);
        this.driver = 'localstorage';
      }
    }
    return this.fallback.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    await this.init();
    if (this.driver === 'indexeddb') {
      try {
        await this.idb.removeItem(key);
        return;
      } catch (error) {
        this.reportError('IndexedDB delete failed, falling back to localStorage', error);
        this.driver = 'localstorage';
      }
    }
    return this.fallback.removeItem(key);
  }
}
