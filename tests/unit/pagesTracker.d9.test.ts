import { describe, it, expect } from 'vitest';
import { PageTrackerModule } from '../../src/intemptJs/modules/autoTracker/modules/pagesTracker/pagesTracker.module.ts';

/**
 * D-9 (docs/sdk-hardening/DEFECTS.md): `init()` used to register a direct
 * `popstate` listener that called `end(); safeStart();`, *and*
 * `_patchHistoryForSpa()` registered a second `popstate` listener that fired
 * `locationchange`, which was handled by its own `end(); safeStart();`. A
 * single back/forward navigation therefore emitted two `Leave Page` events
 * and one `View Page`. One file per defect (rather than one shared file) so
 * each gets vitest's fresh-jsdom-per-file isolation — `history.pushState`/
 * `replaceState` get monkey-patched by `init()`, and patches would otherwise
 * stack across tests in the same file.
 */

type PageEventDetail = { eventName: string; fullUrl: string };

describe('PageTrackerModule — D-9: popstate double-fire', () => {
  it('a real back/forward navigation emits exactly one Leave Page and one View Page', () => {
    window.history.replaceState({}, '', 'http://localhost:3000/start');

    // Capture the native pushState before init() patches it, so this call can
    // change the URL the way a browser back/forward navigation does —
    // silently, without going through the patched history methods — and the
    // popstate dispatched below is the *only* signal the tracker gets, just
    // like a real back-button press (the browser has already updated
    // location before firing popstate).
    const nativePushState = window.history.pushState.bind(window.history);

    const events: PageEventDetail[] = [];
    document.addEventListener('intempt:page', (e: Event) => {
      events.push((e as CustomEvent<PageEventDetail>).detail);
    });

    const tracker = new PageTrackerModule();
    tracker.init();
    events.length = 0; // drop the initial View Page from init()

    nativePushState({}, '', 'http://localhost:3000/other');
    window.dispatchEvent(new PopStateEvent('popstate'));

    const names = events.map((e) => e.eventName);
    expect(names.filter((n) => n === 'Leave Page')).toHaveLength(1);
    expect(names.filter((n) => n === 'View Page')).toHaveLength(1);
  });
});
