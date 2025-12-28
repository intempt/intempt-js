/**
 * Wrapper for localStorage-based queue storage
 * Handles initialization and error recovery
 */
export class QueueStorage {
  private storage: Storage;
  private initialized: boolean = false;

  constructor(storage: Storage = window.localStorage) {
    this.storage = storage;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    // Test write/read to ensure localStorage works
    try {
      const testKey = '__intempt_test__';
      this.storage.setItem(testKey, 'test');
      this.storage.removeItem(testKey);
      this.initialized = true;
    } catch (error) {
      throw new Error('localStorage not available');
    }
  }

  async getItem(key: string): Promise<any> {
    await this.init();
    try {
      const item = this.storage.getItem(key);
      return item ? JSON.parse(item) : null;
    } catch (error) {
      return null;
    }
  }

  async setItem(key: string, value: any): Promise<void> {
    await this.init();
    try {
      this.storage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Handle quota exceeded
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    await this.init();
    this.storage.removeItem(key);
  }
}

