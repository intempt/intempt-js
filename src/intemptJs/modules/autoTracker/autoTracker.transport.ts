import { RequestBatcher } from '../../../shared/queue/requestBatcher.ts';
import { PersistentStore } from '../../../shared/storage/persistentStore.ts';
import { IntemptConfig } from '../../types/intemptJs.types.ts';
import { createLogger } from '../../../shared/logger/logger.ts';
import { MetricsSnapshot } from '../../../shared/logger/metrics.ts';

const log = createLogger('AutoTracker');

/** What `RequestBatcher.sendRequestFunc` is called with. */
export type BatchSendOptions = {
  unloading?: boolean;
  keepalive?: boolean;
  timeout_ms?: number;
};

export type BatchSendResult = {
  httpStatusCode: number;
  ok?: boolean;
  retryAfter?: string;
  error?: string;
};

/**
 * Owns the delivery pipeline for `AutoTrackerModule`: the batcher, its
 * persistent queue, the unload-flush wiring, and the actual `fetch` call to
 * the `/track` endpoint.
 *
 * Extracted out of `autoTracker.module.ts` (§ D-2 fix / transport split) so
 * the planned `fetch(keepalive)` → XHR fallback chain has a single, narrow
 * home that touches only config and the queue — not consent, not the DOM
 * event wiring. Pure move: behaviour is unchanged from the inline version.
 */
export class AutoTrackerTransport {
  private readonly _config: IntemptConfig;
  private readonly _api: string;

  private _requestBatcher: RequestBatcher | null = null;
  private _batcherInitialized: boolean = false;

  private readonly _onBeforeUnload = (): void => {
    if (this._requestBatcher) {
      this._requestBatcher.flush({ unloading: true });
    }
  };

  private readonly _onPageHide = (ev: PageTransitionEvent): void => {
    if (ev.persisted && this._requestBatcher) {
      this._requestBatcher.flush({ unloading: true });
    }
  };

  private readonly _onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden' && this._requestBatcher) {
      this._requestBatcher.flush({ unloading: true });
    }
  };

  constructor(config: IntemptConfig, api: string) {
    this._config = config;
    this._api = api;
  }

  get initialized(): boolean {
    return this._batcherInitialized;
  }

  get batcher(): RequestBatcher | null {
    return this._requestBatcher;
  }

  /** Delivery-pipeline metrics, or `null` when the batcher never initialised. */
  getDiagnostics(): MetricsSnapshot | null {
    return this._requestBatcher ? this._requestBatcher.getMetrics() : null;
  }

  initialize(): void {
    try {
      const storageKey = `__intempt_queue_${this._config.sourceId}__`;

      this._requestBatcher = new RequestBatcher({
        storageKey,
        libConfig: {
          batchSize: 50,
          batchFlushIntervalMs: 5000,
          batchRequestTimeoutMs: 90000,
          batchAutostart: true
        },
        sendRequestFunc: this._sendBatchRequest.bind(this),
        // No errorReporter here on purpose: RequestBatcher.reportError now
        // writes every one of these through the structured logger under its own
        // `[RequestBatcher]` scope, so wiring a second callback that only did
        // `console.error` would print each failure twice. The hook itself
        // remains available for callers that want a *programmatic* consumer.
        usePersistence: true,
        // IndexedDB tier with a localStorage fallback. localStorage is
        // synchronous, so every queue write blocked the host page's main
        // thread, and it caps at ~5 MB shared with that page — a cap we cannot
        // detect until a write throws. PersistentStore keeps the same interface,
        // so the queue is unaware of which tier it is on.
        queueStorage: new PersistentStore({
          dbName: `intempt_${this._config.sourceId}`,
          // PersistentStore has no logger of its own, so this is where its
          // storage-tier failures (quota, blocked IndexedDB) become visible.
          errorReporter: (msg, err) => log.error(msg, err),
        })
      });

      // Start the batcher
      this._requestBatcher.start();
      this._batcherInitialized = true;

      // Handle page unload
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', this._onBeforeUnload);
        window.addEventListener('pagehide', this._onPageHide);
        window.addEventListener('visibilitychange', this._onVisibilityChange);
      }

    } catch (error) {
      log.error('failed to initialize batcher, falling back to simple queue', error);
      this._batcherInitialized = false;
    }
  }

  /**
   * Unsubscribes every listener this transport attached and stops the
   * batcher. Idempotent — safe to call more than once, and safe to call on a
   * transport that never successfully initialised.
   */
  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this._onBeforeUnload);
      window.removeEventListener('pagehide', this._onPageHide);
      window.removeEventListener('visibilitychange', this._onVisibilityChange);
    }

    if (this._requestBatcher) {
      this._requestBatcher.stop();
    }

    this._batcherInitialized = false;
  }

  private async _sendBatchRequest(data: unknown[], options: BatchSendOptions): Promise<BatchSendResult> {
    const {organization, sourceId, project, writeKey} = this._config;
    const url = `${this._api}/${organization}/projects/${project}/sources/${sourceId}/track`;
    const [username, password] = writeKey.split('.');
    const encodedCredentials = btoa(`${username}:${password}`);

    // Use fetch with keepalive for all requests (including page unload)
    // This ensures Authorization header is included and requests are reliable during unload
    try {
      const controller = new AbortController();
      // For unload scenarios, use shorter timeout to avoid blocking navigation
      const timeout = options.unloading ? 5000 : (options.timeout_ms || 90000);
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${encodedCredentials}`,
        },
        body: JSON.stringify({ track: data }),
        keepalive: options.keepalive !== false,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      return {
        httpStatusCode: response.status,
        ok: response.ok,
        retryAfter: response.headers.get('Retry-After') || undefined
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return { error: 'timeout', httpStatusCode: 0 };
      }
      return {
        error: error instanceof Error ? error.message : 'network error',
        httpStatusCode: 0
      };
    }
  }
}
