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
  private _lastStartUrl = '';
  private _started = false;

  private readonly pageSession = 'page_session';

  constructor() {}

  private _safeParse<T>(s: string): T | null { try { return JSON.parse(s) as T; } catch { return null; } }


  init() {
    const safeStart = () => { try { this.start(); } catch (e) { console.error(e); } };

    if (document.readyState === 'complete') {
      // loaded late -> fire now
      safeStart();
    } else {
      window.addEventListener('load', safeStart, { once: true });
    }

    // bfcache restores
    window.addEventListener('pageshow', (e: PageTransitionEvent) => {
      if (e.persisted) safeStart();
    });

    // existing
    window.addEventListener('popstate', () => { this.end(); safeStart(); });
    window.addEventListener('beforeunload', () => this.end());

    // SPA navigations
    this._patchHistoryForSpa();
    window.addEventListener('locationchange', () => { this.end(); safeStart(); });
  }

  private _patchHistoryForSpa() {
    const fire = () => window.dispatchEvent(new Event('locationchange'));

    (['pushState', 'replaceState'] as const).forEach((fn) => {
      // bind to avoid using `this` inside the wrapper
      const orig = history[fn].bind(history) as (...args: any[]) => any;

      (history as any)[fn] = (...args: any[]) => {
        const ret = orig(...args);
        fire();
        return ret;
      };
    });

    window.addEventListener('popstate', fire);
  }


  start(){
    const href = window.location.href;
    if (this._started && this._lastStartUrl === href) return;
    this._started = true;
    this._lastStartUrl = href;


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
    const parsed = cookie ? this._safeParse<{ startTime?: number }>(cookie[this.pageSession]) : null;
    return parsed?.startTime ?? Date.now();
  }

  private getPreviousPage(){
    const cookie = getCookie(this.pageSession) as PageSessionCookie;
    const parsed = cookie ? this._safeParse<ParsedPageSessionCookie>(cookie[this.pageSession]) : null;
    return parsed?.previous_page ?? '';
  }

}
