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
import { IntemptConfig, ProductParams, RecommendationParams } from '../../types/intemptJs.types.ts';
import { ShopifyTrackerModule } from './modules/shopifyTracker/shopifyTracker.module.ts';
import { IntemptEventListenerName, IntemptEventName } from '../../types/constants.types.ts';
import { IntemptPageEventName, ShopifyEvent } from '../../types/autoTracker.types.ts';
import { ProductModel } from '../../models/product.model.ts';


export class AutoTrackerModule {
  private readonly _config:IntemptConfig;
  private readonly _profileTrackerModule = new ProfileTrackerModule();
  private readonly _sessionTrackerModule = new SessionTrackerModule();
  private readonly _pagesTrackerModule = new PageTrackerModule();
  private readonly _htmlTrackerModule = new HtmlTrackerModule();
  private readonly _shopifyTrackerModule: ShopifyTrackerModule | undefined ;

  private _doNotTrack: boolean = false;

  private readonly _api: string;

  private readonly _eventPool: any[] = [];

  constructor(intemptConfig: IntemptConfig, api: string) {

    this._config = { ...intemptConfig };
    this._api = api;

    this._shopifyTrackerModule = intemptConfig.shopify
      ? new ShopifyTrackerModule()
      : undefined;


    this._eventPoolHandler();

    this._trackSession();

    this._trackPage();

    this._trackShopify();

    this._trackHtml();
  }

  get doNotTrack(){
    return this._doNotTrack;
  }

  set doNotTrack(value: boolean){
    this._doNotTrack = value
  }

  init() {
    this._pagesTrackerModule.init();
    this._htmlTrackerModule.init();
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
      })

      const pageEvent = new PageEventModel({
        name: eventName,
        sessionId: this.getSessionId(),
        profileId: this.getProfileId(),
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
      console.error('Error sending track event data:', error);

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
      console.log('[_sendTrackEventData ] ERROR:', error);

    }

  }

  private _getPageId() {
    return this._pagesTrackerModule.getId();
  }

  private _clearEventPool() {
    this._eventPool.length = 0;
  }
}

