import { describe, it, expect } from 'vitest';
import { PageTrackerModule } from '../../src/intemptJs/modules/autoTracker/modules/pagesTracker/pagesTracker.module.ts';

/**
 * Companion to D-10's regression test: a *genuine* URL change via
 * `replaceState` (rather than a no-op replace) must still emit a matched
 * Leave/View pair — the D-10 fix must not swallow real navigations along
 * with the orphan-exit case.
 */

type PageEventDetail = { eventName: string; fullUrl: string };

describe('PageTrackerModule — D-10 companion: replaceState to a changed URL', () => {
  it('still emits a matched Leave/View pair when replaceState changes the URL', () => {
    window.history.replaceState({}, '', 'http://localhost:3000/start');

    const events: PageEventDetail[] = [];
    document.addEventListener('intempt:page', (e: Event) => {
      events.push((e as CustomEvent<PageEventDetail>).detail);
    });

    const tracker = new PageTrackerModule();
    tracker.init();
    events.length = 0;

    window.history.replaceState({}, '', 'http://localhost:3000/replaced');

    expect(events.map((e) => e.eventName)).toEqual(['Leave Page', 'View Page']);
  });
});
