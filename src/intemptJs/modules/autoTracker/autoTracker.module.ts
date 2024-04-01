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
    this.trackSession();

    this.trackViewPage();

    this.trackLeavePage();

    this.trackHtml();
  }

  public init() {
    this._profileTrackerModule.init();
    this._sessionTrackerModule.init();
    this._pagesTrackerModule.init();
    this._htmlTrackerModule.init();

    this._trackEventPool();
  }

  private trackHtml(){
    document.addEventListener('intempt:html', (event) => {
      const { detail } = event as CustomEvent;
      const { eventName, target } = detail;

      const intemptEvent = new HtmlEventModel({
        name: eventName,
        sessionId: this._getSessionId(),
        profileId: this._getProfileId(),
        pageId: this._getPageId(),
        data:  new HtmlElementData(target)
      })

      dispatchIntemptEvent('intempt:event', { event: intemptEvent});
    })
  }

  private trackSession(){
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
        sessionId : this._getSessionId(),
        profileId: this._getProfileId(),
        data: eventData,
        userAttributes: attributes
      })


      dispatchIntemptEvent('intempt:event', { event: sessionEvent});
    })
  }


  private trackViewPage() {
    document.addEventListener('page:view', (event) => {
      const {detail} = event as CustomEvent;
      const { name, fullUrl, title, windowWidth, pageId, previousPage} = detail;
      const eventData = new PageEventDataComponent({
        title,
        fullUrl,
        windowWidth,
        previousPage
      })

      const pageEvent = new PageEventModel({
        name,
        sessionId: this._getSessionId(),
        profileId: this._getProfileId(),
        pageId,
        data: eventData
      });


      dispatchIntemptEvent('intempt:event', { event: pageEvent});

    });
  }

  private trackLeavePage() {
    document.addEventListener('page:leave', (event) => {
      const {detail} = event as CustomEvent;

      const { name, fullUrl, title, windowWidth, pageId, duration, previousPage } = detail;

      const eventData = new PageEventDataComponent({
        duration,
        title,
        fullUrl,
        windowWidth,
        previousPage
      })
      const pageEvent = new PageEventModel({
        name,
        sessionId: this._getSessionId(),
        profileId: this._getProfileId(),
        pageId,
        data: eventData
      })


      dispatchIntemptEvent('intempt:event', { event: pageEvent});

    });
  }

  private _trackEventPool() {
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

  _getSessionId() {
    return this._sessionTrackerModule.getId();
  }

  _getProfileId() {
    return this._pagesTrackerModule.getId();
  }

  private _getPageId() {
    return this._pagesTrackerModule.getId();
  }

}
