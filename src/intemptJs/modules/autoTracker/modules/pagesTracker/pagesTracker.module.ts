import { dispatchIntemptEvent, generateId } from '../../../../../shared/shared.utils.ts';
import { getCookie, setCookie } from '../../../../../shared/storageHandler.ts';


type PageSessionCookie = { page_session: string } | null;
type ParsedPageSessionCookie = { id: string, current_page: string, previous_page: string };

export class PageTrackerModule {
  private readonly key = 'page_session';
  constructor() {}

  init() {

    window.addEventListener('load', () => this.start());

    window.addEventListener('popstate', () => this.start());

    window.addEventListener('beforeunload', () => this.end());
  }


  start(){
    this.setPageSession();
    const currentEventName = 'View Page';
    const previousPage = this.getPreviousPage();

    dispatchIntemptEvent('page:view', {
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

    dispatchIntemptEvent('page:leave', {
      eventName: currentEventName,
      fullUrl: window.location.href,
      title: document.title,
      windowWidth: window.innerWidth,
      pageId: this.getId(),
      duration: new Date().getTime() - startTime,
      previousPage
    });
  }


  getId(){
    const cookie = getCookie(this.key) as PageSessionCookie;
    return !!cookie ? JSON.parse(cookie[this.key]).id : '';
  }


  private setPageSession(){
    const cookie = getCookie(this.key) as PageSessionCookie;
    const currentPage = window.location.href;

    if(!cookie){
      return setCookie({
        name: this.key,
        value: JSON.stringify({
          id: generateId(),
          startTime: new Date().getTime(),
          current_page: currentPage,
          previous_page: '',
        }),
        path: '/',
      });
    }
    console.log(cookie[this.key]);
    try{
      const { id, current_page,  previous_page} = JSON.parse(cookie[this.key]) as ParsedPageSessionCookie;


      if(current_page === currentPage){
        return { [this.key]: id };
      }

      return setCookie({
        name: this.key,
        value: JSON.stringify({
          id: generateId(),
          previous_page: current_page,
          current_page: currentPage,
          startTime: new Date().getTime(),
        }),
        path: '/',

      });
    }
    catch(e:any){
      console.log(e)
    }

  }

  private getPageSessionStartTime(){
    const cookie = getCookie(this.key) as PageSessionCookie;
    return !!cookie
      ? JSON.parse(cookie[this.key]).startTime
      : new Date().getTime();
  }

  private getPreviousPage(){
    const cookie = getCookie(this.key) as PageSessionCookie;
    return !!cookie
      ? JSON.parse(cookie[this.key]).previous_page
      : '';
  }

}
