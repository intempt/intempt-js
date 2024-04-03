import { HtmlElementDataComponent } from '../../component/HtmlEventData.component.ts';
import { SessionTrackerModule } from './modules/sessionTracker/sessionTracker.module.ts'
import { ProfileTrackerModule } from './modules/profileTracker/profileTracker.module.ts'
import { PageTrackerModule } from './modules/pagesTracker/pagesTracker.module.ts';
import { SessionEventModel } from './models/session.model.ts';
import { SessionEventDataComponent } from '../../component/sessionEventData.component.ts';
import { debounce, dispatchIntemptEvent, getLocationInfo } from '../../../shared/shared.utils.ts';
import { UserAttributeComponent } from '../../component/userAttribute.component.ts';
import { PageEventModel } from './models/pageEvent.model.ts';
import { PageEventDataComponent } from '../../component/pageEventData.component.ts';
import { HtmlEventModel } from './models/HtmlEvent.model.ts';
import { HtmlTrackerModule } from './modules/htmlTracker/htmlTracker.module.ts';
import { IntemptConfig } from '../../intemptJs.types.ts';


export class AutoTrackerModule {
  private readonly _config:IntemptConfig;
  private readonly _sessionTrackerModule = new SessionTrackerModule();
  private readonly _profileTrackerModule = new ProfileTrackerModule();
  private readonly _pagesTrackerModule = new PageTrackerModule();
  private readonly _htmlTrackerModule = new HtmlTrackerModule();

  private readonly _keys:string[];

  private readonly _api:string;


  private readonly _eventPool:any[] = [];

  constructor(intemptConfig: IntemptConfig, api:string) {

    this._config = { ...intemptConfig };
    this._api = api;
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

  get cookieKeys(){
    return this._keys;
  }

  init() {
    this._profileTrackerModule.init();
    this._sessionTrackerModule.init();
    this._pagesTrackerModule.init();
    this._htmlTrackerModule.init();


  }


  private _trackHtml(){
    document.addEventListener('intempt:html', (event) => {
      const { detail } = event as CustomEvent;
      const { eventName, target } = detail;

      const intemptEvent = new HtmlEventModel({
        name: eventName,
        sessionId: this.getSessionId(),
        profileId: this.getProfileId(),
        pageId: this._getPageId(),
        data: new HtmlElementDataComponent(target)
      })

      dispatchIntemptEvent('intempt:event', { event: intemptEvent});
    })
  }

  private _trackPage(){
    document.addEventListener('intempt:page', (event) => {
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
      const { detail } = event as CustomEvent;
      const { eventName, initializerName } = detail;

      const eventData = new SessionEventDataComponent(initializerName);

      const { region, city, country , ip} = await getLocationInfo();

      const attributes = new UserAttributeComponent({
        region,
        city,
        country,
        ip
      });

      const sessionEvent = new SessionEventModel({
        name: eventName,
        sessionId : this.getSessionId(),
        profileId: this.getProfileId(),
        data: eventData,
        userAttributes: attributes
      })


      dispatchIntemptEvent('intempt:event', { event: sessionEvent});
    })
  }



  private _eventPoolHandler() {
    let debouncedSendEvents:ReturnType<typeof debounce>;

    document.addEventListener('intempt:event', (customDomEvent) => {
      const { detail } = customDomEvent as CustomEvent;
      const name = detail.event.name.toLowerCase();

      console.log('Event Pool: ', detail.event);


      this._eventPool.push(detail.event);

      if(name.toLowerCase() === 'leave page'){
        debouncedSendEvents = debounce(() => this._sendTrackEventData(), 0);
      }
      else{
        debouncedSendEvents = debounce(() => this._sendTrackEventData(), 1000);
      }

      return debouncedSendEvents();
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

  private _sendConsentTrackEventData(data:any) {
    const {organization, sourceId, project, writeKey} = this._config;

    const url = `${this._api}/${organization}/projects/${project}/consents/data`;

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({...data}),
      keepalive: true
    })

  }

  private _sendTrackEventData() {
    /**
     * Make deep copy of the eventPool
     * */
    const data = JSON.parse(JSON.stringify(this._eventPool));

    this._clearEventPool();

    const {organization, sourceId, project, writeKey} = this._config;

    const url = `${this._api}/${organization}/projects/${project}/sources/${sourceId}/track`;

    const [ username, password ] = writeKey.split('.');

    const encodedCredentials = btoa(`${username}:${password}`);

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${encodedCredentials}`,
      },
      body: JSON.stringify({
        track: data
      }),
      keepalive: true
    })
  }



  private _getPageId() {
    return this._pagesTrackerModule.getId();
  }

  private _clearEventPool() {
    this._eventPool.length = 0;
  }


  getSessionId() {
    return this._sessionTrackerModule.getId();
  }

  getProfileId() {
    return this._pagesTrackerModule.getId();
  }



}
