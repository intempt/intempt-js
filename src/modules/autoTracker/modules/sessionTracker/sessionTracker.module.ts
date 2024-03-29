import { generateId, getLocationInfo } from '../../../../shared/shared.utils.ts'
import { getCookie, setCookie } from '../../../../shared/storageHandler.ts'
import { SessionEvent } from './model/session.model.ts'
import { UserAttributeComponent } from '../../../component/userAttribute.component.ts'


// const obj = {
//     "data": {
//       "landingPageHash": "#install for help.intempt.com/docs#install",
//       "utmCampaign": "Spring_Sale_2024, Newsletter_March_2024, Product_Launch_Q2, Holiday_Deals_2024",
//       "utmContent": "sidebar_banner, footer_link, header_button, textlink_article",
//       "utmMedium": "social, display, cpm, ppc, cpc, organic, affiliate, email, referral",
//       "utmSource": "newsletter, email, Google",
//       "utmTerm": "running+shoes, luxury+car+rentals, organic+dog+food",
//       "sessionStartEventName": "purchase",
//       "source": "web, iOS",
//       "landingPageQuery": "?utm_source=Google&utm_medium=CPC&utm_campaign=sell&utm_term=marketing&utm_content="
//     },
// }



export class SessionTrackerModule {
  private readonly key = 'sessionId'
  private readonly _defaultSessionTimeWithoutActivity: number;
  private readonly _domActivityEventNames = ['click'];

  constructor() {
    const millisecondsPerSecond  = 1000;
    const secondsPerMinute  = 60;
    const minutesStep  = 3;

    this._defaultSessionTimeWithoutActivity = minutesStep * secondsPerMinute * millisecondsPerSecond;
    this.sessionActivityHandler();
  }



  async start(){
    const startSessionName = 'Start Session';
    const { sessionId } = this._getSessionId();
    const { profileId} = { profileId: 'Need to Generate'};
    const { region, city, country , ip} = await getLocationInfo();

    const event = new SessionEvent({
      sessionId,
      profileId,
      name: startSessionName,
      data:{},
      userAttributes: new UserAttributeComponent({
        region,
        city,
        country,
        ip
      })
    })

    console.log('start: ',event)

  }

  end(){}

  setSessionId(){
    return setCookie({
      name: this.key,
      value: JSON.stringify({
        id: generateId(),
        startAction: new Date().getTime(),
        lastAction: new Date().getTime(),
      }),
      path: '/',
      maxAge: this._defaultSessionTimeWithoutActivity
    })
  }

  _getSessionId(){
    const cookie = getCookie(this.key) as {sessionId : string} | null;
    const sessionIdObject = !!cookie
      ? { ...JSON.parse(cookie[this.key]) }
      : this.setSessionId();

    return {
      sessionId: sessionIdObject.id,
      start: sessionIdObject.startAction,
      lastAction: sessionIdObject.lastAction
    }
  }

  private updateSessionActivity(){
    const { sessionId, start} = this._getSessionId();
    const currentActivityTime = new Date().getTime();

    return setCookie({
      name: 'sessionId',
      value: JSON.stringify({
        id: sessionId,
        startAction: start,
        lastAction: currentActivityTime,
      }),
      path: '/',
      maxAge: this._defaultSessionTimeWithoutActivity
    })
  }

  private sessionActivityHandler(){
    this._domActivityEventNames.forEach((name:string) =>
      document.addEventListener(name, () => this.updateSessionActivity())
    )


  }




  isValidSession(start:number, lastActivity:number) {
    return lastActivity - start < this._defaultSessionTimeWithoutActivity;
  }

}
/**
 * Clicks: click event
 * Keypress: keypress or keydown event
 * Mouse movement: mousemove event
 * Touch events: touchstart, touchmove, touchend, etc.
 * Form submissions: submit event
 * Focus changes: focus and blur events
 * Scroll events: scroll event
 * Drag and drop: dragstart, drag, dragend, etc.
 * Selection changes: select event
 * Pointer events: pointerdown, pointermove, pointerup, etc.
 *
 * */
