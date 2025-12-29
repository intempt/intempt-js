import { QueueStorage } from '../src/shared/storage/queueStorage.ts';

describe('QueueStorage', () => {
  let storage: QueueStorage;
  const testKey = '__test_queue_storage__';

  beforeEach(() => {
    storage = new QueueStorage();
    // Clear test data
    localStorage.removeItem(testKey);
  });

  afterEach(() => {
    localStorage.removeItem(testKey);
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await storage.init();
      // Should not throw
      expect(true).to.be.true;
    });

    it('should handle multiple init calls', async () => {
      await storage.init();
      await storage.init();
      await storage.init();
      // Should not throw
      expect(true).to.be.true;
    });
  });

  describe('Storage Operations', () => {
    it('should store and retrieve items', async () => {
      const testData = { event: 'test', data: [1, 2, 3] };
      await storage.setItem(testKey, testData);
      const retrieved = await storage.getItem(testKey);
      expect(retrieved).to.deep.equal(testData);
    });

    it('should return null for non-existent items', async () => {
      const retrieved = await storage.getItem('non_existent_key');
      expect(retrieved).to.be.null;
    });

    it('should remove items', async () => {
      await storage.setItem(testKey, { test: 'data' });
      await storage.removeItem(testKey);
      const retrieved = await storage.getItem(testKey);
      expect(retrieved).to.be.null;
    });

    it('should handle complex nested objects', async () => {
      const complexData = {
        events: [
          { id: 1, name: 'event1' },
          { id: 2, name: 'event2' }
        ],
        metadata: { timestamp: Date.now() }
      };
      await storage.setItem(testKey, complexData);
      const retrieved = await storage.getItem(testKey);
      expect(retrieved).to.deep.equal(complexData);
    });

    it('should handle arrays', async () => {
      const arrayData = [{ id: 1 }, { id: 2 }, { id: 3 }];
      await storage.setItem(testKey, arrayData);
      const retrieved = await storage.getItem(testKey);
      expect(retrieved).to.deep.equal(arrayData);
    });
  });

  describe('Error Handling', () => {
    it('should handle corrupted JSON gracefully', async () => {
      // Manually set corrupted JSON
      localStorage.setItem(testKey, 'invalid-json{');
      const retrieved = await storage.getItem(testKey);
      // Should return null or handle gracefully
      expect(retrieved).to.be.null;
    });
  });
});

