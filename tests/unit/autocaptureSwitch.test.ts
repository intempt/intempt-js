import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoTrackerModule } from '../../src/intemptJs/modules/autoTracker/autoTracker.module.ts';
import {
  IntemptEventListenerName,
  IntemptEventName,
} from '../../src/intemptJs/types/constants.types.ts';

type Private = { _onTrackData: (event: unknown) => void };

let tracker: AutoTrackerModule | undefined;

function build(config: Record<string, unknown> = {}): {
  tracker: AutoTrackerModule;
  delivered: ReturnType<typeof vi.fn>;
} {
  const created = new AutoTrackerModule(
    config as any,
    'https://api.example.com',
  );
  const delivered = vi.fn();
  vi.spyOn(created as unknown as Private, '_onTrackData').mockImplementation(
    delivered,
  );
  vi.spyOn(created, 'isUserOptIn').mockReturnValue(true);
  vi.spyOn(created, 'getProfileId').mockReturnValue('prof-1');
  vi.spyOn(created, 'getSessionId').mockReturnValue('ses-1');
  vi.spyOn(created, 'getPageId').mockReturnValue('page-1');
  tracker = created;
  return { tracker: created, delivered };
}

function click(): void {
  const target = document.createElement('button');
  document.body.appendChild(target);
  document.dispatchEvent(
    new CustomEvent(IntemptEventListenerName.HTML, {
      detail: {
        eventName: IntemptEventName.CLICK_ON,
        domEventName: 'click',
        target,
      },
    }),
  );
}

function pageView(): void {
  document.dispatchEvent(
    new CustomEvent(IntemptEventListenerName.PAGE, {
      detail: {
        eventName: 'view page',
        fullUrl: 'https://example.com/',
        title: 'Home',
        windowWidth: 1024,
        pageId: 'page-1',
        duration: 0,
        previousPage: '',
      },
    }),
  );
}

function capturedNames(run: () => void): string[] {
  const names: string[] = [];
  const listener = (event: Event) => {
    const payload = (event as CustomEvent).detail.event?.payload?.[0];
    names.push(payload?.eventTitle ?? payload?.name ?? 'unknown');
  };
  document.addEventListener(IntemptEventListenerName.EVENT, listener);
  try {
    run();
  } finally {
    document.removeEventListener(IntemptEventListenerName.EVENT, listener);
  }
  return names;
}

afterEach(() => {
  tracker?.dispose();
  tracker = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('web autocapture switch', () => {
  it('captures no click before autoCapture.init() is called', () => {
    build();
    expect(capturedNames(click)).toHaveLength(0);
  });

  it('captures no page view before autoCapture.init() is called', () => {
    build();
    expect(capturedNames(pageView)).toHaveLength(0);
  });

  it('captures a click once autoCapture.init() runs with no arguments', () => {
    const { tracker: created } = build();
    created.startAutocapture();
    expect(capturedNames(click)).toHaveLength(1);
  });

  it('captures a page view once autoCapture.init() runs with no arguments', () => {
    const { tracker: created } = build();
    created.startAutocapture();
    expect(capturedNames(pageView)).toHaveLength(1);
  });

  it('still delivers an explicit track event when autoCapture.init() was never called', () => {
    const { delivered } = build();
    document.dispatchEvent(
      new CustomEvent(IntemptEventListenerName.EVENT, {
        detail: { event: { type: 'custom', payload: [] } },
      }),
    );
    expect(delivered).toHaveBeenCalledTimes(1);
  });

  function html(eventName: string, domEventName: string): () => void {
    return () => {
      const target = document.createElement('input');
      document.body.appendChild(target);
      document.dispatchEvent(
        new CustomEvent(IntemptEventListenerName.HTML, {
          detail: { eventName, domEventName, target },
        }),
      );
    };
  }

  it.each([
    ['pageview', 1, 0, 0, 0],
    ['click', 0, 1, 0, 0],
    ['input', 0, 0, 1, 0],
    ['submit', 0, 0, 0, 1],
  ])(
    'autoCapture.init([%s]) captures exactly that family',
    (family, pages, clicks, inputs, submits) => {
      const { tracker: created } = build();
      created.startAutocapture([family as never]);
      expect(capturedNames(pageView)).toHaveLength(pages);
      expect(capturedNames(click)).toHaveLength(clicks);
      expect(
        capturedNames(html(IntemptEventName.CHANGE_ON, 'change')),
      ).toHaveLength(inputs);
      expect(
        capturedNames(html(IntemptEventName.SUBMIT_ON, 'submit')),
      ).toHaveLength(submits);
    },
  );

  it('captures nothing autocaptured when autoCapture.init([]) names no family', () => {
    const { tracker: created } = build();
    created.startAutocapture([]);
    expect(capturedNames(pageView)).toHaveLength(0);
    expect(capturedNames(click)).toHaveLength(0);
  });

  it('still runs Shopify detection when pageview is off', () => {
    const { tracker: created } = build({ shopify: true });
    created.startAutocapture(['click']);
    const shopify = vi.fn();
    (
      created as unknown as { _shopifyTrackerModule: { track: () => void } }
    )._shopifyTrackerModule.track = shopify;
    pageView();
    expect(shopify).toHaveBeenCalledTimes(1);
  });

  it('keeps the session running before autoCapture.init() is ever called', () => {
    build();
    const names = capturedNames(() =>
      document.dispatchEvent(
        new CustomEvent(IntemptEventListenerName.SESSION, {
          detail: {
            eventName: 'session start',
            userAttributes: {},
            eventAttributes: {},
          },
        }),
      ),
    );
    expect(names).toHaveLength(1);
  });
});
