import { describe, it, expect } from 'vitest';
import { PageTrackerModule } from '../../src/intemptJs/modules/autoTracker/modules/pagesTracker/pagesTracker.module.ts';

/**
 * D-11 (docs/sdk-hardening/DEFECTS.md): there was no `hashchange` listener at
 * all, so hash-only routers (a large share of real SPA sites) recorded no
 * navigation whatsoever — no Leave Page, no View Page.
 */

type PageEventDetail = { eventName: string; fullUrl: string };

describe('PageTrackerModule — D-11: missing hashchange listener', () => {
  it('a hash-only navigation emits a matched Leave/View pair for the new URL', () => {
    window.history.replaceState({}, '', 'http://localhost:3000/start');

    const events: PageEventDetail[] = [];
    document.addEventListener('intempt:page', (e: Event) => {
      events.push((e as CustomEvent<PageEventDetail>).detail);
    });

    const tracker = new PageTrackerModule();
    tracker.init();
    events.length = 0; // drop the initial View Page from init()

    window.location.hash = '#section-2';
    window.dispatchEvent(new Event('hashchange'));

    expect(events.map((e) => e.eventName)).toEqual(['Leave Page', 'View Page']);
    expect(events[1]?.fullUrl).toContain('#section-2');
  });
});
