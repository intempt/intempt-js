import { dispatchIntemptEvent, generateId } from '../../../../../shared/shared.utils.ts';
import { getCookie, localIntemptSessionCookie, setCookie } from '../../../../../shared/storageHandler.ts';
import {  SessionCookie, SessionCookieObject } from '../../../../types/autoTracker.types.ts';
import { SessionEventDataComponent } from '../../../../component/sessionEventData.component.ts';
import { UserAttributeComponent } from '../../../../component/userAttribute.component.ts';
import { BaseURLParser } from '../../../../_baseUrlParser.ts';
import { PlatformParser } from '../../../../platformParser.ts';

export class SessionTrackerModule extends PlatformParser{
  private readonly idType = 'ses';
  private readonly _eventName = 'Session start';

  private readonly intemptSession = 'intempt_session';
  private readonly keys = [this.intemptSession];



  private readonly millisecondsPerSecond  = 1000;
  private readonly secondsPerMinute  = 60;
  private readonly minutesStep  = 30;

  private readonly _defaultSessionTimeWithoutActivity = this.minutesStep * this.secondsPerMinute * this.millisecondsPerSecond;

  private readonly _foregroundEventNames = [
    'intempt:html',
    'intempt:page',
    'intempt:identify',
  ];
  private readonly _backgroundEventNames = [
    'intempt:track',
    'intempt:group',
    'intempt:track',
    'intempt:record',
    'intempt:alias',
    'intempt:product',
    'intempt:logOut',
    'intempt:consent',
  ];
  private _allTrackingEvents = [...this._foregroundEventNames, ...this._backgroundEventNames]


  constructor() {
    super();
    this.initReferrerCookie();
    this._sessionActivityHandler();
  }


  get cookieKeys() {
    return this.keys;
  }

  getId(){
    const cookie = getCookie(this.intemptSession) as {intempt_session : string} | null;
    const { id } = !!cookie
      ? { ...JSON.parse(cookie[this.intemptSession]) } as {id: string}
      : {id: ''};

    return id
  }

  getLocalId(){
    const localCookie = localIntemptSessionCookie();
    return localCookie?.id ?? '' ;
  }

  clearCookies(cookieNames:string[]){
    cookieNames.forEach(
      (cookieName) => setCookie({
        name: cookieName,
        value: '',
        path: '/',
        expiration: -1
      })
    )
  }

  setSessionCookie(id?:string){
    const sessionId = id ?? generateId(this.idType);


    setCookie({
      name: this.intemptSession,
      value: JSON.stringify({
        id: sessionId,
      }),
      domain: window.location.hostname,
      path: '/',
      expiration: this._defaultSessionTimeWithoutActivity,
    });
  }

  private initReferrerCookie(){
    const cookie = getCookie('_intempt_referrer');
    if(cookie) { return;}

    let referrerCookieObj = {referrer:'direct', fullReferrer:'direct'};

    if(!!document.referrer){
      try{
        const url = new URL(document.referrer);
        referrerCookieObj = {
          referrer: url.host,
          fullReferrer:  url.href
        };
      }
      catch (error:any){
        console.log('[_getReferrerValues] ERROR',error);
      }
    }

    setCookie({
      name: '_intempt_referrer',
      value: JSON.stringify(referrerCookieObj),
      path: '/',
    });



  }

  private _sessionActivityHandler(){
    this._allTrackingEvents.forEach( (domEventName) => {
      document.addEventListener(domEventName, (event) => {
        const { detail } = event as CustomEvent;
        const { eventName } = detail;

        const sessionCookie = getCookie(this.intemptSession) as SessionCookie;

        if (!sessionCookie && eventName.toLowerCase() !== 'leave page') {
          return this._onNewSession(eventName);
        }

        if(domEventName === 'intempt:logOut') {
          return this.clearCookies(eventName);
        }

        const session = sessionCookie[this.intemptSession]
          ? { ...JSON.parse(sessionCookie[this.intemptSession]) }
          : { id:null };

        this.setSessionCookie(session.id);
      })
    })
  }



  /**
   * Runs when a new session should be created
   * */
  private async _onNewSession(initializerEventName:string = this._eventName){
    this.setSessionCookie();

    const [location, platform] = await Promise.all([
      this._getLocation(),
      this._getPlatform()
    ]);

    const urlParams = new BaseURLParser();


    const eventAttributes = new SessionEventDataComponent({
      sessionStartEventName: initializerEventName,
      query: urlParams.query,
      urlHash: urlParams.urlHash,
    });

    const userAttributes = new UserAttributeComponent(
      location,
      urlParams,
      platform,
      this.deviceType,
      this.browser
    );

    dispatchIntemptEvent('intempt:session', {
      eventName: this._eventName,
      eventAttributes,
      userAttributes,
      type: 'sessionStart',
    });
  }
}

