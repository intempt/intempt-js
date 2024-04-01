import { HtmlElementData } from '../../../shared/HtmlElementData.ts';
import { SessionTrackerModule } from './modules/sessionTracker/sessionTracker.module.ts'
import { ProfileTrackerModule } from './modules/profileTracker/profileTracker.module.ts'
import { PageTrackerModule } from './modules/pagesTracker/pagesTracker.module.ts';
import { SessionEventModel } from './models/session.model.ts';
import { SessionEventDataComponent } from '../component/sessionEventData.component.ts';
import { dispatchIntemptEvent, getLocationInfo } from '../../../shared/shared.utils.ts';
import { UserAttributeComponent } from '../component/userAttribute.component.ts';
import { PageEventModel } from './models/pageEvent.model.ts';
import { PageEventDataComponent } from '../component/pageEventData.component.ts';
import { HtmlEventModel } from './models/HtmlEvent.model.ts';
import { HtmlTrackerModule } from './modules/htmlTracker/htmlTracker.module.ts';


export class AutoTrackerModule {
  private readonly _sessionTrackerModule = new SessionTrackerModule();
  private readonly _profileTrackerModule = new ProfileTrackerModule();
  private readonly _pagesTrackerModule = new PageTrackerModule();
  private readonly _htmlTrackerModule = new HtmlTrackerModule();

  constructor() {
   // this._trackSessionActivity();

    this._trackSession();

    this._trackViewPage();

    this._trackLeavePage();

    this._trackHtml();
  }

  init() {
    this._profileTrackerModule.init();
    this._sessionTrackerModule.init();
    this._pagesTrackerModule.init();
    this._htmlTrackerModule.init();

    this._eventPool();
  }

  // private _trackSessionActivity(){
  //   this._sessionTrackerModule.sessionActivityHandler();
  // }

  private _trackHtml(){
    document.addEventListener('intempt:html', (event) => {
      const { detail } = event as CustomEvent;
      const { eventName, target } = detail;
      console.log('track');
      console.log(detail);



      const intemptEvent = new HtmlEventModel({
        name: eventName,
        sessionId: this.getSessionId(),
        profileId: this.getProfileId(),
        pageId: this._getPageId(),
        data:  new HtmlElementData(target)
      })

      dispatchIntemptEvent('intempt:event', { event: intemptEvent});
    })
  }

  private _trackViewPage() {
    document.addEventListener('page:view', (event) => {
      const {detail} = event as CustomEvent;

      const { eventName, fullUrl, title, windowWidth, pageId, previousPage} = detail;

      const eventData = new PageEventDataComponent({
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
      });


      dispatchIntemptEvent('intempt:event', { event: pageEvent});

    });
  }

  private _trackLeavePage() {
    document.addEventListener('page:leave', (event) => {
      const {detail} = event as CustomEvent;
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

    });
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



  private _eventPool() {
    const eventPool:any = [];


    document.addEventListener('intempt:event', (event) => {
      const { detail } = event as CustomEvent;

      if(detail.event instanceof HtmlEventModel){
        console.log('html')
      }
      else{
        console.log('other')
      }

      console.log('Event Pool', detail.event);


      // eventPool.push(event);
      // fetch('http://localhost:3000/api/messages/test', {
      //   method: 'POST',
      //   headers: {
      //     'Content-Type': 'application/json',
      //   },
      //   body: JSON.stringify(detail),
      // }).then()
    });
  }

  private _getPageId() {
    return this._pagesTrackerModule.getId();
  }


  getSessionId() {
    return this._sessionTrackerModule.getId();
  }

  getProfileId() {
    return this._pagesTrackerModule.getId();
  }



}
