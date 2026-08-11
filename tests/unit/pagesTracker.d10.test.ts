import { describe, it, expect } from 'vitest';
import { PageTrackerModule } from '../../src/intemptJs/modules/autoTracker/modules/pagesTracker/pagesTracker.module.ts';

/**
 * D-10 (docs/sdk-hardening/DEFECTS.md): `start()` dedupes on an unchanged
 * href, but `end()` did not, so a `replaceState` call that leaves the URL
 * unchanged (Next.js/`router.replace`-style query-param syncs) emitted an
 * orphan `Leave Page` with no matching `View Page`, inflating exit counts and
 * corrupting time-on-page. A genuine URL change via `replaceState` must still
 * emit a matched Leave/View pair.
 */

type PageEventDetail = { eventName: string; fullUrl: string };

describe('PageTrackerModule — D-10: replaceState to an unchanged URL', () => {
  it('emits no orphan Leave Page when the URL does not actually change', () => {
    window.history.replaceState({}, '', 'http://localhost:3000/start');

    const events: PageEventDetail[] = [];
    document.addEventListener('intempt:page', (e: Event) => {
      events.push((e as CustomEvent<PageEventDetail>).detail);
    });

    const tracker = new PageTrackerModule();
    tracker.init();
    const unchangedUrl = window.location.href;
    events.length = 0; // drop the initial View Page from init()

    window.history.replaceState({}, '', unchangedUrl);

    expect(events).toHaveLength(0);
  });
});
