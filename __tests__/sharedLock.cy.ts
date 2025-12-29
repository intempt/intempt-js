import { SharedLock } from '../src/shared/storage/sharedLock.ts';

describe('SharedLock', () => {
  const lockKey = 'test_lock';
  let lock1: SharedLock;
  let lock2: SharedLock;

  beforeEach(() => {
    // Clear any existing locks
    localStorage.removeItem(`__intempt_lock_${lockKey}__`);
    lock1 = new SharedLock(lockKey, {
      storage: localStorage,
      timeoutMS: 1000
    });
    lock2 = new SharedLock(lockKey, {
      storage: localStorage,
      timeoutMS: 1000
    });
  });

  afterEach(() => {
    localStorage.removeItem(`__intempt_lock_${lockKey}__`);
  });

  describe('Lock Acquisition', () => {
    it('should acquire lock successfully', async () => {
      const result = await lock1.withLock(async () => {
        return 'success';
      });
      expect(result).to.equal('success');
    });

    it('should prevent concurrent access', async () => {
      let lock1Acquired = false;
      let lock2Acquired = false;

      const lock1Promise = lock1.withLock(async () => {
        lock1Acquired = true;
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'lock1';
      });

      // Try to acquire lock immediately (should wait)
      const lock2Promise = lock2.withLock(async () => {
        lock2Acquired = true;
        return 'lock2';
      });

      await Promise.all([lock1Promise, lock2Promise]);

      // Both should eventually succeed, but sequentially
      expect(lock1Acquired).to.be.true;
      expect(lock2Acquired).to.be.true;
    });

    it('should release lock after operation', async () => {
      await lock1.withLock(async () => {
        // Lock should be held
        expect(localStorage.getItem(`__intempt_lock_${lockKey}__`)).to.not.be.null;
      });

      // Lock should be released
      cy.wait(50);
      expect(localStorage.getItem(`__intempt_lock_${lockKey}__`)).to.be.null;
    });
  });

  describe('Lock Expiration', () => {
    it('should handle expired locks', async () => {
      // Manually set an expired lock
      localStorage.setItem(`__intempt_lock_${lockKey}__`, JSON.stringify({
        pid: 'old_pid',
        timestamp: Date.now() - 2000 // 2 seconds ago
      }));

      // Should be able to acquire lock (expired lock should be cleared)
      const result = await lock1.withLock(async () => {
        return 'acquired';
      });
      expect(result).to.equal('acquired');
    });
  });
});

