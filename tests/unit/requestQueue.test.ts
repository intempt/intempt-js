import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestQueue } from '../../src/shared/queue/requestQueue.ts';
import { QueueStorage } from '../../src/shared/storage/queueStorage.ts';

const KEY = '__unit_queue__';

function makeQueue(overrides: Record<string, any> = {}) {
  return new RequestQueue(KEY, {
    usePersistence: true,
    queueStorage: new QueueStorage(),
    ...overrides,
  });
}

describe('RequestQueue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('enqueue', () => {
    it('persists across instances — a reload must not lose queued events', async () => {
      const first = makeQueue();
      await first.enqueue({ event: 'a' }, 1000);
      await first.enqueue({ event: 'b' }, 1000);

      const second = makeQueue();
      const batch = await second.fillBatch(10);

      expect(batch.map(i => i.payload.event)).toEqual(['a', 'b']);
    });

    it('falls back to the memory queue when persistence is off', async () => {
      const queue = new RequestQueue(KEY, { usePersistence: false });
      expect(await queue.enqueue({ event: 'a' }, 1000)).toBe(true);
      expect(localStorage.getItem(KEY)).toBeNull();
      expect(await queue.fillBatch(10)).toHaveLength(1);
    });

    it('keeps the event in memory and reports when a storage write fails', async () => {
      const reported: string[] = [];
      const storage = new QueueStorage();
      vi.spyOn(storage, 'setItem').mockRejectedValue(new Error('QuotaExceededError'));

      const queue = makeQueue({ queueStorage: storage, errorReporter: (m: string) => reported.push(m) });
      const ok = await queue.enqueue({ event: 'a' }, 1000);

      // Reported as a failure, but the event is NOT dropped — losing it would
      // be the worse outcome, and the memory queue can still flush it.
      expect(ok).toBe(false);
      expect(reported.join(' ')).toContain('Error enqueueing item');
      expect(await queue.fillBatch(10)).toHaveLength(1);
    });
  });

  describe('fillBatch', () => {
    it('returns at most batchSize items, oldest first', async () => {
      const queue = makeQueue();
      for (let i = 0; i < 5; i++) {
        await queue.enqueue({ n: i }, 1000);
      }

      const batch = await queue.fillBatch(3);
      expect(batch.map(i => i.payload.n)).toEqual([0, 1, 2]);
    });

    it('is non-destructive — reading a batch does not dequeue it', async () => {
      const queue = makeQueue();
      await queue.enqueue({ n: 1 }, 1000);

      await queue.fillBatch(10);
      expect(await queue.fillBatch(10)).toHaveLength(1);
    });

    it('marks items past flushAfter as orphaned', async () => {
      // Orphaned means "another tab queued this and never sent it". The batcher
      // uses the flag to skip beforeSendHook, so it has to survive a reload.
      const queue = makeQueue();
      await queue.enqueue({ n: 1 }, 1000);

      const stored = JSON.parse(localStorage.getItem(KEY) as string);
      stored[0].flushAfter = Date.now() - 1;
      localStorage.setItem(KEY, JSON.stringify(stored));

      const batch = await makeQueue().fillBatch(10);
      expect(batch[0].orphaned).toBe(true);
    });

    it('returns an empty batch for an empty queue', async () => {
      expect(await makeQueue().fillBatch(10)).toEqual([]);
    });

    it('survives corrupt stored JSON without throwing', async () => {
      localStorage.setItem(KEY, 'not json at all');
      expect(await makeQueue().fillBatch(10)).toEqual([]);
    });

    it('ignores a stored value that is not an array', async () => {
      localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
      expect(await makeQueue().fillBatch(10)).toEqual([]);
    });
  });

  describe('removeItemsByID', () => {
    it('removes from both memory and storage', async () => {
      const queue = makeQueue();
      await queue.enqueue({ n: 1 }, 1000);
      await queue.enqueue({ n: 2 }, 1000);

      const batch = await queue.fillBatch(10);
      expect(await queue.removeItemsByID([batch[0].id])).toBe(true);

      expect((await queue.fillBatch(10)).map(i => i.payload.n)).toEqual([2]);
      expect(JSON.parse(localStorage.getItem(KEY) as string)).toHaveLength(1);
    });

    it('is a no-op for unknown ids', async () => {
      const queue = makeQueue();
      await queue.enqueue({ n: 1 }, 1000);

      expect(await queue.removeItemsByID(['does-not-exist'])).toBe(true);
      expect(await queue.fillBatch(10)).toHaveLength(1);
    });

    it('reports false when the write fails, so the batcher can back off', async () => {
      const queue = makeQueue();
      await queue.enqueue({ n: 1 }, 1000);
      const batch = await queue.fillBatch(10);

      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      expect(await queue.removeItemsByID([batch[0].id])).toBe(false);
    });
  });

  describe('clear', () => {
    it('empties memory and storage', async () => {
      const queue = makeQueue();
      await queue.enqueue({ n: 1 }, 1000);

      await queue.clear();

      expect(await queue.fillBatch(10)).toEqual([]);
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  describe('persistence failure', () => {
    it('degrades to memory-only rather than throwing', async () => {
      const reported: string[] = [];
      const storage = new QueueStorage();
      vi.spyOn(storage, 'init').mockRejectedValue(new Error('localStorage not available'));

      const queue = makeQueue({ queueStorage: storage, errorReporter: (m: string) => reported.push(m) });
      await queue.ensureInit();

      expect(reported.join(' ')).toContain('Disabling persistence');
      expect(await queue.enqueue({ n: 1 }, 1000)).toBe(true);
    });
  });
});
