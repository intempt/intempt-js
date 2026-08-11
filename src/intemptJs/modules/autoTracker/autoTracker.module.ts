import { HtmlElementDataComponent } from '../../component/HtmlEventData.component.ts';
import { SessionTrackerModule } from './modules/sessionTracker/sessionTracker.module.ts'
import { ProfileTrackerModule } from './modules/profileTracker/profileTracker.module.ts'
import { PageTrackerModule } from './modules/pagesTracker/pagesTracker.module.ts';
import { SessionEventModel } from './models/session.model.ts';
import { debounce, dispatchIntemptEvent } from '../../../shared/shared.utils.ts';
import { PageEventModel } from './models/pageEvent.model.ts';
import { PageEventDataComponent } from '../../component/pageEventData.component.ts';
import { HtmlEventModel } from './models/HtmlEvent.model.ts';
import { HtmlTrackerModule } from './modules/htmlTracker/htmlTracker.module.ts';
import { IntemptConfig } from '../../types/intemptJs.types.ts';
import { ShopifyTrackerModule } from './modules/shopifyTracker/shopifyTracker.module.ts';
import { IntemptEventListenerName, IntemptEventName } from '../../types/constants.types.ts';
import { IntemptPageEventName, ShopifyEvent } from '../../types/autoTracker.types.ts';
import { ProductModel } from '../../models/product.model.ts';
import { RequestBatcher } from '../../../shared/queue/requestBatcher.ts';
import { PersistentStore } from '../../../shared/storage/persistentStore.ts';
import { EnvConfig } from '../../../shared/envConfig.ts';
import { loadDoNotTrack, persistDoNotTrack } from '../../../shared/consentState.ts';


import { createLogger } from '../../../shared/logger/logger.ts';
import { MetricsSnapshot } from '../../../shared/logger/metrics.ts';

const log = createLogger('AutoTracker');

export class AutoTrackerModule {
  private readonly _config:IntemptConfig;
  private readonly _profileTrackerModule = new ProfileTrackerModule();
  private readonly _sessionTrackerModule = new SessionTrackerModule();
  private readonly _pagesTrackerModule = new PageTrackerModule();
  private readonly _htmlTrackerModule = new HtmlTrackerModule();
  private readonly _shopifyTrackerModule: ShopifyTrackerModule | undefined ;

  private _doNotTrack: boolean = loadDoNotTrack();

  private readonly _api: string;

  private readonly _eventPool: any[] = [];
  private _requestBatcher: RequestBatcher | null = null;
  private _batcherInitialized: boolean = false;

  constructor(intemptConfig: IntemptConfig, api: string) {

    this._config = { ...intemptConfig };
    this._api = api;

    this._shopifyTrackerModule = intemptConfig.shopify
      ? new ShopifyTrackerModule()
      : undefined;

    // Initialize batcher
    this._initializeBatcher();

    this._eventPoolHandler();

    this._trackSession();

    this._trackPage();

    try {
      this._pagesTrackerModule.start();
    } catch (e) {
      log.error('page tracker failed to start', e);
    }

    this._trackShopify();

    this._trackHtml();
  }

  refresh(){
    this._profileTrackerModule.refresh();
    this._sessionTrackerModule.refresh();
    this._pagesTrackerModule.refresh();
  }

  init() {
    this._pagesTrackerModule.init();
    this._htmlTrackerModule.init();
  }

  get doNotTrack(){
    return this._doNotTrack;
  }

  set doNotTrack(value: boolean){
    this._doNotTrack = value
    persistDoNotTrack(value)
  }

  isUserOptIn(): boolean{
    return !this._doNotTrack
  }

  getSessionId() {
    const browserSessionId = this._sessionTrackerModule.getId();
    const localSessionId = this._sessionTrackerModule.getLocalId();

    return !!browserSessionId
      ? browserSessionId
      : localSessionId;
  }

  getProfileId() {
    return this._profileTrackerModule.getId();
  }

  getPageId(){
    return this._pagesTrackerModule.getId();
  }

  /**
   * Delivery-pipeline metrics, or `null` when the batcher never initialised.
   * Surfaced on the public API as `intempt.getDiagnostics()`.
   */
  getDiagnostics(): MetricsSnapshot | null {
    return this._requestBatcher ? this._requestBatcher.getMetrics() : null;
  }

  private _initializeBatcher(): void {
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
        window.addEventListener('beforeunload', () => {
          if (this._requestBatcher) {
            this._requestBatcher.flush({ unloading: true });
          }
        });

        window.addEventListener('pagehide', (ev: PageTransitionEvent) => {
          if (ev.persisted && this._requestBatcher) {
            this._requestBatcher.flush({ unloading: true });
          }
        });

        window.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden' && this._requestBatcher) {
            this._requestBatcher.flush({ unloading: true });
          }
        });
      }

    } catch (error) {
      log.error('failed to initialize batcher, falling back to simple queue', error);
      this._batcherInitialized = false;
    }
  }

  private async _sendBatchRequest(data: any[], options: any): Promise<any> {
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
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return { error: 'timeout', httpStatusCode: 0 };
      }
      return {
        error: error.message || 'network error',
        httpStatusCode: 0
      };
    }
  }

  private handleShopifyEvent(eventName: IntemptPageEventName) {
    if(eventName === IntemptEventName.PAGE_LEAVE) return;
    this._shopifyTrackerModule?.track()
  }

  private _trackShopify(){
    if(!this._shopifyTrackerModule) return;

    document.addEventListener(IntemptEventListenerName.SHOPIFY, (event) => {
      if (!this.isUserOptIn()) return;
      const { detail } = event as ShopifyEvent;
      const { eventName, product } = detail;

      const profileId = this.getProfileId();
      const sessionId = this.getSessionId();
      const pageId = this.getPageId();

      if(!profileId || !sessionId || !pageId) return;

      const eventData = new ProductModel({
        eventTitle: eventName,
        products: [product],
        profileId,
        sessionId,
        pageId,
      })

      dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: eventData});
    })
  }

  private _trackHtml(){
    document.addEventListener(IntemptEventListenerName.HTML, (event) => {
      if (!this.isUserOptIn()) return;

      const { detail } = event as CustomEvent;
      const { eventName, domEventName, target } = detail;

      const profileId = this.getProfileId();
      const sessionId = this.getSessionId();
      const pageId = this.getPageId();

      if(!profileId || !sessionId || !pageId) return;

      const eventData = new HtmlEventModel({
        name: eventName,
        sessionId: this.getSessionId(),
        profileId: this.getProfileId(),
        pageId: this._getPageId(),
        data: new HtmlElementDataComponent(target, domEventName)
      })


      dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: eventData});
    })
  }

  private _trackPage(){
    document.addEventListener(IntemptEventListenerName.PAGE, (event) => {
      if (!this.isUserOptIn()) return;
      const { detail } = event as CustomEvent;
      const { eventName, fullUrl, title, windowWidth, pageId, duration, previousPage } = detail;

      this.handleShopifyEvent(eventName);

      const eventData = new PageEventDataComponent({
        duration,
        title,
        fullUrl,
        windowWidth,
        previousPage
      });

      const profileId = this.getProfileId();
      const sessionId = this.getSessionId();


      if(!profileId || !sessionId || !pageId) return;

      const pageEvent = new PageEventModel({
        name: eventName,
        sessionId,
        profileId,
        pageId,
        data: eventData
      })


      dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: pageEvent});
    })
  }

  private _trackSession(){
    document.addEventListener(IntemptEventListenerName.SESSION, async (event) => {
      if (!this.isUserOptIn()) return;
      const { detail } = event as CustomEvent;
      const { eventName, userAttributes, eventAttributes } = detail;

      const sessionId = this.getSessionId();
      const profileId = this.getProfileId();

      if(!profileId || !sessionId) return;

      const sessionEvent = new SessionEventModel({
        name: eventName,
        sessionId,
        profileId,
        data: eventAttributes,
        userAttributes
      })

      dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: sessionEvent});
    })
  }

  private _eventPoolHandler() {
    document.addEventListener(IntemptEventListenerName.EVENT, (customDomEvent) => {
      if (!this.isUserOptIn()) return;
      const { detail } = customDomEvent as CustomEvent;
      const { event  } = detail;
      const { type   } = event;



      switch (type) {
        case 'consent':
          return this._sendConsentTrackEventData(event);
         default:
           this._onTrackData(event);
           break;
      }
    });
  }

  private _onTrackData(data:any){
    // Use batcher if available, otherwise fallback to old method
    if (this._batcherInitialized && this._requestBatcher) {
      const name = data.name.toLowerCase();
      
      // For "Leave Page" events, flush immediately
      if (name === 'leave page') {
        this._requestBatcher.enqueue(data).then(() => {
          this._requestBatcher?.flush({ unloading: true });
        });
      } else {
        // Enqueue normally - batcher will handle batching
        this._requestBatcher.enqueue(data);
      }
    } else {
      // Fallback to old debounced method
      this._onTrackDataLegacy(data);
    }
  }

  private _onTrackDataLegacy(data:any){
    // Keep existing implementation as fallback
    let debouncedSendEvents:ReturnType<typeof debounce>;
    const name = data.name.toLowerCase();
     this._eventPool.push(data);

    if(name.toLowerCase() === 'leave page'){
      debouncedSendEvents = debounce(() => this._sendTrackEventData(), 0);
    }
    else{
      debouncedSendEvents = debounce(() => this._sendTrackEventData(), 1000);
    }

    return debouncedSendEvents();
  }

  private async _sendConsentTrackEventData(data:any) {
    const {organization, sourceId, project, writeKey} = this._config;

    const url = `${this._api}/${organization}/projects/${project}/consents/data`;

    const [ username, password ] = writeKey.split('.');

    const encodedCredentials = btoa(`${username}:${password}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${encodedCredentials}`,
        },
        body: JSON.stringify({ ...data }),
        keepalive: true
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
    } catch (error) {
      log.error('error sending track event data', error);

    }

  }

  private async _sendTrackEventData() {
    if(this._eventPool.length === 0) return;
    /**
     * Make deep copy of the eventPool
     * */
    const data = JSON.parse(JSON.stringify(this._eventPool));

    this._clearEventPool();

    const {organization, sourceId, project, writeKey} = this._config;

    const url = `${this._api}/${organization}/projects/${project}/sources/${sourceId}/track`;

    const [ username, password ] = writeKey.split('.');

    const encodedCredentials = btoa(`${username}:${password}`);


    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${encodedCredentials}`,
        },
        body: JSON.stringify({ track: data }),
        keepalive: true
      });

      if (!response.ok) {
         throw new Error(`HTTP error! Status: ${response.status}`);
      }

    } catch (error) {
      log.error('_sendTrackEventData failed', error);

    }

  }

  private _getPageId() {
    return this._pagesTrackerModule.getId();
  }

  private _clearEventPool() {
    this._eventPool.length = 0;
  }
}

