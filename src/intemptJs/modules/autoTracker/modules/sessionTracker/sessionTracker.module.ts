import { dispatchIntemptEvent, generateId} from '../../../../../shared/shared.utils.ts';
import { getCookie, setCookie } from '../../../../../shared/storageHandler.ts'
import { SessionCookie, SessionCookieObject } from '../../autoTracker.types.ts';


// [
//   'keydown',
//   'touchstart',
//   'select',
//   'focusin',
//   'focusout',
//   'drag',
//   'scroll - Require Performance optimization',
//   'pointermove - Require Performance optimization',
//
//   'click - intempt:html',
//   'input - intempt:html',
//   'change - intempt:html',
//   'submit - intempt:html',
//   'DOMContentLoaded - intempt:page',
//   'beforeunload - intempt:page'
// ];



export class SessionTrackerModule {
  private readonly keys = ['intempt_session', 'is_first_intempt_session'];


  private readonly intemptSession = 'intempt_session';
  private readonly isFirstIntemptSession = 'is_first_intempt_session';


  private readonly millisecondsPerSecond  = 1000;
  private readonly secondsPerMinute  = 60;
  private readonly  minutesStep  = 30;
  private readonly  minutesToExtend  = 5;

  private readonly _defaultSessionTimeWithoutActivity = this.minutesStep * this.secondsPerMinute * this.millisecondsPerSecond;
  private readonly _defaultSessionTimeToExtend = this.minutesToExtend * this.secondsPerMinute * this.millisecondsPerSecond;

  private readonly _foregroundEventNames = [
    'intempt:html',
    'intempt:page',
    'intempt:identify ',
  ];
  private readonly _backgroundEventNames = [
    'intempt:track ',
    'intempt:group ',
    'intempt:track ',
    'intempt:record ',
    'intempt:alias ',
    'intempt:logOut ',
    'intempt:consent ',
  ];

  private _allTrackingEvents = [...this._foregroundEventNames, ...this._backgroundEventNames]


  constructor() {}

  get cookieKeys(){
    return this.keys;
  }

  init(){
    console.log('session init')

    this._sessionActivityHandler();

    if(this._isFirstSession()) return ;

    this._initSessionCookie();

    setCookie({
      name: this.isFirstIntemptSession,
      value: JSON.stringify(false),
      path: '/',
    });
  }

  getId(){
    const cookie = getCookie(this.intemptSession) as {intempt_session : string} | null;
    const { id } = !!cookie
      ? { ...JSON.parse(cookie[this.intemptSession]) } as {id: string}
      : {id: ''};

    return id
  }

  private _start(initializerEventName:string){
    dispatchIntemptEvent('intempt:session', {
      eventName: 'Start Session',
      initializerName: initializerEventName
    });

  }

  private _end(initializerEventName:string){
    dispatchIntemptEvent('intempt:session', {
      eventName: 'End Session',
      initializerName: initializerEventName
    });
  }

  private _sessionActivityHandler(){
    this._allTrackingEvents.forEach((domEventName) => {
      document.addEventListener(domEventName, (event) => {
        const { detail } = event as CustomEvent;
        const { eventName } = detail;

        const validatedSession = this._validateSession(eventName);
        const incrementedSession = this._incrementSessionEventCounter(validatedSession);

        if(this._isForegroundEvent(domEventName)){
          this._onForegroundActionActivityTime(incrementedSession);
        }
        else if(this._isBackgroundEventNames(domEventName)){
          this._onBackgroundActionActivityTime(eventName, incrementedSession);
        }
      })
    })
  }

  private _onBackgroundActionActivityTime(eventName:string,{ lastBackgroundAction, lastForegroundAction}:SessionCookieObject){
    const now = new Date().getTime();

    const foregroundAction = lastForegroundAction ?? now;
    const backgroundAction = lastBackgroundAction ?? now;

    const timeSinceLastForegroundEvent = now - foregroundAction;
    const timeSinceLastBackgroundEvent = now - backgroundAction;


    if(
      (timeSinceLastBackgroundEvent <= this._defaultSessionTimeToExtend) &&
      (timeSinceLastForegroundEvent > this._defaultSessionTimeToExtend)
    ){
      this._end(eventName);
      this.init();
      this._start(eventName);
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

  private _validateSession(currentEventName:string):SessionCookieObject {
    let session:SessionCookieObject;

    const cookie = getCookie(this.intemptSession) as SessionCookie | null;

    console.log('_validateSession cookie: ',!!cookie);

    if(!cookie){
      const newSessionCookie = this._initSessionCookie();

      session = { ...JSON.parse(newSessionCookie[this.intemptSession]) } as SessionCookieObject;

      this._start(currentEventName);

    }
    else{
      session = { ...JSON.parse(cookie[this.intemptSession]) } as SessionCookieObject;

      const isValid = this._isValidSession(session.startAction, session.lastAction);
      console.log(isValid);

      if(!isValid){
        this._end(currentEventName);
        this.init();
        this._start(currentEventName);

        const validSession = getCookie(this.intemptSession) as SessionCookie;

        session = { ...JSON.parse(validSession[this.intemptSession]) } as SessionCookieObject;
      }
    }

    return session;
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
    const remainingTime = this._getSessionRemainingExpirationTime(now ,startAction)

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

  /**
   * Initialize the session cookie
   * @returns {string} - The session cookie
   * */
  private _initSessionCookie(){
    return setCookie({
      name: this.intemptSession,
      value: JSON.stringify({
        id: generateId(),
        startAction: new Date().getTime(),
        lastForegroundAction: null,
        lastBackgroundAction: null,
        lastAction: new Date().getTime(),
        eventsCounter: 0
      }),
      path: '/',
      expiration: this._defaultSessionTimeWithoutActivity
    })
  }

  /**
   * Validate the cookie session using the start and last activity time
   * @param start {number} - The start time of the session
   * @param lastActivity {number} - The last activity time of the session
   * @returns {boolean} - The session is valid or not
   * */
  private _isValidSession(start:number, lastActivity:number) {
    return lastActivity - start < this._defaultSessionTimeWithoutActivity;
  }

  /**
   * Check if the current session is generally the first session
   * @returns {boolean} - The session is the first session or not
   * */
  private _isFirstSession(){
    const cookie = getCookie(this.isFirstIntemptSession) as {is_first_intempt_session : string} | null;
    return !!cookie
  }

  /**
   * check if the event is a foreground event
   * @param eventName {string} - The DOM event name
   * @returns {boolean} - The event is a foreground event or not
   * */
  private _isForegroundEvent(eventName:string){
    return this._foregroundEventNames.includes(eventName);
  }

  /**
   * check if the event is a background event
   * @param eventName {string} - The DOM event name
   * @returns {boolean} - The event is a background event or not
   * */
  private _isBackgroundEventNames(eventName:string){
    return this._backgroundEventNames.includes(eventName);
  }

  /**
   * Helper method to get the remaining time of the session
   * @param now {number} - The current time
   * @param start {number} - The start time of the session
   * @returns {number} - The remaining time of the session
   * */
  private _getSessionRemainingExpirationTime(now: number, start: number){
    return this._defaultSessionTimeWithoutActivity - (now - start);
 }
}

