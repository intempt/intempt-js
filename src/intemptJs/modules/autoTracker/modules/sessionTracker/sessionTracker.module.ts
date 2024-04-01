import { dispatchIntemptEvent, generateId} from '../../../../../shared/shared.utils.ts';
import { getCookie, setCookie } from '../../../../../shared/storageHandler.ts'


// [
//   'click',
//   'change',
//   'mousemove',
//   'keydown',
//   'touchstart',
//   'submit',
//   'focus',
//   'blur',
//
//   'select',
//   'scroll',
//   'drag',
//   'pointermove',
//   'DOMContentLoaded',
//   'beforeunload'
// ];



export class SessionTrackerModule {
  private readonly key = 'intempt_session';
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


  constructor() {}


  init(){
    this.setIntemptSessionId();
    this.sessionActivityHandler();
    this.start('Start Session');

  }


  getId(){
    const cookie = getCookie(this.key) as {intempt_session : string} | null;
    const { id } = !!cookie
      ? { ...JSON.parse(cookie[this.key]) } as {id: string}
      : {id: ''};

    return id
  }

  start(initializerEventName:string){
    dispatchIntemptEvent('intempt:session', {
      eventName: 'Start Session',
      initializerName: initializerEventName
    });

  }

  end(initializerEventName:string){
    dispatchIntemptEvent('intempt:session', {
      eventName: 'End Session',
      initializerName: initializerEventName
    });
  }

  eventCounter(){}

  setIntemptSessionId(){
    return setCookie({
      name: this.key,
      value: JSON.stringify({
        id: generateId(),
        startAction: new Date().getTime(),
        lastAction: new Date().getTime(),
        eventsCounter: 0
      }),
      path: '/',
      maxAge: this._defaultSessionTimeWithoutActivity
    })
  }


  private extendSessionActivityTime(){
    console.log('extendSessionActivityTime');
    const cookie = getCookie(this.key) as {intempt_session : string} | null;
    const session = { ...JSON.parse(cookie![this.key]) } as { id:string, startAction:number, lastAction:number, eventsCounter:number}
    const { id, startAction ,eventsCounter} =  session;

    const currentActivityTime = new Date().getTime();
    const newEventCount = eventsCounter + 1
    const currentExpirationTime = startAction + this._defaultSessionTimeWithoutActivity;
    const newExpirationTime = currentExpirationTime + this._defaultSessionTimeToExtend;
    const value = {
      id: id,
      startAction: startAction,
      lastAction: currentActivityTime,
      eventsCounter: newEventCount
    }


    return setCookie({
      name: this.key,
      value: JSON.stringify(value),
      path: '/',
      maxAge: newExpirationTime
    })
  }

  private sessionActivityHandler(){
    this._foregroundEventNames.forEach((name:string) =>
      document.addEventListener(name, () => this.extendSessionActivityTime())
    )
  }



  isValidSession(start:number, lastActivity:number) {
    return lastActivity - start < this._defaultSessionTimeWithoutActivity;
  }

}

