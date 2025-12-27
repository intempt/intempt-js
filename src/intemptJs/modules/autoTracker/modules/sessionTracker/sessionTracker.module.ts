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

  refresh(){
    this.initReferrerCookie();
    this.setSessionCookie();
  }


  get cookieKeys() {
    return this.keys;
  }

  getId(){
    const cookie = getCookie(this.intemptSession) as {intempt_session : string} | null;
    
    if (cookie) {
      try {
        const parsed = JSON.parse(cookie[this.intemptSession]);
        if (parsed?.id) {
          return parsed.id;
        }
      } catch (error) {
        console.error('Error parsing session cookie:', error);
        // Return empty string on error - cookie is corrupted
        return '';
      }
    }
    
    return '';
  }

  getLocalId(){
    const localCookie = localIntemptSessionCookie();
    return localCookie?.id ?? '' ;
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

        // No cookie exists - create new session (unless it's Leave Page)
        if (!sessionCookie && eventName.toLowerCase() !== 'leave page') {
          return this._onNewSession(eventName);
        }

        // Cookie exists - try to parse it
        let session = { id: null as string | null };
        if (sessionCookie?.[this.intemptSession]) {
          try {
            session = { ...JSON.parse(sessionCookie[this.intemptSession]) };
          } catch (error) {
            console.error('Error parsing session cookie in handler:', error);
            // Cookie is corrupted - create new session (unless it's Leave Page)
            if (eventName.toLowerCase() !== 'leave page') {
              return this._onNewSession(eventName);
            }
            // For 'Leave Page' event, just skip (don't create new session)
            return;
          }
        }

        // Refresh session cookie with existing ID (or undefined to generate new)
        this.setSessionCookie(session.id ?? undefined);
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

