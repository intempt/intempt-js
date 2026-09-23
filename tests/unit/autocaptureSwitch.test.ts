import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoTrackerModule } from '../../src/intemptJs/modules/autoTracker/autoTracker.module.ts';
import {
  IntemptEventListenerName,
  IntemptEventName,
} from '../../src/intemptJs/types/constants.types.ts';

type Private = { _onTrackData: (event: unknown) => void };

let tracker: AutoTrackerModule | undefined;

function build(config: Record<string, unknown>): {
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
  it('captures a click when autocapture is not configured', () => {
    build({});
    expect(capturedNames(click)).toHaveLength(1);
  });

  it('captures a page view when autocapture is not configured', () => {
    build({});
    expect(capturedNames(pageView)).toHaveLength(1);
  });

  it('captures no click when autocapture is false', () => {
    build({ autocapture: false });
    expect(capturedNames(click)).toHaveLength(0);
  });

  it('captures no page view when autocapture is false', () => {
    build({ autocapture: false });
    expect(capturedNames(pageView)).toHaveLength(0);
  });

  it('still captures a click when autocapture is explicitly true', () => {
    build({ autocapture: true });
    expect(capturedNames(click)).toHaveLength(1);
  });

  it('still delivers an explicit track event when autocapture is false', () => {
    const { delivered } = build({ autocapture: false });
    document.dispatchEvent(
      new CustomEvent(IntemptEventListenerName.EVENT, {
        detail: { event: { type: 'custom', payload: [] } },
      }),
    );
    expect(delivered).toHaveBeenCalledTimes(1);
  });

  it('keeps the session running when autocapture is false', () => {
    build({ autocapture: false });
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
