import { QueueStorage } from '../storage/queueStorage.ts';
import { SharedLock } from '../storage/sharedLock.ts';

export interface QueueEntry {
  id: string;
  flushAfter: number; // Timestamp when item can be considered orphaned
  payload: any;
  orphaned?: boolean;
}

export interface RequestQueueOptions {
  usePersistence?: boolean;
  queueStorage?: QueueStorage;
  sharedLockStorage?: Storage;
  sharedLockTimeoutMS?: number;
  enqueueThrottleMs?: number;
  errorReporter?: (msg: string, err?: any) => void;
  pid?: string;
}

/**
 * Persistent queue for tracking events
 * Survives page reloads and handles multi-tab scenarios
 */
export class RequestQueue {
  private storageKey: string;
  private usePersistence: boolean;
  private queueStorage: QueueStorage;
  private lock: SharedLock | null = null;
  private memQueue: QueueEntry[] = [];
  private initialized: boolean = false;
  private reportError: (msg: string, err?: any) => void;

  constructor(storageKey: string, options: RequestQueueOptions = {}) {
    this.storageKey = storageKey;
    this.usePersistence = options.usePersistence !== false;
    this.queueStorage = options.queueStorage || new QueueStorage(options.sharedLockStorage);
    this.reportError = options.errorReporter || (() => {});

    if (this.usePersistence) {
      this.lock = new SharedLock(storageKey, {
        storage: options.sharedLockStorage || window.localStorage,
        timeoutMS: options.sharedLockTimeoutMS || 5000,
        pid: options.pid
      });
    }
  }

  async ensureInit(): Promise<void> {
    if (this.initialized || !this.usePersistence) return;

    try {
      await this.queueStorage.init();
      this.initialized = true;
    } catch (error) {
      this.reportError('Error initializing queue persistence. Disabling persistence', error);
      this.initialized = true;
      this.usePersistence = false;
    }
  }

  async enqueue(item: any, flushInterval: number): Promise<boolean> {
    const queueEntry: QueueEntry = {
      id: this.generateId(),
      flushAfter: Date.now() + flushInterval * 2,
      payload: item
    };

    if (!this.usePersistence) {
      this.memQueue.push(queueEntry);
      return true;
    }

    return this.enqueuePersisted(queueEntry);
  }

  private async enqueuePersisted(entry: QueueEntry): Promise<boolean> {
    if (!this.lock) {
      this.memQueue.push(entry);
      return true;
    }

    try {
      return await this.lock.withLock(async () => {
        await this.ensureInit();
        const storedQueue = await this.readFromStorage();
        const updatedQueue = [...storedQueue, entry];
        await this.queueStorage.setItem(this.storageKey, updatedQueue);
        this.memQueue.push(entry);
        return true;
      });
    } catch (error) {
      this.reportError('Error enqueueing item', error);
      // Fallback to memory queue
      this.memQueue.push(entry);
      return false;
    }
  }

  async fillBatch(batchSize: number): Promise<QueueEntry[]> {
    // If memQueue is empty and persistence is enabled, initialize from storage
    if (this.memQueue.length === 0 && this.usePersistence) {
      await this.ensureInit();
      const storedQueue = await this.readFromStorage();
      const now = Date.now();
      // Load all items from storage into memQueue, marking orphaned ones
      this.memQueue = storedQueue.map(item => {
        if (now > item.flushAfter) {
          return { ...item, orphaned: true };
        }
        return item;
      });
    }

    let batch = this.memQueue.slice(0, batchSize);

    // If we need more items and persistence is enabled, check for orphaned items
    if (this.usePersistence && batch.length < batchSize) {
      await this.ensureInit();
      const storedQueue = await this.readFromStorage();
      const now = Date.now();
      const idsInBatch = new Set(batch.map(item => item.id));

      for (const item of storedQueue) {
        if (batch.length >= batchSize) break;
        if (now > item.flushAfter && !idsInBatch.has(item.id)) {
          item.orphaned = true;
          batch.push(item);
          idsInBatch.add(item.id);
        }
      }
    }

    return batch;
  }

  async removeItemsByID(ids: string[]): Promise<boolean> {
    const idSet = new Set(ids);
    
    // Remove from memory queue
    this.memQueue = this.memQueue.filter(item => !idSet.has(item.id));

    if (!this.usePersistence) {
      return true;
    }

    if (!this.lock) {
      return true;
    }

    try {
      return await this.lock.withLock(async () => {
        await this.ensureInit();
        const storedQueue = await this.readFromStorage();
        const filteredQueue = storedQueue.filter(item => !idSet.has(item.id));
        await this.queueStorage.setItem(this.storageKey, filteredQueue);
        
        // Verify removal
        const verify = await this.readFromStorage();
        for (const item of verify) {
          if (idSet.has(item.id)) {
            throw new Error('Item not removed from storage');
          }
        }
        return true;
      });
    } catch (error) {
      this.reportError('Error removing items', error);
      return false;
    }
  }

  async clear(): Promise<void> {
    this.memQueue = [];
    if (this.usePersistence) {
      await this.ensureInit();
      await this.queueStorage.removeItem(this.storageKey);
    }
  }

  private async readFromStorage(): Promise<QueueEntry[]> {
    await this.ensureInit();
    try {
      const stored = await this.queueStorage.getItem(this.storageKey);
      return Array.isArray(stored) ? stored : [];
    } catch (error) {
      this.reportError('Error reading from storage', error);
      return [];
    }
  }

  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

