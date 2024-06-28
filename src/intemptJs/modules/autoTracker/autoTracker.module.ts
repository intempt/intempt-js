import { HtmlElementDataComponent } from '../../component/HtmlEventData.component.ts';
import { SessionTrackerModule } from './modules/sessionTracker/sessionTracker.module.ts'
import { ProfileTrackerModule } from './modules/profileTracker/profileTracker.module.ts'
import { PageTrackerModule } from './modules/pagesTracker/pagesTracker.module.ts';
import { SessionEventModel } from './models/session.model.ts';
// import { SessionEventDataComponent } from '../../component/sessionEventData.component.ts';
import { debounce, dispatchIntemptEvent } from '../../../shared/shared.utils.ts';
// import { UserAttributeComponent } from '../../component/userAttribute.component.ts';
import { PageEventModel } from './models/pageEvent.model.ts';
import { PageEventDataComponent } from '../../component/pageEventData.component.ts';
import { HtmlEventModel } from './models/HtmlEvent.model.ts';
import { HtmlTrackerModule } from './modules/htmlTracker/htmlTracker.module.ts';
import { IntemptConfig } from '../../types/intemptJs.types.ts';


export class AutoTrackerModule {
  private readonly _config:IntemptConfig;
  private readonly _profileTrackerModule = new ProfileTrackerModule();
  private readonly _sessionTrackerModule = new SessionTrackerModule();
  private readonly _pagesTrackerModule = new PageTrackerModule();
  private readonly _htmlTrackerModule = new HtmlTrackerModule();

  private _doNotTrack: boolean = false;
  private _capturePasswords: boolean = false;

  private readonly _keys:string[];

  private readonly _api:string;


  private readonly _eventPool:any[] = [];

  constructor(intemptConfig: IntemptConfig, api:string) {

    this._config = { ...intemptConfig };
    this._api = import.meta.env.VITE_API;
    this._keys = [
      ...this._sessionTrackerModule.cookieKeys,
      ...this._profileTrackerModule.cookieKeys,
      ...this._pagesTrackerModule.cookieKeys,
    ];


    this._eventPoolHandler();

    this._trackSession();

    this._trackPage();

    this._trackHtml();
  }


  get cookieKeys(){ return this._keys }

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
      : localSessionId
  }

  getProfileId() {
    return this._profileTrackerModule.getId();
  }

  getPageId(){
    return this._pagesTrackerModule.getId();
  }


  private _trackHtml(){
    document.addEventListener('intempt:html', (event) => {
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

      dispatchIntemptEvent('intempt:event', { event: eventData});
    })
  }

  private _trackPage(){
    document.addEventListener('intempt:page', (event) => {
      if (!this.isUserOptIn()) return;
      const { detail } = event as CustomEvent;
      const { eventName, fullUrl, title, windowWidth, pageId, duration, previousPage } = detail;

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


      dispatchIntemptEvent('intempt:event', { event: pageEvent});

    })
  }

  private _trackSession(){
    document.addEventListener('intempt:session', async (event) => {
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

      dispatchIntemptEvent('intempt:event', { event: sessionEvent});
    })
  }

  private _eventPoolHandler() {
    document.addEventListener('intempt:event', (customDomEvent) => {
      if (!this.isUserOptIn()) return;
      const { detail } = customDomEvent as CustomEvent;
      const { event  } = detail;
      const { type   } = event;

      import.meta.env.VITE_ENV === 'development' && console.log('intempt:event', event);

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

