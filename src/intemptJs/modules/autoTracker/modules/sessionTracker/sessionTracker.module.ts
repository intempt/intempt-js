import { dispatchIntemptEvent, generateId } from '../../../../../shared/shared.utils.ts';
import { getCookie, localIntemptSessionCookie, setCookie } from '../../../../../shared/storageHandler.ts';
import { LocationApi, SessionCookie, SessionCookieObject } from '../../../../types/autoTracker.types.ts';
import { SessionEventDataComponent } from '../../../../component/sessionEventData.component.ts';
import { UserAttributeComponent } from '../../../../component/userAttribute.component.ts';

export class SessionTrackerModule {
  private readonly idType = 'ses';

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
    'intempt:logOut',
    'intempt:consent',
  ];
  private _allTrackingEvents = [...this._foregroundEventNames, ...this._backgroundEventNames]


  constructor() {
   this._sessionActivityHandler();
  }

  get cookieKeys() { return this.keys; }

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

  private _sessionActivityHandler(){
    this._allTrackingEvents.forEach( (domEventName) => {
      document.addEventListener(domEventName, (event) => {
        const { detail } = event as CustomEvent;
        const { eventName } = detail;

        const sessionCookie = getCookie(this.intemptSession) as SessionCookie;

        if (!sessionCookie) {
          return this._onNewSession(eventName);
        }

        if(domEventName === 'intempt:logOut') {
          return this.clearCookies(eventName);
        }

        const session = { ...JSON.parse(sessionCookie[this.intemptSession]) } as SessionCookieObject;

        setCookie({
          name: this.intemptSession,
          value: JSON.stringify({
            id: session.id,
          }),
          path: '/',
          expiration: this._defaultSessionTimeWithoutActivity,
        });

        // const incrementedSession = this._incrementSessionEventCounter(session);

        // if(this._isForegroundEvent(domEventName)){
        //   this._onForegroundActionActivityTime(incrementedSession);
        // }
        // else if(this._isBackgroundEventNames(domEventName)){
        //   await this._onBackgroundActionActivityTime(eventName, incrementedSession);
        // }




      })
    })
  }

  private async _getLocation():Promise<LocationApi>{
    const locationApiUrl = import.meta.env.VITE_LOCATION_API_URL

    try {
      const response = await fetch(locationApiUrl);
      const data = await response.json()
      const {ip, region, city, country } = data
      return {
        ip: ip ?? '',
        region: region ?? '',
        city: city ?? '',
        country: country ?? '',
      }
    } catch (error) {
      console.log('Fetching location not allowed');
      return {
        ip: '',
        region: '',
        city: '',
        country: '',
      }
    }
  }

  /**
   * Runs when a new session should be created
   * */
  private async _onNewSession(initializerEventName:string = 'Session'){
    setCookie({
      name: this.intemptSession,
      value: JSON.stringify({
        id: generateId(this.idType),
      }),
      path: '/',
      expiration: this._defaultSessionTimeWithoutActivity,
    });

    const location = await this._getLocation();

    const eventAttributes = new SessionEventDataComponent({
      sessionStartEventName: initializerEventName,
    });

    const userAttributes = new UserAttributeComponent({
     ...location
    });


    dispatchIntemptEvent('intempt:session', {
      eventName: 'Session',
      eventAttributes,
      userAttributes,
      type: 'sessionStart',
    });
  }
}

