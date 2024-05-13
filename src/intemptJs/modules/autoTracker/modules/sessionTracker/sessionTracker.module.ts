import { dispatchIntemptEvent, generateId } from '../../../../../shared/shared.utils.ts';
import { getCookie, localIntemptSessionCookie, setCookie } from '../../../../../shared/storageHandler.ts';
import { LocationApi, SessionCookie, SessionCookieObject } from '../../../../types/autoTracker.types.ts';

export class SessionTrackerModule {
  private readonly idType = 'ses';
  private readonly keys = ['intempt_session', 'session_initializer_name'];


  private readonly intemptSession = 'intempt_session';
  private readonly sessionInitializerName = 'session_initializer_name';



  private readonly millisecondsPerSecond  = 1000;
  private readonly secondsPerMinute  = 60;
  private readonly  minutesStep  = 30;
  private readonly  minutesToExtend  = 5;

  private readonly _defaultSessionTimeWithoutActivity = this.minutesStep * this.secondsPerMinute * this.millisecondsPerSecond;
  private readonly _defaultSessionTimeToExtend = this.minutesToExtend * this.secondsPerMinute * this.millisecondsPerSecond;

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

  init(){
    this._initSessionCookie();
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

  getInitializerName(){
    const cookie = getCookie(this.sessionInitializerName) as {session_initializer_name : string} | null;
    return !!cookie ? cookie[this.sessionInitializerName] : '';
  }

  clearCookies(cookieNames:string[]){
    cookieNames.forEach((cookieName) => setCookie({
        name: cookieName,
        value: '',
        path: '/',
        expiration: -1
      })
    )
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
   * Initialize the session cookie
   * @returns {string} - The session cookie
   * */
  private _initSessionCookie(){
    const cookie = getCookie(this.intemptSession) as SessionCookie | null;

    return !!cookie
      ? this._onActiveSession(cookie)
      : this._onNewSession();

  }

  /**
   * Runs when a new session should be created
   * */
  private _onNewSession(initEventName:string = 'Start Session'){
    console.log('_onNewSession');
    const newCookie = setCookie({
      name: this.intemptSession,
      value: JSON.stringify({
        id: generateId(this.idType),
        startAction: new Date().getTime(),
        lastForegroundAction: null,
        lastBackgroundAction: null,
        lastAction: new Date().getTime(),
        eventsCounter: 0,
      }),
      path: '/',
      expiration: this._defaultSessionTimeWithoutActivity,
    });

    return this._start(initEventName)
      .then(() => ({ ...JSON.parse(newCookie[this.intemptSession]) } as SessionCookieObject))
  }

  /**
   * Runs when session cookie is available and checks if the session is valid
   * if the session is not valid, it ends the session and runs _onNewSession (creates a new session)
   * */
  private async _onActiveSession(sessionCookie:SessionCookie){
    const session = { ...JSON.parse(sessionCookie[this.intemptSession]) } as SessionCookieObject;

    const isValid = this._isValidSession(session.startAction, session.lastAction);

    if(!isValid){
       await this._end('End Session');
       return this._onNewSession();
    }
  }

  private async _start(initializerEventName:string){
    setCookie({
      name: this.sessionInitializerName,
      value: initializerEventName,
      path: '/',
    });

    const location = await this._getLocation();

    dispatchIntemptEvent('intempt:session', {
      eventName: 'Start Session',
      initializerName: initializerEventName,
      ...location,
      type: 'sessionStart',
    });

  }

  private async _end(initializerEventName:string){
    const location = await this._getLocation();
    const sessionCookie = getCookie(this.intemptSession) as SessionCookie;

    const session = !!sessionCookie ?
      { ...JSON.parse(sessionCookie[this.intemptSession]) } as SessionCookieObject
      : localIntemptSessionCookie();


    const eventCounter = session.eventsCounter;
    const duration = new Date().getTime() - session.startAction;


    dispatchIntemptEvent('intempt:session', {
      eventName: 'End Session',
      initializerName: initializerEventName,
      type: 'sessionEnd',
      eventCounter,
      duration,
      ...location
    });
  }

  private _sessionActivityHandler(){
    this._allTrackingEvents.forEach( (domEventName) => {
      document.addEventListener(domEventName, async (event) => {
        const { detail } = event as CustomEvent;
        const { eventName } = detail;
        if(domEventName === 'intempt:logOut') {
          return this._end(eventName);
        }

        const sessionCookie = getCookie(this.intemptSession) as SessionCookie;

        if (!sessionCookie) {
          await this._end(eventName);
          return this._onNewSession(eventName);
        }


        const session = { ...JSON.parse(sessionCookie[this.intemptSession]) } as SessionCookieObject;

        const incrementedSession = this._incrementSessionEventCounter(session);

        if(this._isForegroundEvent(domEventName)){
          this._onForegroundActionActivityTime(incrementedSession);
        }
        else if(this._isBackgroundEventNames(domEventName)){
          await this._onBackgroundActionActivityTime(eventName, incrementedSession);
        }
      })
    })
  }

  private _incrementSessionEventCounter(session:SessionCookieObject){
    const {
      id,
      startAction,
      eventsCounter,
      lastForegroundAction,
      lastBackgroundAction
    } = session;
    const now = new Date().getTime();
    const remainingTime = this._getSessionRemainingExpirationTime(now ,startAction);


    const incrementedSessionCookie = setCookie({
      name: this.intemptSession,
      value: JSON.stringify({
        id: id,
        startAction: startAction,
        lastForegroundAction: lastForegroundAction,
        lastBackgroundAction: lastBackgroundAction,
        lastAction: now,
        eventsCounter: eventsCounter + 1
      }),
      path: '/',
      expiration: remainingTime
    });

    return { ...JSON.parse(incrementedSessionCookie[this.intemptSession]) } as SessionCookieObject;
  }

  private async _onBackgroundActionActivityTime(eventName:string,{ lastBackgroundAction, lastForegroundAction}:SessionCookieObject){
    const now = new Date().getTime();

    const foregroundAction = lastForegroundAction ?? now;
    const backgroundAction = lastBackgroundAction ?? now;

    const timeSinceLastForegroundEvent = now - foregroundAction;
    const timeSinceLastBackgroundEvent = now - backgroundAction;


    if(
      (timeSinceLastBackgroundEvent <= this._defaultSessionTimeToExtend) &&
      (timeSinceLastForegroundEvent > this._defaultSessionTimeToExtend)
    ){
      await this._end(eventName);

      setCookie({
        name: this.intemptSession,
        value: JSON.stringify({
          id: generateId(this.idType),
          startAction: new Date().getTime(),
          lastForegroundAction: null,
          lastBackgroundAction: null,
          lastAction: new Date().getTime(),
          eventsCounter: 0,
        }),
        path: '/',
        expiration: this._defaultSessionTimeWithoutActivity,
      });

      await this._start(eventName);
    }

  }

  private _onForegroundActionActivityTime({ id, startAction, eventsCounter, lastBackgroundAction}:SessionCookieObject){
    const now = new Date().getTime();
    const remainingTime = this._getSessionRemainingExpirationTime(now ,startAction);

    const newExpirationDuration  = remainingTime + this._defaultSessionTimeToExtend;

    const value = {
      id: id,
      startAction: startAction,
      lastForegroundAction: now,
      lastBackgroundAction: lastBackgroundAction,
      lastAction: now,
      eventsCounter: eventsCounter
    }

    return setCookie({
      name: this.intemptSession,
      value: JSON.stringify(value),
      path: '/',
      expiration: newExpirationDuration
    })
  }

  /**
   * Validate the cookie session using the start and last activity time
   * @param start {number} - The start time of the session
   * @param lastActivity {number} - The last activity time of the session
   * @returns {boolean} - The session is valid or not
   * */
  private _isValidSession(start:number, lastActivity:number): boolean {
    return lastActivity - start < this._defaultSessionTimeWithoutActivity;
  }

  /**
   * check if the event is a foreground event
   * @param eventName {string} - The DOM event name
   * @returns {boolean} - The event is a foreground event or not
   * */
  private _isForegroundEvent(eventName:string): boolean{
    return this._foregroundEventNames.includes(eventName);
  }

  /**
   * check if the event is a background event
   * @param eventName {string} - The DOM event name
   * @returns {boolean} - The event is a background event or not
   * */
  private _isBackgroundEventNames(eventName:string): boolean{
    return this._backgroundEventNames.includes(eventName);
  }

  /**
   * Helper method to get the remaining time of the session
   * @param now {number} - The current time
   * @param start {number} - The start time of the session
   * @returns {number} - The remaining time of the session
   * */
  private _getSessionRemainingExpirationTime(now: number, start: number): number{
    return this._defaultSessionTimeWithoutActivity - (now - start);
 }


}

