import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbStore } from '../../src/shared/storage/indexedDbStore.ts';
import { PersistentStore } from '../../src/shared/storage/persistentStore.ts';
import { RequestQueue } from '../../src/shared/queue/requestQueue.ts';

/**
 * `fake-indexeddb` is installed globally by tests/unit/setup.ts, so these run
 * against a real IndexedDB implementation rather than a hand-written double.
 * The fallback paths are exercised by breaking the real thing, not by mocking
 * the module — a mock would only prove the mock works.
 */
describe('IndexedDbStore', () => {
  let store: IndexedDbStore;

  beforeEach(async () => {
    store = new IndexedDbStore(`unit_${Math.floor(performance.now() * 1000)}`, 'kv');
  });

  it('reports support in this environment', () => {
    expect(IndexedDbStore.isSupported()).toBe(true);
  });

  it('round-trips a structured value', async () => {
    await store.setItem('k', [{ a: 1 }, { b: [2, 3] }]);
    expect(await store.getItem('k')).toEqual([{ a: 1 }, { b: [2, 3] }]);
  });

  it('returns null for a missing key rather than undefined', async () => {
    // RequestQueue checks `Array.isArray(stored)`, so a consistent null keeps
    // the "empty" case single-shaped.
    expect(await store.getItem('missing')).toBeNull();
  });

  it('overwrites an existing key', async () => {
    await store.setItem('k', 1);
    await store.setItem('k', 2);
    expect(await store.getItem('k')).toBe(2);
  });

  it('removes a key', async () => {
    await store.setItem('k', 1);
    await store.removeItem('k');
    expect(await store.getItem('k')).toBeNull();
  });

  it('clears every key', async () => {
    await store.setItem('a', 1);
    await store.setItem('b', 2);
    await store.clear();
    expect(await store.getItem('a')).toBeNull();
    expect(await store.getItem('b')).toBeNull();
  });

  it('removes many keys in one transaction', async () => {
    await Promise.all([store.setItem('a', 1), store.setItem('b', 2), store.setItem('c', 3)]);

    await store.removeItems(['a', 'c']);

    expect(await store.getItem('a')).toBeNull();
    expect(await store.getItem('b')).toBe(2);
    expect(await store.getItem('c')).toBeNull();
  });

  it('treats an empty batch delete as a no-op', async () => {
    await expect(store.removeItems([])).resolves.toBeUndefined();
  });

  it('caches init() so concurrent callers do not race open()', async () => {
    const openSpy = vi.spyOn(indexedDB, 'open');

    await Promise.all([store.init(), store.init(), store.init()]);

    // Two opens against one database is how you get transactions that never
    // settle, so this is a correctness assertion, not a performance one.
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed init as settled', async () => {
    const failing = new IndexedDbStore('unit_fail', 'kv');
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('open exploded');
    });

    await expect(failing.init()).rejects.toThrow('open exploded');

    // A later attempt must be allowed to retry — the blocking condition may be
    // gone (e.g. the other tab closed).
    openSpy.mockRestore();
    await expect(failing.init()).resolves.toBeUndefined();
  });

  it('rejects rather than throwing synchronously when unsupported', async () => {
    const unsupported = new IndexedDbStore('unit_unsupported', 'kv');
    vi.spyOn(IndexedDbStore, 'isSupported').mockReturnValue(false);

    await expect(unsupported.init()).rejects.toThrow('IndexedDB not available');
  });

  it('reports no support when the global is absent', () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(IndexedDbStore.isSupported()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('reports no support when touching the global throws', () => {
    // Reading `indexedDB` itself throws in some sandboxed iframes, which is why
    // isSupported has a try/catch rather than a plain typeof check.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });

    try {
      expect(IndexedDbStore.isSupported()).toBe(false);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'indexedDB', original);
      } else {
        delete (globalThis as any).indexedDB;
      }
    }
  });

  describe('entries', () => {
    it('returns only the prefix it was asked for, in key order', async () => {
      // Key order is the queue's FIFO order, so this is a contract, not a
      // convenience — writes go in scrambled deliberately.
      await store.setItem('q_b', 2);
      await store.setItem('other_z', 99);
      await store.setItem('q_c', 3);
      await store.setItem('q_a', 1);

      const entries = await store.entries('q_');

      expect(entries).toEqual([
        { key: 'q_a', value: 1 },
        { key: 'q_b', value: 2 },
        { key: 'q_c', value: 3 },
      ]);
    });

    it('stops at limit rather than reading the whole range', async () => {
      await store.setItem('q_a', 1);
      await store.setItem('q_b', 2);
      await store.setItem('q_c', 3);

      expect(await store.entries('q_', 2)).toEqual([
        { key: 'q_a', value: 1 },
        { key: 'q_b', value: 2 },
      ]);
    });

    it('reads nothing at limit 0', async () => {
      // The boundary that separates `>= limit` from `> limit`: a zero limit must
      // not fall through and return the first record.
      await store.setItem('q_a', 1);

      expect(await store.entries('q_', 0)).toEqual([]);
    });

    it('returns an empty list when nothing matches the prefix', async () => {
      await store.setItem('other', 1);

      expect(await store.entries('q_')).toEqual([]);
    });

    it('does not include a key that merely contains the prefix', async () => {
      await store.setItem('zq_a', 1);
      await store.setItem('q_a', 2);

      expect(await store.entries('q_')).toEqual([{ key: 'q_a', value: 2 }]);
    });
  });

  describe('keys', () => {
    it('returns prefix-scoped keys in FIFO order', async () => {
      await store.setItem('q_c', 3);
      await store.setItem('q_a', 1);
      await store.setItem('nope', 0);

      expect(await store.keys('q_')).toEqual(['q_a', 'q_c']);
    });

    it('returns an empty list when the range is empty', async () => {
      expect(await store.keys('q_')).toEqual([]);
    });
  });

  it('rejects when a request cannot even be created', async () => {
    // A value that cannot be structured-cloned makes `put` throw synchronously,
    // which is the path that must surface as a rejection rather than an
    // uncaught throw out of the promise executor.
    await expect(store.setItem('k', () => {})).rejects.toThrow(/could not be cloned/);
  });

  it('rejects when the database went away after init resolved', async () => {
    await store.init();
    (store as any).db = null;

    await expect(store.getItem('k')).rejects.toThrow('IndexedDB not initialized');
  });

  it('rejects init when open fails, carrying the underlying error', async () => {
    // A real failure mode: the origin already holds a newer schema, e.g. after a
    // downgrade of the SDK.
    const dbName = `unit_version_${Math.floor(performance.now() * 1000)}`;
    await new Promise<void>(resolve => {
      const request = indexedDB.open(dbName, 2);
      request.onupgradeneeded = () => request.result.createObjectStore('kv');
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });

    await expect(new IndexedDbStore(dbName, 'kv').init()).rejects.toThrow(/lower version/);
  });

  it('closes when another tab upgrades the schema, and then cannot re-open', async () => {
    // Holding the connection open would block the other tab's upgrade forever, so
    // dropping it is right. But note what follows, because the comment in the
    // source ("the next call re-opens") is only half true: this store is pinned to
    // DB_VERSION, so once a newer bundle in another tab has raised the version,
    // every later open from *this* bundle fails with VersionError. The tier is
    // gone for the life of the page, and it is `PersistentStore` demoting to
    // localStorage that keeps events flowing. Asserted so the limitation is
    // written down rather than assumed away.
    await store.setItem('k', 1);
    const dbName = (store as any).dbName;

    await new Promise<void>(resolve => {
      const request = indexedDB.open(dbName, 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });

    expect((store as any).db).toBeNull();
    expect((store as any).initPromise).toBeNull();

    await expect(store.getItem('k')).rejects.toThrow(/lower version/);
  });

  it('is demoted to localStorage by PersistentStore after such an upgrade', async () => {
    // The companion to the test above: the failure is contained, not fatal.
    const dbName = `unit_vc_demote_${Math.floor(performance.now() * 1000)}`;
    const reported: string[] = [];
    const outer = new PersistentStore({ dbName, errorReporter: m => reported.push(m) });
    await outer.setItem('k', 'before');
    expect(outer.getDriver()).toBe('indexeddb');

    await new Promise<void>(resolve => {
      const request = indexedDB.open(dbName, 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });

    await outer.setItem('k', 'after');

    expect(outer.getDriver()).toBe('localstorage');
    expect(await outer.getItem('k')).toBe('after');
    expect(reported.join(' ')).toContain('IndexedDB write failed');
  });

  it('drops the connection on close so the next call re-opens', async () => {
    await store.setItem('k', 1);
    const openSpy = vi.spyOn(indexedDB, 'open');

    store.close();

    expect((store as any).db).toBeNull();
    expect((store as any).initPromise).toBeNull();

    await expect(store.getItem('k')).resolves.toBe(1);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('tolerates close() before anything opened', () => {
    expect(() => new IndexedDbStore('unit_never_opened', 'kv').close()).not.toThrow();
  });
});

describe('PersistentStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('prefers the IndexedDB tier when it opens', async () => {
    const store = new PersistentStore({ dbName: `unit_pref_${Date.now()}` });
    await store.init();

    expect(store.getDriver()).toBe('indexeddb');
  });

  it('round-trips through whichever tier is active', async () => {
    const store = new PersistentStore({ dbName: `unit_rt_${Date.now()}` });
    await store.setItem('k', { hello: 'world' });

    expect(await store.getItem('k')).toEqual({ hello: 'world' });
  });

  it('falls back to localStorage when IndexedDB will not open', async () => {
    const reported: string[] = [];
    vi.spyOn(IndexedDbStore.prototype, 'init').mockRejectedValue(new Error('no idb'));

    const store = new PersistentStore({ errorReporter: m => reported.push(m) });
    await store.setItem('k', 'v');

    expect(store.getDriver()).toBe('localstorage');
    expect(await store.getItem('k')).toBe('v');
    expect(reported.join(' ')).toContain('falling back to localStorage');
  });

  it('falls back mid-flight when a write fails after a successful open', async () => {
    // Storage evicted, or the database deleted underneath us. Dropping the batch
    // here would lose events that localStorage could still have held.
    const store = new PersistentStore({ dbName: `unit_midflight_${Date.now()}` });
    await store.init();
    expect(store.getDriver()).toBe('indexeddb');

    vi.spyOn(IndexedDbStore.prototype, 'setItem').mockRejectedValue(new Error('evicted'));
    await store.setItem('k', 'survived');

    expect(store.getDriver()).toBe('localstorage');
    expect(await store.getItem('k')).toBe('survived');
  });

  it('rejects when neither tier is available, so the queue can go in-memory', async () => {
    vi.spyOn(IndexedDbStore.prototype, 'init').mockRejectedValue(new Error('no idb'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    await expect(new PersistentStore().init()).rejects.toThrow('localStorage not available');
  });

  it('drops into RequestQueue with no queue-side changes', async () => {
    // The whole point of matching QueueStorage's interface: the queue does not
    // know which tier it is on.
    const store = new PersistentStore({ dbName: `unit_queue_${Date.now()}` });
    const queue = new RequestQueue('__unit_persistent_queue__', {
      usePersistence: true,
      queueStorage: store as any,
    });

    await queue.enqueue({ event: 'a' }, 1000);
    await queue.enqueue({ event: 'b' }, 1000);

    const batch = await queue.fillBatch(10);
    expect(batch.map(i => i.payload.event)).toEqual(['a', 'b']);
    expect(store.getDriver()).toBe('indexeddb');

    await queue.removeItemsByID([batch[0].id]);
    expect((await queue.fillBatch(10)).map(i => i.payload.event)).toEqual(['b']);
  });

  it('reports no driver before init has run', () => {
    expect(new PersistentStore().getDriver()).toBeNull();
  });

  it('opens the database once across repeated operations', async () => {
    // Asserted on `indexedDB.open`, not on `IndexedDbStore.init` — every request
    // calls init() through `transaction()` and relies on its cached promise, so the
    // call count is 3 by design. Two *opens* against one database is the actual
    // bug this guards (blocked transactions that never settle).
    const openSpy = vi.spyOn(indexedDB, 'open');
    const store = new PersistentStore({ dbName: `unit_cache_${Date.now()}` });

    await store.init();
    await store.init();
    await store.setItem('k', 1);
    await store.getItem('k');

    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('allows a retry after both tiers failed', async () => {
    // A rejected init must not be cached as settled: the blocking condition may
    // be gone by the next call, and the alternative is a tab stuck in memory-only
    // mode for its whole lifetime.
    const idbInit = vi.spyOn(IndexedDbStore.prototype, 'init').mockRejectedValue(new Error('no idb'));
    const lsSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    const store = new PersistentStore();

    await expect(store.init()).rejects.toThrow('localStorage not available');
    expect(store.getDriver()).toBeNull();

    idbInit.mockRestore();
    lsSet.mockRestore();

    await expect(store.init()).resolves.toBeUndefined();
    expect(store.getDriver()).toBe('indexeddb');
  });

  describe('each delegating method falls back on its own failure', () => {
    // One case per method, because the fallback is written out per method rather
    // than shared — an untested method is a method whose catch does nothing.
    const cases: Array<{
      method: 'getItem' | 'entries' | 'keys' | 'removeItems' | 'removeItem';
      message: string;
      call: (s: PersistentStore) => Promise<any>;
    }> = [
      { method: 'getItem', message: 'IndexedDB read failed', call: s => s.getItem('k') },
      { method: 'entries', message: 'IndexedDB scan failed', call: s => s.entries('q_') },
      { method: 'keys', message: 'IndexedDB key scan failed', call: s => s.keys('q_') },
      { method: 'removeItems', message: 'IndexedDB batch delete failed', call: s => s.removeItems(['k']) },
      { method: 'removeItem', message: 'IndexedDB delete failed', call: s => s.removeItem('k') },
    ];

    for (const { method, message, call } of cases) {
      it(`${method} reports "${message}" and switches tier`, async () => {
        const reported: string[] = [];
        const store = new PersistentStore({
          dbName: `unit_fb_${method}_${Date.now()}`,
          errorReporter: m => reported.push(m),
        });
        await store.init();
        expect(store.getDriver()).toBe('indexeddb');

        vi.spyOn(IndexedDbStore.prototype, method as any).mockRejectedValue(new Error('boom'));
        await call(store);

        expect(reported.join(' ')).toContain(message);
        expect(store.getDriver()).toBe('localstorage');
      });
    }
  });

  it('serves reads from localStorage once it has fallen back, and does not retry IndexedDB', async () => {
    // The fallback is one-way per page: retrying per operation would make every
    // read pay the failed-open cost, and the causes are not transient.
    const store = new PersistentStore({ dbName: `unit_oneway_${Date.now()}` });
    await store.init();

    const idbGet = vi.spyOn(IndexedDbStore.prototype, 'getItem').mockRejectedValue(new Error('gone'));
    await store.getItem('k');
    expect(store.getDriver()).toBe('localstorage');
    expect(idbGet).toHaveBeenCalledTimes(1);

    await store.setItem('k', 'from-ls');
    expect(await store.getItem('k')).toBe('from-ls');
    expect(idbGet).toHaveBeenCalledTimes(1);
  });

  it('delegates entries, keys and removals to the localStorage tier verbatim', async () => {
    vi.spyOn(IndexedDbStore.prototype, 'init').mockRejectedValue(new Error('no idb'));
    const store = new PersistentStore();
    await store.setItem('q_b', 2);
    await store.setItem('q_a', 1);
    await store.setItem('other', 9);
    expect(store.getDriver()).toBe('localstorage');

    expect(await store.entries('q_')).toEqual([
      { key: 'q_a', value: 1 },
      { key: 'q_b', value: 2 },
    ]);
    expect(await store.entries('q_', 1)).toEqual([{ key: 'q_a', value: 1 }]);
    expect(await store.keys('q_')).toEqual(['q_a', 'q_b']);

    await store.removeItem('q_a');
    expect(await store.keys('q_')).toEqual(['q_b']);

    await store.setItem('q_c', 3);
    await store.removeItems(['q_b', 'q_c']);
    expect(await store.keys('q_')).toEqual([]);
  });

  it('reads, scans and removes on the IndexedDB tier without touching localStorage', async () => {
    const store = new PersistentStore({ dbName: `unit_idb_ops_${Date.now()}` });
    await store.setItem('q_a', 1);
    await store.setItem('q_b', 2);
    expect(store.getDriver()).toBe('indexeddb');

    expect(await store.entries('q_')).toEqual([
      { key: 'q_a', value: 1 },
      { key: 'q_b', value: 2 },
    ]);
    expect(await store.keys('q_')).toEqual(['q_a', 'q_b']);

    await store.removeItems(['q_a']);
    expect(await store.keys('q_')).toEqual(['q_b']);
    await store.removeItem('q_b');
    expect(await store.keys('q_')).toEqual([]);

    // Nothing leaked to the fallback tier.
    expect(localStorage.getItem('q_a')).toBeNull();
  });

  it('survives a reload on the IndexedDB tier', async () => {
    const dbName = `unit_reload_${Date.now()}`;
    const first = new RequestQueue('__unit_reload_queue__', {
      usePersistence: true,
      queueStorage: new PersistentStore({ dbName }) as any,
    });
    await first.enqueue({ event: 'survives' }, 1000);

    const second = new RequestQueue('__unit_reload_queue__', {
      usePersistence: true,
      queueStorage: new PersistentStore({ dbName }) as any,
    });

    expect((await second.fillBatch(10)).map(i => i.payload.event)).toEqual(['survives']);
  });
});
