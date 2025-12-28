import { RequestQueue, QueueEntry } from './requestQueue.ts';

export interface BatcherConfig {
  batchSize: number;
  batchFlushIntervalMs: number;
  batchRequestTimeoutMs: number;
  batchAutostart: boolean;
}

export interface RequestBatcherOptions {
  storageKey: string;
  libConfig: BatcherConfig;
  sendRequestFunc: (data: any[], options: any) => Promise<any>;
  errorReporter?: (msg: string, err?: any) => void;
  beforeSendHook?: (payload: any) => any;
  queueStorage?: any;
  sharedLockStorage?: Storage;
  usePersistence?: boolean;
  flushOnlyOnInterval?: boolean;
}

const MAX_RETRY_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Manages batching, flushing, and retrying of tracking requests
 */
export class RequestBatcher {
  private queue: RequestQueue;
  private libConfig: BatcherConfig;
  private sendRequest: (data: any[], options: any) => Promise<any>;
  private beforeSendHook?: (payload: any) => any;
  private errorReporter: (msg: string, err?: any) => void;
  private flushOnlyOnInterval: boolean;

  private batchSize: number;
  private flushInterval: number;
  private stopped: boolean;
  private requestInProgress: boolean = false;
  private timeoutID: number | null = null;
  private consecutiveRemovalFailures: number = 0;
  private itemIdsSentSuccessfully: Map<string, number> = new Map();

  constructor(options: RequestBatcherOptions) {
    this.libConfig = options.libConfig;
    this.sendRequest = options.sendRequestFunc;
    this.beforeSendHook = options.beforeSendHook;
    this.errorReporter = options.errorReporter || (() => {});
    this.flushOnlyOnInterval = options.flushOnlyOnInterval || false;

    this.batchSize = this.libConfig.batchSize;
    this.flushInterval = this.libConfig.batchFlushIntervalMs;
    this.stopped = !this.libConfig.batchAutostart;

    this.queue = new RequestQueue(options.storageKey, {
      usePersistence: options.usePersistence,
      queueStorage: options.queueStorage,
      sharedLockStorage: options.sharedLockStorage,
      errorReporter: this.reportError.bind(this)
    });
  }

  async enqueue(item: any): Promise<boolean> {
    return this.queue.enqueue(item, this.flushInterval);
  }

  start(): Promise<void> {
    this.stopped = false;
    this.consecutiveRemovalFailures = 0;
    return this.flush();
  }

  stop(): void {
    this.stopped = true;
    if (this.timeoutID) {
      clearTimeout(this.timeoutID);
      this.timeoutID = null;
    }
  }

  async clear(): Promise<void> {
    return this.queue.clear();
  }

  private scheduleFlush(flushMS: number): void {
    this.flushInterval = flushMS;
    if (!this.stopped) {
      if (this.timeoutID) {
        clearTimeout(this.timeoutID);
      }
      this.timeoutID = window.setTimeout(() => {
        if (!this.stopped) {
          this.flush();
        }
      }, this.flushInterval);
    }
  }

  private resetFlush(): void {
    this.scheduleFlush(this.libConfig.batchFlushIntervalMs);
  }

  private resetBatchSize(): void {
    this.batchSize = this.libConfig.batchSize;
  }

  async flush(options: { unloading?: boolean } = {}): Promise<void> {
    if (this.requestInProgress) {
      return;
    }

    this.requestInProgress = true;
    const timeoutMS = this.libConfig.batchRequestTimeoutMs;
    const startTime = Date.now();
    const currentBatchSize = this.batchSize;

    try {
      const batch = await this.queue.fillBatch(currentBatchSize);
      const attemptSecondaryFlush = batch.length === currentBatchSize;
      const dataForRequest: any[] = [];
      const transformedItems: Map<string, any> = new Map();

      // Process batch items
      for (const item of batch) {
        let payload = item.payload;
        
        if (this.beforeSendHook && !item.orphaned) {
          payload = this.beforeSendHook(payload);
        }

        if (payload) {
          // Deduplication check
          const itemId = item.id;
          const timesSent = this.itemIdsSentSuccessfully.get(itemId) || 0;
          
          if (timesSent > 5) {
            this.reportError('[dupe] item ID sent too many times, not sending', {
              item,
              timesSent
            });
            continue;
          }

          dataForRequest.push(payload);
          transformedItems.set(itemId, payload);
        }
      }

      if (dataForRequest.length === 0) {
        this.requestInProgress = false;
        this.resetFlush();
        return;
      }

      // Send request
      const requestOptions: any = {
        method: 'POST',
        timeout_ms: timeoutMS,
        keepalive: true
      };

      if (options.unloading) {
        // Use sendBeacon for page unload
        requestOptions.transport = 'sendBeacon';
      }

      const response = await this.sendRequest(dataForRequest, requestOptions);
      
      // Handle response
      await this.handleResponse(
        response,
        batch.map(item => item.id),
        attemptSecondaryFlush,
        currentBatchSize,
        startTime,
        timeoutMS,
        options.unloading || false
      );

    } catch (error) {
      this.reportError('Error flushing request queue', error);
      this.requestInProgress = false;
      this.resetFlush();
    }
  }

  private async handleResponse(
    response: any,
    itemIds: string[],
    attemptSecondaryFlush: boolean,
    currentBatchSize: number,
    startTime: number,
    timeoutMS: number,
    unloading: boolean
  ): Promise<void> {
    this.requestInProgress = false;

    try {
      if (unloading) {
        // On unload, just update storage - don't remove items yet
        // They'll be sent on next page load
        this.resetFlush();
        return;
      }

      // Check for timeout
      if (response?.error === 'timeout' && Date.now() - startTime >= timeoutMS) {
        this.reportError('Network timeout; retrying');
        await this.flush();
        return;
      }

      // Check for retryable errors
      if (
        response?.httpStatusCode >= 500 ||
        response?.httpStatusCode === 429 ||
        (response?.httpStatusCode <= 0 && !navigator.onLine) ||
        response?.error === 'timeout'
      ) {
        // Retry with exponential backoff
        let retryMS = this.flushInterval * 2;
        if (response?.retryAfter) {
          retryMS = parseInt(response.retryAfter, 10) * 1000 || retryMS;
        }
        retryMS = Math.min(MAX_RETRY_INTERVAL_MS, retryMS);
        this.reportError(`Error; retry in ${retryMS} ms`);
        this.scheduleFlush(retryMS);
        return;
      }

      // Handle 413 Payload Too Large
      if (response?.httpStatusCode === 413) {
        if (itemIds.length > 1) {
          const halvedBatchSize = Math.max(1, Math.floor(currentBatchSize / 2));
          this.batchSize = Math.min(this.batchSize, halvedBatchSize, itemIds.length - 1);
          this.reportError(`413 response; reducing batch size to ${this.batchSize}`);
          this.resetFlush();
          return;
        } else {
          this.reportError('Single-event request too large; dropping', itemIds);
          this.resetBatchSize();
          await this.removeItemsFromQueue(itemIds);
          this.resetFlush();
          return;
        }
      }

      // Success - remove items from queue
      const succeeded = await this.removeItemsFromQueue(itemIds);
      
      if (succeeded) {
        this.consecutiveRemovalFailures = 0;
        
        // Track sent items for deduplication
        for (const id of itemIds) {
          const current = this.itemIdsSentSuccessfully.get(id) || 0;
          this.itemIdsSentSuccessfully.set(id, current + 1);
        }

        if (this.flushOnlyOnInterval && !attemptSecondaryFlush) {
          this.resetFlush();
        } else {
          // Continue flushing if more items in queue
          await this.flush();
        }
      } else {
        if (++this.consecutiveRemovalFailures > 5) {
          this.reportError('Too many queue failures; disabling batching system.');
          this.stop();
        } else {
          this.resetFlush();
        }
      }
    } catch (error) {
      this.reportError('Error handling API response', error);
      this.resetFlush();
    }
  }

  private async removeItemsFromQueue(itemIds: string[]): Promise<boolean> {
    return this.queue.removeItemsByID(itemIds);
  }

  private reportError(msg: string, err?: any): void {
    if (typeof import.meta.env?.VITE_ENV === 'string' && import.meta.env.VITE_ENV !== 'production') {
      console.error(`[RequestBatcher] ${msg}`, err);
    }
    if (this.errorReporter) {
      try {
        this.errorReporter(msg, err);
      } catch (e) {
        // Ignore reporter errors
      }
    }
  }
}

