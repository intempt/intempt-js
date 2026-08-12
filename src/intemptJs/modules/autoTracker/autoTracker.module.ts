import { HtmlElementDataComponent } from '../../component/HtmlEventData.component.ts';
import { SessionTrackerModule } from './modules/sessionTracker/sessionTracker.module.ts';
import { ProfileTrackerModule } from './modules/profileTracker/profileTracker.module.ts';
import { PageTrackerModule } from './modules/pagesTracker/pagesTracker.module.ts';
import { SessionEventModel } from './models/session.model.ts';
import { dispatchIntemptEvent } from '../../../shared/shared.utils.ts';
import { PageEventModel } from './models/pageEvent.model.ts';
import { PageEventDataComponent } from '../../component/pageEventData.component.ts';
import { HtmlEventModel } from './models/HtmlEvent.model.ts';
import { HtmlTrackerModule } from './modules/htmlTracker/htmlTracker.module.ts';
import { IntemptConfig } from '../../types/intemptJs.types.ts';
import { ShopifyTrackerModule } from './modules/shopifyTracker/shopifyTracker.module.ts';
import {
  IntemptEventListenerName,
  IntemptEventName,
} from '../../types/constants.types.ts';
import {
  IntemptPageEventName,
  ShopifyEvent,
} from '../../types/autoTracker.types.ts';
import { ProductModel } from '../../models/product.model.ts';
import { AutoTrackerTransport } from './autoTracker.transport.ts';
import { AutoTrackerConsent } from './autoTracker.consent.ts';
import { AutoTrackerEventPool } from './autoTracker.eventPool.ts';
import {
  createPiiScrubber,
  PiiScrubber,
} from '../../../shared/privacy/piiScrubber.ts';

import { createLogger } from '../../../shared/logger/logger.ts';
import { MetricsSnapshot } from '../../../shared/logger/metrics.ts';

const log = createLogger('AutoTracker');

/**
 * Shape common to every event model this module hands to the transport or
 * the consent endpoint (`HtmlEventModel`, `PageEventModel`,
 * `SessionEventModel`, a raw consent record, ...). Only `name`/`type` are
 * ever read directly here — the rest travels opaquely through
 * `JSON.stringify`/the PII scrubber, hence the index signature.
 */
type TrackableEvent = {
  name: string;
  type?: string;
  [key: string]: unknown;
};

/**
 * The most recently constructed, not-yet-disposed instance.
 *
 * D-2 fix: `AutoTrackerModule` subscribes to `document`/`window` with no
 * teardown, so a second instance used to double-send every event (14
 * duplicate consent POSTs for one `consent()` call — see
 * `docs/sdk-hardening/DEFECTS.md` D-2). Real triggers: two copies of the
 * install snippet on one page, or a SPA re-running init on a route change.
 * Tracking the active instance here lets the constructor dispose of it
 * automatically, so a second instantiation is safe rather than merely
 * "not recommended".
 */
export class AutoTrackerModule {
  private static _activeInstance: AutoTrackerModule | null = null;
  private readonly _config: IntemptConfig;
  private readonly _profileTrackerModule = new ProfileTrackerModule();
  private readonly _sessionTrackerModule = new SessionTrackerModule();
  private readonly _pagesTrackerModule = new PageTrackerModule();
  private readonly _htmlTrackerModule = new HtmlTrackerModule();
  private readonly _shopifyTrackerModule: ShopifyTrackerModule | undefined;

  /** Consent state and the consent-record POST — see `autoTracker.consent.ts`. */
  private readonly _consent: AutoTrackerConsent;

  /** Identity function unless the customer enabled `piiScrubbing`. */
  private readonly _scrubPii: PiiScrubber;

  private readonly _api: string;

  /** Legacy unbatched delivery, used only when the batcher never initialised. */
  private readonly _eventPool: AutoTrackerEventPool;
  private readonly _transport: AutoTrackerTransport;
  private _disposed: boolean = false;

  private readonly _onShopifyEvent = (event: Event): void => {
    if (!this.isUserOptIn()) return;
    const { detail } = event as ShopifyEvent;
    const { eventName, product } = detail;

    const profileId = this.getProfileId();
    const sessionId = this.getSessionId();
    const pageId = this.getPageId();

    if (!profileId || !sessionId || !pageId) return;

    const eventData = new ProductModel({
      eventTitle: eventName,
      products: [product],
      profileId,
      sessionId,
      pageId,
    });

    dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: eventData });
  };

  private readonly _onHtmlEvent = (event: Event): void => {
    if (!this.isUserOptIn()) return;

    const { detail } = event as CustomEvent;
    const { eventName, domEventName, target } = detail;

    const profileId = this.getProfileId();
    const sessionId = this.getSessionId();
    const pageId = this.getPageId();

    if (!profileId || !sessionId || !pageId) return;

    const eventData = new HtmlEventModel({
      name: eventName,
      sessionId: this.getSessionId(),
      profileId: this.getProfileId(),
      pageId: this._getPageId(),
      data: new HtmlElementDataComponent(target, domEventName),
    });

    dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: eventData });
  };

  private readonly _onPageEvent = (event: Event): void => {
    if (!this.isUserOptIn()) return;
    const { detail } = event as CustomEvent;
    const {
      eventName,
      fullUrl,
      title,
      windowWidth,
      pageId,
      duration,
      previousPage,
    } = detail;

    this.handleShopifyEvent(eventName);

    const eventData = new PageEventDataComponent({
      duration,
      title,
      fullUrl,
      windowWidth,
      previousPage,
    });

    const profileId = this.getProfileId();
    const sessionId = this.getSessionId();

    if (!profileId || !sessionId || !pageId) return;

    const pageEvent = new PageEventModel({
      name: eventName,
      sessionId,
      profileId,
      pageId,
      data: eventData,
    });

    dispatchIntemptEvent(IntemptEventListenerName.EVENT, { event: pageEvent });
  };

  private readonly _onSessionEvent = (event: Event): void => {
    if (!this.isUserOptIn()) return;
    const { detail } = event as CustomEvent;
    const { eventName, userAttributes, eventAttributes } = detail;

    const sessionId = this.getSessionId();
    const profileId = this.getProfileId();

    if (!profileId || !sessionId) return;

    const sessionEvent = new SessionEventModel({
      name: eventName,
      sessionId,
      profileId,
      data: eventAttributes,
      userAttributes,
    });

    dispatchIntemptEvent(IntemptEventListenerName.EVENT, {
      event: sessionEvent,
    });
  };

  private readonly _onPooledEvent = (customDomEvent: Event): void => {
    if (!this.isUserOptIn()) return;
    const { detail } = customDomEvent as CustomEvent;
    const { event } = detail;
    const { type } = event;

    switch (type) {
      case 'consent':
        // Not scrubbed and not batched, both deliberately: a consent record's
        // `email` field IS the record, and an audit record must not queue behind
        // analytics. See `autoTracker.consent.ts`.
        void this._consent.sendConsentRecord(event);
        break;
      default:
        this._onTrackData(event);
        break;
    }
  };

  constructor(intemptConfig: IntemptConfig, api: string) {
    this._config = { ...intemptConfig };
    this._api = api;
    this._transport = new AutoTrackerTransport(this._config, this._api);
    this._consent = new AutoTrackerConsent(this._config, this._api);
    this._eventPool = new AutoTrackerEventPool(this._config, this._api);

    // D-2: constructing a new instance retires whichever one is currently
    // live, so two never end up listening on the same document/window at
    // once. See `_activeInstance` above.
    if (AutoTrackerModule._activeInstance) {
      AutoTrackerModule._activeInstance.dispose();
    }
    AutoTrackerModule._activeInstance = this;

    this._scrubPii = createPiiScrubber(
      typeof intemptConfig.piiScrubbing === 'object'
        ? {
            ...intemptConfig.piiScrubbing,
            enabled: intemptConfig.piiScrubbing.enabled !== false,
          }
        : { enabled: intemptConfig.piiScrubbing === true },
    );

    this._shopifyTrackerModule = intemptConfig.shopify
      ? new ShopifyTrackerModule()
      : undefined;

    // Initialize batcher
    this._transport.initialize();

    document.addEventListener(
      IntemptEventListenerName.EVENT,
      this._onPooledEvent,
    );
    document.addEventListener(
      IntemptEventListenerName.SESSION,
      this._onSessionEvent,
    );
    document.addEventListener(IntemptEventListenerName.PAGE, this._onPageEvent);

    try {
      this._pagesTrackerModule.start();
    } catch (e) {
      log.error('page tracker failed to start', e);
    }

    document.addEventListener(
      IntemptEventListenerName.SHOPIFY,
      this._onShopifyEvent,
    );
    document.addEventListener(IntemptEventListenerName.HTML, this._onHtmlEvent);
  }

  /**
   * Unsubscribes every listener this instance attached to `document`/`window`
   * and stops its transport. D-2 fix: without this, a second instance's
   * listeners stack on top of the first instance's and every event is sent
   * once per live instance. Idempotent — safe to call more than once.
   */
  dispose(): void {
    if (this._disposed) return;

    document.removeEventListener(
      IntemptEventListenerName.EVENT,
      this._onPooledEvent,
    );
    document.removeEventListener(
      IntemptEventListenerName.SESSION,
      this._onSessionEvent,
    );
    document.removeEventListener(
      IntemptEventListenerName.PAGE,
      this._onPageEvent,
    );
    document.removeEventListener(
      IntemptEventListenerName.SHOPIFY,
      this._onShopifyEvent,
    );
    document.removeEventListener(
      IntemptEventListenerName.HTML,
      this._onHtmlEvent,
    );

    this._transport.dispose();

    this._disposed = true;

    if (AutoTrackerModule._activeInstance === this) {
      AutoTrackerModule._activeInstance = null;
    }
  }

  refresh() {
    this._profileTrackerModule.refresh();
    this._sessionTrackerModule.refresh();
    this._pagesTrackerModule.refresh();
  }

  init() {
    this._pagesTrackerModule.init();
    this._htmlTrackerModule.init();
  }

  // Consent is delegated in full to `AutoTrackerConsent`; these four members are
  // the public surface `IntemptJs` calls, kept here so the split is invisible to
  // callers. The reasoning for each lives with the implementation.
  get doNotTrack(): boolean {
    return this._consent.doNotTrack;
  }

  set doNotTrack(value: boolean) {
    this._consent.doNotTrack = value;
  }

  isUserOptIn(): boolean {
    return this._consent.isUserOptIn();
  }

  forgetConsentDecision(): void {
    this._consent.forgetConsentDecision();
  }

  getSessionId() {
    const browserSessionId = this._sessionTrackerModule.getId();
    const localSessionId = this._sessionTrackerModule.getLocalId();

    return browserSessionId ? browserSessionId : localSessionId;
  }

  getProfileId() {
    return this._profileTrackerModule.getId();
  }

  getPageId() {
    return this._pagesTrackerModule.getId();
  }

  /**
   * Delivery-pipeline metrics, or `null` when the batcher never initialised.
   * Surfaced on the public API as `intempt.getDiagnostics()`.
   */
  /**
   * Delivery-pipeline metrics, or `null` when the batcher never initialised.
   * Surfaced on the public API as `intempt.getDiagnostics()`.
   */
  getDiagnostics(): MetricsSnapshot | null {
    return this._transport.getDiagnostics();
  }

  private handleShopifyEvent(eventName: IntemptPageEventName) {
    if (eventName === IntemptEventName.PAGE_LEAVE) return;
    this._shopifyTrackerModule?.track();
  }

  private _onTrackData(rawData: TrackableEvent) {
    // The single choke point for scrubbing: both the batcher and the legacy
    // debounced fallback go through here, so one call covers every event path.
    //
    // Consent records deliberately do NOT pass through here — they are routed to
    // `AutoTrackerConsent.sendConsentRecord` by `_onPooledEvent` before this point.
    // That
    // matters: a consent record's `email` field *is* the record. Redacting it
    // would destroy the proof of consent, which is the one payload in the SDK
    // where the PII is the point.
    const data = this._scrubPii(rawData);

    // Use batcher if available, otherwise fallback to old method
    if (this._transport.initialized && this._transport.batcher) {
      const name = data.name.toLowerCase();
      const batcher = this._transport.batcher;

      // For "Leave Page" events, flush immediately
      if (name === 'leave page') {
        batcher.enqueue(data).then(() => {
          batcher.flush({ unloading: true });
        });
      } else {
        // Enqueue normally - batcher will handle batching
        batcher.enqueue(data);
      }
    } else {
      // No batcher: fall back to the in-memory pool, which has none of the
      // batcher's delivery guarantees. See `autoTracker.eventPool.ts`.
      this._eventPool.push(data);
    }
  }

  private _getPageId() {
    return this._pagesTrackerModule.getId();
  }
}
