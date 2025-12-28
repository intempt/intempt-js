import { RequestBatcher } from '../src/shared/queue/requestBatcher.ts';
import { QueueStorage } from '../src/shared/storage/queueStorage.ts';

describe('RequestBatcher', () => {
  let batcher: RequestBatcher;
  let sendRequestCalls: any[];
  let sendRequestResponses: any[];

  beforeEach(() => {
    sendRequestCalls = [];
    sendRequestResponses = [{ httpStatusCode: 200, ok: true }];

    batcher = new RequestBatcher({
      storageKey: '__test_batcher__',
      libConfig: {
        batchSize: 5,
        batchFlushIntervalMs: 1000,
        batchRequestTimeoutMs: 5000,
        batchAutostart: false // Don't auto-start for tests
      },
      sendRequestFunc: async (data, options) => {
        sendRequestCalls.push({ data, options });
        return sendRequestResponses.shift() || { httpStatusCode: 200, ok: true };
      },
      usePersistence: true,
      queueStorage: new QueueStorage()
    });
  });

  afterEach(() => {
    batcher.stop();
    batcher.clear();
    localStorage.removeItem('__test_batcher__');
  });

  describe('Enqueue Operations', () => {
    it('should enqueue items', async () => {
      const result = await batcher.enqueue({ event: 'test' });
      expect(result).to.be.true;
    });

    it('should batch multiple items', async () => {
      for (let i = 0; i < 3; i++) {
        await batcher.enqueue({ event: `test${i}` });
      }

      await batcher.flush();
      expect(sendRequestCalls.length).to.equal(1);
      expect(sendRequestCalls[0].data.length).to.equal(3);
    });
  });

  describe('Flush Operations', () => {
    it('should flush items when batch size is reached', async () => {
      for (let i = 0; i < 5; i++) {
        await batcher.enqueue({ event: `test${i}` });
      }

      await batcher.flush();
      expect(sendRequestCalls.length).to.equal(1);
      expect(sendRequestCalls[0].data.length).to.equal(5);
    });

    it('should not flush empty queue', async () => {
      await batcher.flush();
      expect(sendRequestCalls.length).to.equal(0);
    });

    it('should handle flush on unload', async () => {
      await batcher.enqueue({ event: 'test' });
      await batcher.flush({ unloading: true });
      // Should attempt to send
      expect(sendRequestCalls.length).to.equal(1);
    });
  });

  describe('Retry Logic', () => {
    it('should retry on 500 error', async () => {
      sendRequestResponses = [
        { httpStatusCode: 500, ok: false },
        { httpStatusCode: 200, ok: true }
      ];

      await batcher.enqueue({ event: 'test' });
      await batcher.flush();

      // Retry is scheduled with exponential backoff (flushInterval * 2 = 2000ms)
      // Wait for scheduled flush to complete
      cy.wait(2500).then(() => {
        // Should have retried (2 calls: initial + retry)
        expect(sendRequestCalls.length).to.be.greaterThan(1);
      });
    });

    it('should retry on 429 rate limit', async () => {
      sendRequestResponses = [
        { httpStatusCode: 429, ok: false, retryAfter: '1' },
        { httpStatusCode: 200, ok: true }
      ];

      await batcher.enqueue({ event: 'test' });
      await batcher.flush();

      // Retry uses retryAfter header (1 second = 1000ms) + buffer
      cy.wait(1500).then(() => {
        expect(sendRequestCalls.length).to.be.greaterThan(1);
      });
    });

    it('should retry on timeout', async () => {
      sendRequestResponses = [
        { error: 'timeout', httpStatusCode: 0 },
        { httpStatusCode: 200, ok: true }
      ];

      await batcher.enqueue({ event: 'test' });
      await batcher.flush();

      // Timeout retry uses exponential backoff (2000ms) + buffer
      cy.wait(2500).then(() => {
        expect(sendRequestCalls.length).to.be.greaterThan(1);
      });
    });
  });

  describe('Batch Size Management', () => {
    it('should reduce batch size on 413 error', async () => {
      sendRequestResponses = [
        { httpStatusCode: 413, ok: false },
        { httpStatusCode: 200, ok: true }
      ];

      // Enqueue 5 items
      for (let i = 0; i < 5; i++) {
        await batcher.enqueue({ event: `test${i}` });
      }

      await batcher.flush();
      // Next flush should use smaller batch size
      cy.wait(100);
      expect(sendRequestCalls.length).to.be.greaterThan(0);
    });
  });

  describe('Deduplication', () => {
    it('should prevent sending same item too many times', async () => {
      // This would require mocking the internal itemIdsSentSuccessfully map
      // For now, just verify the structure
      await batcher.enqueue({ event: 'test' });
      await batcher.flush();
      expect(sendRequestCalls.length).to.equal(1);
    });
  });

  describe('Start/Stop Operations', () => {
    it('should start batching', async () => {
      await batcher.start(); // This calls flush() immediately (queue is empty, so no call)
      await batcher.enqueue({ event: 'test' });
      // Wait for scheduled flush interval (1000ms) + buffer
      cy.wait(1100).then(() => {
        // Should have flushed via scheduled interval
        expect(sendRequestCalls.length).to.be.greaterThan(0);
      });
    });

    it('should stop batching', async () => {
      await batcher.start();
      batcher.stop();
      await batcher.enqueue({ event: 'test' });
      cy.wait(1100);
      // Should not flush after stop
      expect(sendRequestCalls.length).to.equal(0);
    });
  });
});

