import { RequestBatcher } from '../../../shared/queue/requestBatcher.ts';
import { PersistentStore } from '../../../shared/storage/persistentStore.ts';
import { IntemptConfig } from '../../types/intemptJs.types.ts';
import { createLogger } from '../../../shared/logger/logger.ts';
import { MetricsSnapshot } from '../../../shared/logger/metrics.ts';
import { buildTrackUrl } from './autoTracker.url.ts';

const log = createLogger('AutoTracker');

/**
 * The keepalive budget: browsers reject a keepalive request whose body would
 * take the page's in-flight keepalive bodies over 64 KiB.
 */
const KEEPALIVE_BUDGET_BYTES = 64 * 1024;

function utf8Length(text: string): number {
  return typeof TextEncoder === 'function'
    ? new TextEncoder().encode(text).length
    : text.length * 3; // Worst case, so the budget is never overrun.
}

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

  /**
   * Set by `pagehide`; cleared when the page is live again (`pageshow`, or
   * `visibilitychange: visible` after a frozen page resumes or a navigation is
   * called off). After a pagehide the page is either gone or in the bfcache,
   * so the `visibilitychange: hidden` (and any repeat pagehide/beforeunload)
   * that follows in the same navigation is the same unload and is skipped
   * instead of starting another unload flush.
   *
   * `beforeunload` followed by `pagehide` is not skipped: something may have
   * been queued in between, and that second flush sends only what is not
   * already on the wire (the batcher skips in-flight items), so it costs no
   * duplicate.
   */
  private _pageHidden: boolean = false;

  /**
   * Bytes of keepalive request bodies this transport has in flight. Browsers
   * cap the keepalive bodies a page may have in flight at 64 KiB and reject a
   * request that would go over, so a send is checked against the budget up
   * front instead of finding out from a rejection.
   */
  private _keepaliveBytesInFlight: number = 0;

  /**
   * `terminal`: the page is going away (beforeunload, a pagehide that is not
   * a bfcache entry), so the batcher bypasses its breaker for this send.
   */
  private _flushForUnload(terminal: boolean): void {
    if (!this._requestBatcher || this._pageHidden) return;
    // flushUnload never rejects; `void` documents that nothing waits for it.
    void this._requestBatcher.flush({ unloading: true, terminal });
  }

  private _pageLiveAgain(): void {
    this._pageHidden = false;
    this._requestBatcher?.pageResumed();
  }

  /** See `setUnloadHook`. */
  private _unloadHook: (() => void) | null = null;

  /**
   * Registers what has to be queued before an unload is flushed: the page
   * tracker's Leave Page. It runs first in this transport's own
   * `beforeunload`/`pagehide` handler, so the Leave Page exists before the
   * unload flush and goes out in its first request, whichever of the two
   * modules registered its window listener first (INT-5942). With the
   * transport's listener first, the flush used to send everything else and
   * the Leave Page followed in a later request, the one most likely to be
   * over the keepalive budget.
   */
  setUnloadHook(hook: (() => void) | null): void {
    this._unloadHook = hook;
  }

  /**
   * One unload: the batcher learns whether the page is going away before the
   * hook queues anything, so the Leave Page is sent as part of the same
   * unload (and bypasses the breaker on a terminal one), then everything else
   * not yet on the wire is flushed.
   */
  private _onUnload(terminal: boolean): void {
    if (terminal && !this._pageHidden) this._requestBatcher?.pageGoingAway();
    try {
      this._unloadHook?.();
    } catch (error) {
      log.error('unload hook failed', error);
    }
    this._flushForUnload(terminal);
  }

  private readonly _onBeforeUnload = (): void => {
    this._onUnload(true);
  };

  // Every pagehide, not only a bfcache one (INT-5942): mobile browsers skip
  // `beforeunload` for most unloads, and pagehide is the one event every unload
  // fires. The unload flush hands its request over synchronously, inside this
  // handler.
  private readonly _onPageHide = (ev?: PageTransitionEvent): void => {
    this._onUnload(!ev?.persisted);
    this._pageHidden = true;
  };

  private readonly _onPageShow = (): void => {
    this._pageLiveAgain();
  };

  private readonly _onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      // A hidden tab is still a live page: not terminal.
      this._flushForUnload(false);
    } else if (document.visibilityState === 'visible') {
      this._pageLiveAgain();
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
          batchAutostart: true,
        },
        sendRequestFunc: this._sendBatchRequest.bind(this),
        onDeliveryFailure: this._config.onDeliveryFailure,
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
        }),
      });

      // Start the batcher
      this._requestBatcher.start();
      this._batcherInitialized = true;

      // Handle page unload
      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', this._onBeforeUnload);
        window.addEventListener('pagehide', this._onPageHide);
        window.addEventListener('pageshow', this._onPageShow);
        window.addEventListener('visibilitychange', this._onVisibilityChange);
      }
    } catch (error) {
      log.error(
        'failed to initialize batcher, falling back to simple queue',
        error,
      );
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
      window.removeEventListener('pageshow', this._onPageShow);
      window.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    this._unloadHook = null;

    if (this._requestBatcher) {
      this._requestBatcher.stop();
    }

    this._batcherInitialized = false;
  }

  private async _sendBatchRequest(
    data: unknown[],
    options: BatchSendOptions,
  ): Promise<BatchSendResult> {
    const { writeKey } = this._config;
    const url = buildTrackUrl(this._api, this._config);
    const [username, password] = writeKey.split('.');
    const encodedCredentials = btoa(`${username}:${password}`);
    const authHeader = `Basic ${encodedCredentials}`;
    const body = JSON.stringify({ track: data });
    // For unload scenarios, use shorter timeout to avoid blocking navigation
    const timeout = options.unloading ? 5000 : options.timeout_ms || 90000;

    // Primary leg: fetch with keepalive. This ensures the Authorization header
    // is included and requests are reliable during unload.
    if (typeof fetch === 'function') {
      // Over the keepalive budget, the browser would reject the request
      // outright; send it without keepalive instead. That still completes on
      // a live page (hidden tab, SPA Leave Page). The batcher sends the newest
      // batch first on unload, so the Leave Page gets the budget.
      const bytes = utf8Length(body);
      const keepalive =
        options.keepalive !== false &&
        this._keepaliveBytesInFlight + bytes <= KEEPALIVE_BUDGET_BYTES;
      if (keepalive) this._keepaliveBytesInFlight += bytes;
      let fetchResult: BatchSendResult | null;
      try {
        fetchResult = await this._sendViaFetch(
          url,
          authHeader,
          body,
          { ...options, keepalive },
          timeout,
        );
      } finally {
        if (keepalive) this._keepaliveBytesInFlight -= bytes;
      }
      if (fetchResult) {
        return fetchResult;
      }
      // fetchResult === null means the transport itself did not deliver
      // (fetch threw, or was aborted with nothing received) — fall through to
      // the XHR leg below. An actual HTTP response, of any status, returns
      // above and never reaches here. On an unload send it only means fetch
      // threw synchronously, i.e. no request was started.
    }

    // Fallback leg: XHR. Only reached when fetch is unavailable or the
    // transport failed to deliver at all — never for a real HTTP response,
    // so a 400/413 the server already rejected is not resent down this path.
    return this._sendViaXHR(url, authHeader, body, timeout);
  }

  /**
   * Returns the `BatchSendResult` for a delivered HTTP response (any status),
   * or `null` when the transport itself failed to deliver — `fetch` throwing,
   * or the request being aborted with no response received — signalling that
   * the XHR fallback should be tried next.
   */
  private async _sendViaFetch(
    url: string,
    authHeader: string,
    body: string,
    options: BatchSendOptions,
    timeout: number,
  ): Promise<BatchSendResult | null> {
    const controller = new AbortController();
    // Whether the request can have left the page yet. A rejection that comes
    // before the next task (the keepalive quota check, a bad header) was
    // decided synchronously inside fetch, before anything was dispatched; a
    // network error or an abort arrives later, from the network.
    let dispatched = false;
    const dispatchTimer = setTimeout(() => (dispatched = true), 0);
    let pending: Promise<Response>;
    try {
      pending = fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body,
        keepalive: options.keepalive !== false,
        signal: controller.signal,
      });
    } catch {
      clearTimeout(dispatchTimer);
      // Thrown before any request was started: the XHR leg is safe to try.
      return null;
    }

    // Armed before the await and cleared however it ends, so a rejected
    // request does not leave a 90 s timer behind.
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeout);
    try {
      const response = await pending;
      return {
        httpStatusCode: response.status,
        ok: response.ok,
        retryAfter: response.headers.get('Retry-After') || undefined,
      };
    } catch (error) {
      // Transport-layer failure only (network error, CORS failure, abort) —
      // no HTTP response exists to report.
      //
      // An unload send does not fall back to XHR here: its keepalive request
      // was started and may well have reached ingest (an abort on the 5 s
      // unload timeout says nothing about the server), and a second,
      // non-keepalive request with the same payload would deliver it twice.
      // Unload sends also run on live pages now (hidden tab, SPA Leave Page),
      // where that XHR would complete. The failure goes back to the batcher,
      // which keeps the items queued for the next flush.
      // Our own timer aborted a request that had left the page: the server may
      // have it, so it is not resent over XHR either (INT-7436, §S1.4).
      if (dispatched && timedOut) {
        return { error: 'timeout', httpStatusCode: 0 };
      }
      if (options.unloading && dispatched) {
        return {
          error:
            (error as { name?: unknown } | null)?.name === 'AbortError'
              ? 'timeout'
              : 'network error',
          httpStatusCode: 0,
        };
      }
      // Regular send, or rejected before dispatch: signal the fallback to
      // try XHR.
      return null;
    } finally {
      clearTimeout(timeoutId);
      clearTimeout(dispatchTimer);
    }
  }

  /** XHR fallback leg, tried only after `fetch` fails to deliver a response. */
  private _sendViaXHR(
    url: string,
    authHeader: string,
    body: string,
    timeout: number,
  ): Promise<BatchSendResult> {
    return new Promise((resolve) => {
      let xhr: XMLHttpRequest;
      try {
        xhr = new XMLHttpRequest();
      } catch (error) {
        resolve({
          error: error instanceof Error ? error.message : 'xhr unavailable',
          httpStatusCode: 0,
        });
        return;
      }

      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', authHeader);
      xhr.timeout = timeout;

      xhr.onload = (): void => {
        resolve({
          httpStatusCode: xhr.status,
          ok: xhr.status >= 200 && xhr.status < 300,
          retryAfter: xhr.getResponseHeader('Retry-After') || undefined,
        });
      };

      xhr.onerror = (): void => {
        resolve({ error: 'network error', httpStatusCode: 0 });
      };

      xhr.ontimeout = (): void => {
        resolve({ error: 'timeout', httpStatusCode: 0 });
      };

      try {
        xhr.send(body);
      } catch (error) {
        resolve({
          error: error instanceof Error ? error.message : 'network error',
          httpStatusCode: 0,
        });
      }
    });
  }
}
