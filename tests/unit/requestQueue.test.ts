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

      // One record per event now, so age the record in place under its own key.
      const storage = new QueueStorage();
      const [entry] = await storage.entries(`${KEY}:i:`);
      await storage.setItem(entry.key, { ...entry.value, flushAfter: Date.now() - 1 });

      const batch = await makeQueue().fillBatch(10);
      expect(batch[0].orphaned).toBe(true);
    });

    it('returns events in FIFO order even when enqueued inside one millisecond', async () => {
      // Keys sort chronologically and a sequence number breaks ties; without it
      // a burst would come back in arbitrary order.
      const queue = makeQueue();
      for (let i = 0; i < 20; i++) {
        await queue.enqueue({ n: i }, 1000);
      }

      const batch = await makeQueue().fillBatch(20);
      expect(batch.map(i => i.payload.n)).toEqual(Array.from({ length: 20 }, (_, i) => i));
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
      // One record per event: exactly one key should remain under the prefix.
      expect(await new QueueStorage().keys(`${KEY}:i:`)).toHaveLength(1);
    });

    it('removes items queued by another tab, whose keys are not in memory', async () => {
      const other = makeQueue();
      await other.enqueue({ n: 1 }, 1000);

      // Fresh instance: memQueue is empty, so the key must be resolved from
      // storage rather than assumed to be known locally.
      const queue = makeQueue();
      const batch = await queue.fillBatch(10);
      expect(await queue.removeItemsByID([batch[0].id])).toBe(true);

      expect(await new QueueStorage().keys(`${KEY}:i:`)).toHaveLength(0);
    });

    it('is a no-op for unknown ids', async () => {
      const queue = makeQueue();
      await queue.enqueue({ n: 1 }, 1000);

      expect(await queue.removeItemsByID(['does-not-exist'])).toBe(true);
      expect(await queue.fillBatch(10)).toHaveLength(1);
    });

    it('reports false when the delete fails, so the batcher can back off', async () => {
      const queue = makeQueue();
      await queue.enqueue({ n: 1 }, 1000);
      const batch = await queue.fillBatch(10);

      // Removal no longer writes the queue back, so a failing setItem is no
      // longer the failure mode — a failing delete is.
      vi.spyOn(QueueStorage.prototype, 'removeItems').mockRejectedValue(new Error('delete failed'));

      expect(await queue.removeItemsByID([batch[0].id])).toBe(false);
    });

    it('does not rewrite the queue to remove one item', async () => {
      const queue = makeQueue();
      for (let i = 0; i < 5; i++) {
        await queue.enqueue({ n: i }, 1000);
      }
      const batch = await queue.fillBatch(10);

      const setItem = vi.spyOn(QueueStorage.prototype, 'setItem');
      await queue.removeItemsByID([batch[0].id]);

      // The array layout rewrote every remaining event on every removal. That
      // O(N) write is the thing this layout exists to delete.
      expect(setItem).not.toHaveBeenCalled();
    });
  });

  describe('legacy migration', () => {
    it('imports events written by the old single-array layout', async () => {
      // Customers have events sitting in this format at upgrade time. Dropping
      // them would be silent data loss on deploy, so this is not optional.
      const legacy = [
        { id: 'old-1', flushAfter: Date.now() + 10_000, payload: { n: 1 } },
        { id: 'old-2', flushAfter: Date.now() + 10_000, payload: { n: 2 } },
      ];
      localStorage.setItem(KEY, JSON.stringify(legacy));

      const batch = await makeQueue().fillBatch(10);

      expect(batch.map(i => i.payload.n)).toEqual([1, 2]);
      // The legacy key is removed so the import cannot run twice and duplicate.
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('leaves new-format events alone when no legacy data exists', async () => {
      const queue = makeQueue();
      await queue.enqueue({ n: 1 }, 1000);

      expect((await makeQueue().fillBatch(10)).map(i => i.payload.n)).toEqual([1]);
    });

    it('ignores malformed legacy entries rather than failing the import', async () => {
      localStorage.setItem(
        KEY,
        JSON.stringify([null, { no: 'id' }, { id: 'ok', flushAfter: Date.now() + 10_000, payload: { n: 7 } }]),
      );

      const batch = await makeQueue().fillBatch(10);
      expect(batch.map(i => i.payload.n)).toEqual([7]);
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

  describe('bounded queue', () => {
    it('holds the queue at the cap by dropping the oldest events', async () => {
      const queue = makeQueue({ maxQueuedEvents: 5 });
      for (let i = 0; i < 12; i++) {
        await queue.enqueue({ n: i }, 1000);
      }

      // Unbounded, this grows until the storage quota throws -- and a quota
      // failure is silent, so the loss is both larger and invisible.
      const batch = await queue.fillBatch(100);
      expect(batch).toHaveLength(5);

      // Drop OLDEST: recent events are the valuable ones (current session,
      // current funnel), so the survivors are the tail.
      expect(batch.map(i => i.payload.n)).toEqual([7, 8, 9, 10, 11]);
    });

    it('counts what it dropped instead of losing it silently', async () => {
      const reported: string[] = [];
      const queue = makeQueue({
        maxQueuedEvents: 5,
        errorReporter: (m: string) => reported.push(m),
      });
      for (let i = 0; i < 12; i++) {
        await queue.enqueue({ n: i }, 1000);
      }

      // The entire point of the cap: bounded loss with a number attached,
      // rather than unbounded loss nobody hears about.
      expect(queue.getDroppedEventCount()).toBe(7);
      expect(reported.join(' ')).toContain('Queue full');
    });

    it('caps the memory queue too when persistence is off', async () => {
      const queue = new RequestQueue(KEY, { usePersistence: false, maxQueuedEvents: 3 });
      for (let i = 0; i < 9; i++) {
        await queue.enqueue({ n: i }, 1000);
      }

      const batch = await queue.fillBatch(100);
      expect(batch.map(i => i.payload.n)).toEqual([6, 7, 8]);
      expect(queue.getDroppedEventCount()).toBe(6);
    });

    it('enforces the cap against events another tab queued', async () => {
      // Two instances on one storage key, as two tabs are. The second has never
      // seen the first's events in its own memQueue, so this exercises the
      // storage scan rather than the local estimate.
      const tabA = makeQueue({ maxQueuedEvents: 5 });
      for (let i = 0; i < 5; i++) {
        await tabA.enqueue({ n: i }, 1000);
      }

      const tabB = makeQueue({ maxQueuedEvents: 5 });
      await tabB.enqueue({ n: 99 }, 1000);

      // Read through a third instance: it has an empty memQueue, so fillBatch
      // reflects what is actually in storage rather than one tab's local view.
      const reader = makeQueue({ maxQueuedEvents: 5 });
      const stored = await reader.fillBatch(100);
      expect(stored).toHaveLength(5);
      expect(tabB.getDroppedEventCount()).toBe(1);

      // Deliberately NOT asserting *which* event went. The tiebreak sequence in
      // makeItemKey is per-instance, so two tabs writing inside the same
      // millisecond interleave arbitrarily and eviction can take an event a
      // fraction of a millisecond newer. Pre-existing ordering caveat, made
      // observable by the cap; see enforceQueueCap. The guarantee that matters
      // is that the cap holds across tabs at all.
    });

    it('leaves a queue under the cap completely alone', async () => {
      const queue = makeQueue({ maxQueuedEvents: 100 });
      for (let i = 0; i < 20; i++) {
        await queue.enqueue({ n: i }, 1000);
      }

      expect(await queue.fillBatch(100)).toHaveLength(20);
      expect(queue.getDroppedEventCount()).toBe(0);
    });

    it('does not reject an event when cap enforcement fails', async () => {
      const storage = new QueueStorage();
      const reported: string[] = [];
      const queue = makeQueue({
        maxQueuedEvents: 2,
        queueStorage: storage,
        errorReporter: (m: string) => reported.push(m),
      });
      await queue.enqueue({ n: 0 }, 1000);
      vi.spyOn(storage, 'keys').mockRejectedValue(new Error('scan failed'));

      // Housekeeping failing must not turn into a rejected event -- it is
      // already written at this point.
      expect(await queue.enqueue({ n: 1 }, 1000)).toBe(true);
      expect(await queue.enqueue({ n: 2 }, 1000)).toBe(true);
      expect(reported.join(' ')).toContain('Error enforcing queue cap');
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
