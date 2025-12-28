/**
 * Async mutex for multi-tab/window coordination
 * Prevents race conditions when multiple tabs access localStorage
 */
export class SharedLock {
  private lockKey: string;
  private storage: Storage;
  private timeoutMS: number;
  private pid: string;

  constructor(lockKey: string, options: {
    storage: Storage;
    timeoutMS: number;
    pid?: string;
  }) {
    this.lockKey = `__intempt_lock_${lockKey}__`;
    this.storage = options.storage;
    this.timeoutMS = options.timeoutMS || 5000;
    this.pid = options.pid || this.generatePid();
  }

  private generatePid(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockAcquired = await this.acquireLock();
    if (!lockAcquired) {
      throw new Error('Failed to acquire lock');
    }

    try {
      return await fn();
    } finally {
      this.releaseLock();
    }
  }

  private async acquireLock(): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < this.timeoutMS) {
      try {
        const existingLock = this.storage.getItem(this.lockKey);
        if (!existingLock) {
          this.storage.setItem(this.lockKey, JSON.stringify({
            pid: this.pid,
            timestamp: Date.now()
          }));
          // Verify we got the lock
          const verify = this.storage.getItem(this.lockKey);
          if (verify && JSON.parse(verify).pid === this.pid) {
            return true;
          }
        } else {
          const lock = JSON.parse(existingLock);
          // Check if lock expired (older than timeout)
          if (Date.now() - lock.timestamp > this.timeoutMS) {
            this.storage.removeItem(this.lockKey);
            continue;
          }
        }
        await this.delay(50); // Wait before retry
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  private releaseLock(): void {
    try {
      const lock = this.storage.getItem(this.lockKey);
      if (lock) {
        const lockData = JSON.parse(lock);
        if (lockData.pid === this.pid) {
          this.storage.removeItem(this.lockKey);
        }
      }
    } catch (error) {
      // Ignore errors on release
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

