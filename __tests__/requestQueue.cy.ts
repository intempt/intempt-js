import { RequestQueue } from '../src/shared/queue/requestQueue.ts';
import { QueueStorage } from '../src/shared/storage/queueStorage.ts';

describe('RequestQueue', () => {
  let queue: RequestQueue;
  const storageKey = '__test_request_queue__';

  beforeEach(() => {
    localStorage.removeItem(storageKey);
    queue = new RequestQueue(storageKey, {
      usePersistence: true,
      queueStorage: new QueueStorage()
    });
  });

  afterEach(async () => {
    await queue.clear();
    localStorage.removeItem(storageKey);
  });

  describe('Enqueue Operations', () => {
    it('should enqueue items successfully', async () => {
      const item = { event: 'test', data: { id: 1 } };
      const result = await queue.enqueue(item, 5000);
      expect(result).to.be.true;
    });

    it('should enqueue multiple items', async () => {
      const items = [
        { event: 'test1', data: { id: 1 } },
        { event: 'test2', data: { id: 2 } },
        { event: 'test3', data: { id: 3 } }
      ];

      for (const item of items) {
        await queue.enqueue(item, 5000);
      }

      const batch = await queue.fillBatch(10);
      expect(batch.length).to.equal(3);
    });
  });

  describe('Batch Operations', () => {
    it('should fill batch up to batch size', async () => {
      // Enqueue 10 items
      for (let i = 0; i < 10; i++) {
        await queue.enqueue({ event: `test${i}` }, 5000);
      }

      const batch = await queue.fillBatch(5);
      expect(batch.length).to.equal(5);
    });

    it('should return all items if batch size is larger', async () => {
      for (let i = 0; i < 3; i++) {
        await queue.enqueue({ event: `test${i}` }, 5000);
      }

      const batch = await queue.fillBatch(10);
      expect(batch.length).to.equal(3);
    });

    it('should include orphaned items from storage', async () => {
      // Manually add orphaned item to storage
      const orphanedItem = {
        id: 'orphan_123',
        flushAfter: Date.now() - 1000, // Expired
        payload: { event: 'orphaned' }
      };
      localStorage.setItem(storageKey, JSON.stringify([orphanedItem]));

      const batch = await queue.fillBatch(10);
      expect(batch.length).to.be.greaterThan(0);
      expect(batch[0].orphaned).to.be.true;
    });
  });

  describe('Remove Operations', () => {
    it('should remove items by ID', async () => {
      await queue.enqueue({ event: 'test1' }, 5000);
      await queue.enqueue({ event: 'test2' }, 5000);
      
      const batch = await queue.fillBatch(10);
      const ids = batch.map(item => item.id);

      const result = await queue.removeItemsByID(ids);
      expect(result).to.be.true;

      const newBatch = await queue.fillBatch(10);
      expect(newBatch.length).to.equal(0);
    });

    it('should handle removing non-existent IDs', async () => {
      const result = await queue.removeItemsByID(['non_existent_id']);
      expect(result).to.be.true;
    });
  });

  describe('Persistence', () => {
    it('should persist items across queue instances', async () => {
      await queue.enqueue({ event: 'persistent' }, 5000);
      
      // Create new queue instance
      const newQueue = new RequestQueue(storageKey, {
        usePersistence: true,
        queueStorage: new QueueStorage()
      });

      const batch = await newQueue.fillBatch(10);
      expect(batch.length).to.equal(1);
      expect(batch[0].payload.event).to.equal('persistent');
    });

    it('should work without persistence', async () => {
      const memoryQueue = new RequestQueue(storageKey, {
        usePersistence: false
      });

      await memoryQueue.enqueue({ event: 'memory' }, 5000);
      const batch = await memoryQueue.fillBatch(10);
      expect(batch.length).to.equal(1);
    });
  });

  describe('Clear Operations', () => {
    it('should clear all items', async () => {
      for (let i = 0; i < 5; i++) {
        await queue.enqueue({ event: `test${i}` }, 5000);
      }

      await queue.clear();
      const batch = await queue.fillBatch(10);
      expect(batch.length).to.equal(0);
    });
  });
});

