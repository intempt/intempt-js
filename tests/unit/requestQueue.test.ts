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

  // --- Assertions driven by the mutation baseline (CHECKPOINT.md §3f) --------
  //
  // requestQueue.ts scored 54.96% while its lines were 90%+ covered: the code
  // ran, but the specific conditions below could be changed with the whole suite
  // still green. Each test names the mutant it kills, because that is the only
  // way a later reader can tell a load-bearing assertion from an incidental one.

  describe('legacy migration — guard conditions', () => {
    /** Write a pre-per-event-record queue: one JSON array under the base key. */
    async function seedLegacy(entries: any[]) {
      const storage = new QueueStorage();
      await storage.setItem(KEY, entries);
      return storage;
    }

    it('runs at most once per instance, even across several reads', async () => {
      // Kills `if (this.migrated || ...)`. Without the flag the import re-runs on
      // every read; the legacy key is deleted after the first pass, so a second
      // run is a no-op *today* — but it would become duplicate imports the moment
      // deletion fails. Asserting the flag, not just the outcome.
      const storage = await seedLegacy([{ id: 'l1', payload: { n: 1 }, flushAfter: 1 }]);
      const queue = makeQueue({ queueStorage: storage });

      await queue.fillBatch(10);
      const setSpy = vi.spyOn(storage, 'setItem');
      await queue.fillBatch(10);

      expect((queue as any).migrated).toBe(true);
      expect(setSpy, 'a second read must not re-import').not.toHaveBeenCalled();
    });

    it('does not touch storage at all when persistence is off', async () => {
      // Kills `|| !this.usePersistence`.
      const queue = new RequestQueue(KEY, { usePersistence: false });
      await queue.fillBatch(10);
      expect((queue as any).migrated, 'the migration must not even be marked done').toBe(false);
    });

    it('leaves a non-array legacy value alone rather than importing it', async () => {
      // Kills `!Array.isArray(legacy)`. A string or object under the base key is
      // someone else's data or a corrupt write; importing it would fabricate
      // events.
      const storage = new QueueStorage();
      await storage.setItem(KEY, { not: 'an array' });
      const queue = makeQueue({ queueStorage: storage });

      expect(await queue.fillBatch(10)).toHaveLength(0);
      expect(await storage.getItem(KEY), 'and it must not be deleted either').toEqual({
        not: 'an array',
      });
    });

    it('leaves an empty legacy array alone', async () => {
      // Kills `legacy.length === 0`.
      const storage = await seedLegacy([]);
      const queue = makeQueue({ queueStorage: storage });

      expect(await queue.fillBatch(10)).toHaveLength(0);
      expect(await storage.getItem(KEY)).toEqual([]);
    });

    it('skips malformed legacy entries but imports the rest', async () => {
      // Kills the three-part entry guard at `!entry || typeof entry !== 'object'
      // || !entry.id`. One bad row in a customer's legacy array must cost that
      // row, not the migration.
      const storage = await seedLegacy([
        null,
        'a string',
        { payload: { n: 'no id' } },
        { id: 'good-1', payload: { n: 1 }, flushAfter: 1 },
        { id: 'good-2', payload: { n: 2 }, flushAfter: 1 },
      ]);
      const queue = makeQueue({ queueStorage: storage });

      const batch = await queue.fillBatch(10);
      expect(batch.map(i => i.id).sort()).toEqual(['good-1', 'good-2']);
    });

    it('gives a legacy entry with no flushAfter an immediate deadline', async () => {
      // Kills `entry.flushAfter || Date.now()`. Falling back to 0/undefined would
      // sort the event to the head forever or make its key unparseable; falling
      // back to now means it flushes on the next pass, which is the intent.
      const storage = await seedLegacy([{ id: 'no-deadline', payload: { n: 1 } }]);
      const queue = makeQueue({ queueStorage: storage });

      const batch = await queue.fillBatch(10);
      expect(batch).toHaveLength(1);
      expect(typeof batch[0].flushAfter).toBe('number');
      expect(batch[0].flushAfter).toBeGreaterThan(0);
    });

    it('deletes the legacy key so the import cannot run twice', async () => {
      // Kills the `removeItem(this.storageKey)` call. If it survives, every page
      // load re-imports the same events — unbounded duplication at ingest.
      const storage = await seedLegacy([{ id: 'l1', payload: { n: 1 }, flushAfter: 1 }]);
      const queue = makeQueue({ queueStorage: storage });

      await queue.fillBatch(10);
      expect(await storage.getItem(KEY)).toBeNull();
    });

    it('reports a failed migration and still serves new events', async () => {
      // Kills the catch body. A migration that throws must not take the queue
      // down with it.
      const storage = new QueueStorage();
      await storage.setItem(KEY, [{ id: 'l1', payload: { n: 1 }, flushAfter: 1 }]);
      vi.spyOn(storage, 'removeItem').mockRejectedValue(new Error('boom'));

      const reported: string[] = [];
      const queue = makeQueue({
        queueStorage: storage,
        errorReporter: (m: string) => reported.push(m),
      });

      await queue.fillBatch(10);
      expect(reported.join(' ')).toContain('Error migrating legacy queue');
      expect(await queue.enqueue({ n: 99 }, 1000)).toBe(true);
    });
  });

  describe('readFromStorage — failure and corruption paths', () => {
    it('reports a read failure and returns an empty batch instead of throwing', async () => {
      // Kills the catch body at readFromStorage: swallowing to [] is what keeps a
      // storage fault from surfacing as an exception inside the host page.
      const storage = new QueueStorage();
      vi.spyOn(storage, 'entries').mockRejectedValue(new Error('read fail'));
      const reported: string[] = [];
      const queue = makeQueue({
        queueStorage: storage,
        errorReporter: (m: string) => reported.push(m),
      });

      expect(await queue.fillBatch(10)).toEqual([]);
      expect(reported.join(' ')).toContain('Error reading from storage');
    });

    it('skips a corrupt record rather than failing the whole read', async () => {
      // Kills `value && typeof value === 'object' ? … : null` plus the
      // .filter(Boolean). Under the old whole-array layout one bad write made the
      // entire queue unreadable; per-event records are supposed to cost one event.
      const storage = new QueueStorage();
      const queue = makeQueue({ queueStorage: storage });
      await queue.enqueue({ n: 1 }, 1000);

      const itemKey = (await storage.keys(`${KEY}:i:`))[0];
      await storage.setItem(itemKey, 'not an object');
      await storage.setItem(`${KEY}:i:9999999999999_0_zz`, { id: 'zz', payload: { n: 2 }, flushAfter: 1 });

      const batch = await (makeQueue({ queueStorage: storage })).fillBatch(10);
      expect(batch.map(i => i.id)).toEqual(['zz']);
    });
  });

  describe('fillBatch — orphan adoption', () => {
    /** Seed a record directly, as another tab would have written it. */
    async function seedItem(storage: QueueStorage, id: string, flushAfter: number, ts = 1) {
      await storage.setItem(`${KEY}:i:${String(ts).padStart(16, '0')}_0_${id}`, {
        id,
        payload: { id },
        flushAfter,
      });
    }

    it('marks an item past its deadline as orphaned, and one still waiting as not', async () => {
      // Kills `now > item.flushAfter` on the memQueue-init path. Getting this
      // backwards either re-sends live items or never adopts stranded ones.
      const storage = new QueueStorage();
      await seedItem(storage, 'ripe', Date.now() - 5_000, 1);
      await seedItem(storage, 'fresh', Date.now() + 60_000, 2);

      const batch = await makeQueue({ queueStorage: storage }).fillBatch(10);
      const byId = Object.fromEntries(batch.map(i => [i.id, i]));
      expect(byId['ripe'].orphaned).toBe(true);
      expect(byId['fresh'].orphaned).toBeUndefined();
    });

    it('does not run the orphan scan when the batch is already full', async () => {
      // Kills `batch.length < batchSize`. Scanning anyway costs a full key listing
      // per flush — the O(N) cost per-event records exist to remove.
      const storage = new QueueStorage();
      const queue = makeQueue({ queueStorage: storage });
      await queue.enqueue({ n: 1 }, -1);
      await queue.enqueue({ n: 2 }, -1);

      const keysSpy = vi.spyOn(storage, 'keys');
      const entriesSpy = vi.spyOn(storage, 'entries');
      const batch = await queue.fillBatch(2);

      expect(batch).toHaveLength(2);
      expect(keysSpy).not.toHaveBeenCalled();
      expect(entriesSpy, 'no second read once the batch is full').not.toHaveBeenCalled();
    });

    it('stops adopting orphans at batchSize', async () => {
      // Kills the `if (batch.length >= batchSize) break;` inside the orphan loop.
      // Without it a deep queue returns more than batchSize items and the batcher
      // sends an oversized request — a 413 at best.
      const storage = new QueueStorage();
      for (let i = 0; i < 6; i++) {
        await seedItem(storage, `orphan-${i}`, Date.now() - 1_000, i + 1);
      }

      const batch = await makeQueue({ queueStorage: storage }).fillBatch(3);
      expect(batch).toHaveLength(3);
    });

    it('never adopts an orphan that is already in the batch', async () => {
      // Kills `!idsInBatch.has(item.id)` and the `idsInBatch.add` that follows.
      // A duplicate here is a duplicate delivered event — the invariant §6a's
      // property tests exist to protect.
      const storage = new QueueStorage();
      const queue = makeQueue({ queueStorage: storage });
      await queue.enqueue({ n: 1 }, -1);

      const batch = await queue.fillBatch(10);
      const ids = batch.map(i => i.id);
      expect(new Set(ids).size, 'no id may appear twice').toBe(ids.length);
      expect(batch).toHaveLength(1);
    });
  });

  describe('removeItemsByID — key resolution', () => {
    it('resolves keys from storage for items this tab never queued', async () => {
      // Kills `keys.length !== idSet.size`. Items written by another tab are not
      // in memQueue, so skipping the storage scan leaves them queued forever and
      // they get re-sent on every flush.
      const storage = new QueueStorage();
      const tabA = makeQueue({ queueStorage: storage });
      await tabA.enqueue({ n: 1 }, 1000);
      const [item] = await tabA.fillBatch(10);

      const tabB = makeQueue({ queueStorage: storage });
      expect(await tabB.removeItemsByID([item.id])).toBe(true);
      expect(await makeQueue({ queueStorage: storage }).fillBatch(10)).toHaveLength(0);
    });

    it('matches a key by its full id suffix, not a partial one', async () => {
      // Kills the `key.endsWith('_' + id)` predicate. A prefix or substring match
      // would delete a *different* event whose id merely starts the same way —
      // silent loss that no other assertion would catch.
      const storage = new QueueStorage();
      const queue = makeQueue({ queueStorage: storage });
      await storage.setItem(`${KEY}:i:0000000000000001_0_abc`, { id: 'abc', payload: {}, flushAfter: 1 });
      await storage.setItem(`${KEY}:i:0000000000000002_0_abcdef`, { id: 'abcdef', payload: {}, flushAfter: 1 });

      await queue.removeItemsByID(['abc']);

      const left = await makeQueue({ queueStorage: storage }).fillBatch(10);
      expect(left.map(i => i.id), 'abcdef must survive removal of abc').toEqual(['abcdef']);
    });

    it('reports a removal failure and returns false', async () => {
      // Kills the catch body. The batcher keys its retain-or-retry decision off
      // this boolean, so returning true on failure means dropped events.
      const storage = new QueueStorage();
      const reported: string[] = [];
      const queue = makeQueue({
        queueStorage: storage,
        errorReporter: (m: string) => reported.push(m),
      });
      await queue.enqueue({ n: 1 }, 1000);
      const [item] = await queue.fillBatch(10);

      vi.spyOn(storage, 'removeItems').mockRejectedValue(new Error('remove fail'));

      expect(await queue.removeItemsByID([item.id])).toBe(false);
      expect(reported.join(' ')).toContain('Error removing items');
    });

    it('returns true without touching storage in memory-only mode', async () => {
      // Kills the early `return true` when usePersistence is false.
      const queue = new RequestQueue(KEY, { usePersistence: false });
      await queue.enqueue({ n: 1 }, 1000);
      const [item] = await queue.fillBatch(10);

      expect(await queue.removeItemsByID([item.id])).toBe(true);
      expect(await queue.fillBatch(10)).toHaveLength(0);
    });

    it('decrements the cap estimate by what it removed, never below zero', async () => {
      // Kills `Math.max(0, …)` and the `> 0` guard. A negative estimate would
      // disable the cap scan; an un-decremented one would trigger it constantly.
      const storage = new QueueStorage();
      const queue = makeQueue({ queueStorage: storage });
      for (let i = 0; i < 3; i++) await queue.enqueue({ n: i }, 1000);
      expect((queue as any).approxQueuedCount).toBe(3);

      const batch = await queue.fillBatch(10);
      await queue.removeItemsByID(batch.map(i => i.id));

      expect((queue as any).approxQueuedCount).toBe(0);

      // Removing again must not drive it negative.
      await queue.removeItemsByID(['nonexistent']);
      expect((queue as any).approxQueuedCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clear — full teardown', () => {
    it('removes per-event records, the legacy array, and resets the estimate', async () => {
      // Kills the three storage calls in clear() plus `approxQueuedCount = 0`.
      // This is the path a consent withdrawal takes: anything left behind is data
      // the customer asked to be rid of.
      const storage = new QueueStorage();
      await storage.setItem(KEY, [{ id: 'legacy', payload: {}, flushAfter: 1 }]);
      const queue = makeQueue({ queueStorage: storage });
      await queue.enqueue({ n: 1 }, 1000);
      await queue.enqueue({ n: 2 }, 1000);

      await queue.clear();

      expect((queue as any).approxQueuedCount).toBe(0);
      expect(await storage.keys(`${KEY}:i:`)).toEqual([]);
      expect(await storage.getItem(KEY)).toBeNull();
      expect(await makeQueue({ queueStorage: storage }).fillBatch(10)).toHaveLength(0);
    });

    it('reports a clear failure without throwing into the caller', async () => {
      // Kills the catch body. clear() is called from consent handling, which must
      // never throw back into a banner's click handler.
      const storage = new QueueStorage();
      const reported: string[] = [];
      const queue = makeQueue({
        queueStorage: storage,
        errorReporter: (m: string) => reported.push(m),
      });
      await queue.enqueue({ n: 1 }, 1000);

      vi.spyOn(storage, 'removeItems').mockRejectedValue(new Error('clear fail'));

      await expect(queue.clear()).resolves.toBeUndefined();
      expect(reported.join(' ')).toContain('Error clearing queue');
    });

    it('empties the memory queue even with persistence off', async () => {
      const queue = new RequestQueue(KEY, { usePersistence: false });
      await queue.enqueue({ n: 1 }, 1000);
      await queue.clear();
      expect(await queue.fillBatch(10)).toHaveLength(0);
    });
  });

  describe('generateId', () => {
    it('does not collide across a burst within one millisecond', async () => {
      // §6a defect 3 was a colliding id generator that merged two visitors'
      // data. This queue's own generator is a different function from the one
      // that was fixed, and it was unasserted.
      const queue = makeQueue();
      const ids = new Set<string>();
      for (let i = 0; i < 5_000; i++) {
        ids.add((queue as any).generateId());
      }
      expect(ids.size).toBe(5_000);
    });

    it('embeds a sortable timestamp so key order stays FIFO', () => {
      const queue = makeQueue();
      const id = (queue as any).generateId();
      const [ts] = id.split('_');
      expect(Number(ts)).toBeGreaterThan(1_600_000_000_000);
    });
  });
});
