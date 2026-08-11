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
