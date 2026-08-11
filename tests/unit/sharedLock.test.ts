import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedLock } from '../../src/shared/storage/sharedLock.ts';
import { QueueStorage } from '../../src/shared/storage/queueStorage.ts';

const KEY = 'unit_lock';
const STORAGE_KEY = `__intempt_lock_${KEY}__`;

function makeLock(pid: string, timeoutMS = 500) {
  return new SharedLock(KEY, { storage: window.localStorage, timeoutMS, pid });
}

/**
 * The lock is what stops two tabs from interleaving a read-modify-write on the
 * same queue and losing events. Its failure mode is invisible in single-tab
 * manual testing, which is exactly why it needs unit cover.
 */
describe('SharedLock', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('runs the critical section and releases afterwards', async () => {
    const result = await makeLock('pid-a').withLock(async () => 'done');

    expect(result).toBe('done');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('releases the lock even when the critical section throws', async () => {
    await expect(
      makeLock('pid-a').withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // A lock leaked on the error path wedges every other tab until it expires.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('serialises concurrent holders — no interleaving', async () => {
    const order: string[] = [];

    const critical = (name: string) => async () => {
      order.push(`${name}:enter`);
      await new Promise(resolve => setTimeout(resolve, 10));
      order.push(`${name}:exit`);
    };

    await Promise.all([
      makeLock('pid-a', 2000).withLock(critical('a')),
      makeLock('pid-b', 2000).withLock(critical('b')),
    ]);

    // Whoever wins, one must fully finish before the other starts.
    expect(order).toHaveLength(4);
    expect(order[1]).toBe(`${order[0].split(':')[0]}:exit`);
    expect(order[3]).toBe(`${order[2].split(':')[0]}:exit`);
  });

  it('breaks a stale lock left behind by a crashed tab', async () => {
    // A tab that dies mid-section never releases. Without expiry, one crash
    // would freeze the queue for every other tab permanently.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pid: 'dead-tab', timestamp: Date.now() - 60_000 }),
    );

    await expect(makeLock('pid-a').withLock(async () => 'ok')).resolves.toBe('ok');
  });

  it('does not steal a lock that is still fresh', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pid: 'other-tab', timestamp: Date.now() }),
    );

    await expect(makeLock('pid-a', 200).withLock(async () => 'ok')).rejects.toThrow(
      'Failed to acquire lock',
    );
  });

  it('does not release a lock it does not own', async () => {
    const lock = makeLock('pid-a');
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pid: 'other-tab', timestamp: Date.now() }),
    );

    (lock as any).releaseLock();

    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('fails cleanly when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    await expect(makeLock('pid-a', 200).withLock(async () => 'ok')).rejects.toThrow(
      'Failed to acquire lock',
    );
  });

  it('generates a distinct pid per instance when none is supplied', () => {
    const a = new SharedLock(KEY, { storage: window.localStorage, timeoutMS: 100 });
    const b = new SharedLock(KEY, { storage: window.localStorage, timeoutMS: 100 });

    expect((a as any).pid).not.toBe((b as any).pid);
  });
});

describe('QueueStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a value as JSON', async () => {
    const storage = new QueueStorage();
    await storage.setItem('k', [{ a: 1 }]);
    expect(await storage.getItem('k')).toEqual([{ a: 1 }]);
  });

  it('returns null for a missing key', async () => {
    expect(await new QueueStorage().getItem('nope')).toBeNull();
  });

  it('returns null rather than throwing on corrupt JSON', async () => {
    localStorage.setItem('corrupt', '{{{');
    expect(await new QueueStorage().getItem('corrupt')).toBeNull();
  });

  it('removes a key', async () => {
    const storage = new QueueStorage();
    await storage.setItem('k', 1);
    await storage.removeItem('k');
    expect(await storage.getItem('k')).toBeNull();
  });

  it('propagates a quota error on write so the caller can react', async () => {
    const storage = new QueueStorage();
    await storage.init();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    // Swallowing this would let the queue believe it persisted when it did not.
    await expect(storage.setItem('k', 1)).rejects.toThrow('QuotaExceededError');
  });

  it('reports unavailable storage at init', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    await expect(new QueueStorage().init()).rejects.toThrow('localStorage not available');
  });
});
