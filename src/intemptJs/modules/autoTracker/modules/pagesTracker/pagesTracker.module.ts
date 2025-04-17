import { dispatchIntemptEvent, generateId } from '../../../../../shared/shared.utils.ts';
import {
  getCookie,
  localIntemptPageSessionCookie,
  setCookie,
} from '../../../../../shared/storageHandler.ts';


type PageSessionCookie = { page_session: string } | null;
type ParsedPageSessionCookie = { id: string, current_page: string, previous_page: string };

export class PageTrackerModule {
  private readonly idType = 'pag';
  private readonly keys = ['page_session'];

  private readonly pageSession = 'page_session';

  constructor() {}


  init() {
    window.addEventListener('load', () => this.start());

    window.addEventListener('popstate', () => {
      this.end()
      this.start()
    });

    window.addEventListener('beforeunload', () => this.end());
  }


  start(){
    this.setPageSession();
    const currentEventName = 'View Page';
    const previousPage = this.getPreviousPage();

    dispatchIntemptEvent('intempt:page', {
      eventName: currentEventName,
      fullUrl: window.location.href,
      title: document.title,
      windowWidth: window.innerWidth,
      pageId: this.getId(),
      previousPage
    });
  }

  end(){
    const currentEventName = 'Leave Page';
    const startTime = this.getPageSessionStartTime();
    const previousPage = this.getPreviousPage();

    dispatchIntemptEvent('intempt:page', {
      eventName: currentEventName,
      fullUrl: window.location.href,
      title: document.title,
      windowWidth: window.innerWidth,
      pageId: this.getId(),
      duration: new Date().getTime() - startTime,
      previousPage
    });
  }

  getId(): string {
    let pageSessionId: string | undefined;
    const cookie = getCookie(this.pageSession) as PageSessionCookie;

    if (cookie) {
      try {
        pageSessionId = JSON.parse(cookie[this.pageSession]).id;
      } catch (error) {
        console.error('Error parsing cookie:', error);
      }
    }
    else {
      const local = localIntemptPageSessionCookie();
      if (local) {
        pageSessionId = local.id;
      } else {
        this.setPageSession();
        return this.getId();

      }
    }

    return pageSessionId ?? '';
  }

  get cookieKeys(){
    return this.keys;
  }


  private setPageSession(){
    const cookie = getCookie(this.pageSession) as PageSessionCookie;
    const newPage = window.location.href;

    if(!cookie){
      return setCookie({
        name: this.pageSession,
        value: JSON.stringify({
          id: generateId(this.idType),
          startTime: new Date().getTime(),
          current_page: newPage,
          previous_page: '',
        }),
        path: '/',
      });
    }

    try{
      const { id, current_page,  previous_page} = JSON.parse(cookie[this.pageSession]) as ParsedPageSessionCookie;

      return setCookie({
        name: this.pageSession,
        value: JSON.stringify({
          id: generateId(this.idType),
          previous_page: current_page,
          current_page: newPage,
          startTime: new Date().getTime(),
        }),
        path: '/',
      });
    }
    catch(e:any){
      console.log(e)
      return null
    }

  }

  private getPageSessionStartTime(){
    const cookie = getCookie(this.pageSession) as PageSessionCookie;
    return !!cookie
      ? JSON.parse(cookie[this.pageSession]).startTime
      : new Date().getTime();
  }

  private getPreviousPage(){
    const cookie = getCookie(this.pageSession) as PageSessionCookie;
    return !!cookie
      ? JSON.parse(cookie[this.pageSession]).previous_page
      : '';
  }

}
