import { dispatchIntemptEvent, generateId } from '../../../../../shared/shared.utils.ts';
import {
  getCookie,
  localIntemptPageSessionCookie,
  setCookie,
} from '../../../../../shared/storageHandler.ts';


import { createLogger } from '../../../../../shared/logger/logger.ts';

const log = createLogger('PagesTracker');

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


  refresh(){
    this.setPageSession();
  }

  private readonly safeStart = () => { try { this.start(); } catch (e) { log.error('failed to start page tracking', e); } };

  // 'locationchange' is the single funnel every navigation source (popstate,
  // pushState, replaceState — see _patchHistoryForSpa) routes through. `end()`
  // used to fire unconditionally here, unlike start()'s existing dedupe on
  // `_lastStartUrl` — so a `replaceState` call to the *same* URL (Next.js /
  // `router.replace`-style query-param syncs) emitted an orphan `Leave Page`
  // with no matching `View Page` (D-10). Comparing against `_lastStartUrl`
  // before firing end()/safeStart() makes "no URL change" a no-op here too.
  private readonly _handleNavigation = () => {
    if (window.location.href === this._lastStartUrl) return;
    this.end();
    this.safeStart();
  };

  init() {
    if (document.readyState === 'complete') {
      // loaded late -> fire now
      this.safeStart();
    } else {
      window.addEventListener('load', this.safeStart, { once: true });
    }

    // bfcache restores
    window.addEventListener('pageshow', (e: PageTransitionEvent) => {
      if (e.persisted) this.safeStart();
    });

    window.addEventListener('beforeunload', () => this.end());

    // SPA navigations. `_patchHistoryForSpa()` already registers its own
    // `popstate` listener that fires 'locationchange' (handled below), so a
    // direct `popstate` listener here that also called end()/safeStart()
    // would double-fire on every back/forward navigation (D-9): every
    // popstate would run both handlers, emitting two `Leave Page` events and
    // one `View Page`. `locationchange` is now the single funnel for all
    // navigation sources.
    this._patchHistoryForSpa();
    window.addEventListener('locationchange', this._handleNavigation);
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
    // Hash-only routers change the URL without ever touching the History API
    // and never fire 'popstate', so without this listener a hash-routed SPA
    // (a large share of real sites) recorded no navigation at all (D-11).
    window.addEventListener('hashchange', fire);
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
        // Success - return the ID
        if (pageSessionId) {
          return pageSessionId;
        }
      } catch (error) {
        log.error('error parsing cookie', error);
        // Error parsing cookie - skip local storage, go directly to Step 3
        const newCookie = this.setPageSession() as PageSessionCookie;
        if (newCookie) {
          try {
            pageSessionId = JSON.parse(newCookie[this.pageSession]).id;
          } catch (error) {
            log.error('error parsing newly set cookie', error);
          }
        }
        return pageSessionId ?? '';
      }
    }
    
    // Cookie doesn't exist (not an error) - try local storage first
    const local = localIntemptPageSessionCookie();
    if (local?.id) {
      return local.id;
    }
    
    // No cookie and no local storage - create new session
    const newCookie = this.setPageSession() as PageSessionCookie;
    if (newCookie) {
      try {
        pageSessionId = JSON.parse(newCookie[this.pageSession]).id;
      } catch (error) {
        log.error('error parsing newly set cookie', error);
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
      log.error('failed to set page session cookie', e)
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
