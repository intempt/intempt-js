import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoTrackerModule } from '../../src/intemptJs/modules/autoTracker/autoTracker.module.ts';
import {
  IntemptEventListenerName,
  IntemptEventName,
} from '../../src/intemptJs/types/constants.types.ts';

/**
 * INT-6060 item 3 (SDK-38) — Shopify "Product viewed" missed the first page.
 *
 * The constructor called `_pagesTrackerModule.start()`, which dispatches the
 * first `intempt:page` synchronously. `_onPageEvent` then asks the Shopify
 * tracker to `track()`, which dispatches `intempt:shopify` synchronously too —
 * but the SHOPIFY (and HTML) listeners were only added AFTER `start()`, so that
 * first dispatch had nobody listening and the product view was lost.
 *
 * The assertion is on the `intempt:event` the Shopify handler emits during the
 * constructor itself, i.e. for the first page.
 */

type Proto = { _onTrackData: (event: unknown) => void };

let tracker: AutoTrackerModule | undefined;

afterEach(() => {
  tracker?.dispose();
  tracker = undefined;
  delete (window as any).meta;
  vi.restoreAllMocks();
});

describe('autoTracker Shopify first page load (INT-6060 item 3)', () => {
  it('the Shopify handler sees the first page event fired by start()', () => {
    (window as any).meta = {
      page: { pageType: 'product' },
      product: { id: 4242 },
    };
    const proto = AutoTrackerModule.prototype;
    vi.spyOn(proto, 'isUserOptIn').mockReturnValue(true);
    vi.spyOn(proto, 'getProfileId').mockReturnValue('prof-1');
    vi.spyOn(proto, 'getSessionId').mockReturnValue('ses-1');
    vi.spyOn(proto, 'getPageId').mockReturnValue('page-1');
    // Keep events inside the test: no batcher, no network.
    vi.spyOn(proto as unknown as Proto, '_onTrackData').mockImplementation(
      () => {},
    );

    const seen: any[] = [];
    const listener = (event: Event) =>
      seen.push((event as CustomEvent).detail.event);
    document.addEventListener(IntemptEventListenerName.EVENT, listener);
    try {
      tracker = new AutoTrackerModule(
        { shopify: true } as any,
        'https://api.example.com',
      );
    } finally {
      document.removeEventListener(IntemptEventListenerName.EVENT, listener);
    }

    const productViews = seen.filter((e) =>
      JSON.stringify(e).includes(IntemptEventName.PRODUCT_VIEW),
    );
    expect(productViews).toHaveLength(1);
    expect(JSON.stringify(productViews[0])).toContain('4242');
  });
});
