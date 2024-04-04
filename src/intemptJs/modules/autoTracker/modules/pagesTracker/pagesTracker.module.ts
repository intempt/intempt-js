import { dispatchIntemptEvent, generateId } from '../../../../../shared/shared.utils.ts';
import { getCookie, setCookie } from '../../../../../shared/storageHandler.ts';


type PageSessionCookie = { page_session: string } | null;
type ParsedPageSessionCookie = { id: string, current_page: string, previous_page: string };

export class PageTrackerModule {
  private readonly idType = 'pag';
  private readonly keys = ['page_session'];

  private readonly pageSession = 'page_session';

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


  getId(){
    const cookie = getCookie(this.pageSession) as PageSessionCookie;
    return !!cookie ? JSON.parse(cookie[this.pageSession]).id : '';
  }

  get cookieKeys(){
    return this.keys;
  }


  private setPageSession(){
    const cookie = getCookie(this.pageSession) as PageSessionCookie;
    const currentPage = window.location.href;

    if(!cookie){
      return setCookie({
        name: this.pageSession,
        value: JSON.stringify({
          id: generateId(this.idType),
          startTime: new Date().getTime(),
          current_page: currentPage,
          previous_page: '',
        }),
        path: '/',
      });
    }
   // console.log(cookie[this.pageSession]);
    try{
      const { id, current_page,  previous_page} = JSON.parse(cookie[this.pageSession]) as ParsedPageSessionCookie;


      if(current_page === currentPage){
        return { [this.pageSession]: id };
      }

      return setCookie({
        name: this.pageSession,
        value: JSON.stringify({
          id: generateId(this.idType),
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
