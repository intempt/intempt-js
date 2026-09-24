import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoTrackerModule } from '../../src/intemptJs/modules/autoTracker/autoTracker.module.ts';
import {
  IntemptEventListenerName,
  IntemptEventName,
} from '../../src/intemptJs/types/constants.types.ts';

/**
 * INT-3796 — `_onHtmlEvent` validated one set of ids and shipped another.
 *
 * The handler reads the three ids, refuses to emit if any is missing, and then
 * builds the event. It used to build it by calling the getters AGAIN:
 *
 *     const profileId = this.getProfileId();   // validated
 *     ...
 *     new HtmlEventModel({ sessionId: this.getSessionId(), ... })   // re-read
 *
 * Those getters are not pure. `getSessionId` reads the session cookie, which the
 * session tracker rewrites on every tracked event — including the one being
 * handled right now — and `getPageId` reads the page tracker, which a SPA route
 * change moves. So the validation guaranteed nothing about the values that
 * actually went on the wire: the event could carry a session id minted a
 * microtask ago, or an empty string the guard had just rejected. The handler now
 * uses the locals it checked.
 *
 * The getters here return a different value on each call, which is the cheapest
 * faithful model of "the cookie was rewritten mid-handler" — if the event carries
 * the second value, the code re-read it.
 *
 * `_onTrackData` is stubbed so the event stops at this module's own listener
 * instead of reaching the batcher and the network; the assertion is on the
 * `intempt:event` CustomEvent the handler dispatches, which is what the
 * transport would have received.
 */

type Private = {
  _onTrackData: (event: unknown) => void;
  _getPageId: () => string;
};

let tracker: AutoTrackerModule;

/** The payload of every `intempt:event` dispatched during `run`. */
async function captureEvent(run: () => void) {
  const seen: any[] = [];
  const listener = (event: Event) =>
    seen.push((event as CustomEvent).detail.event);

  document.addEventListener(IntemptEventListenerName.EVENT, listener);
  try {
    run();
  } finally {
    document.removeEventListener(IntemptEventListenerName.EVENT, listener);
  }
  return seen;
}

beforeEach(() => {
  tracker = new AutoTrackerModule({} as any, 'https://api.example.com');
  // Autocapture is off until started — this file tests the html-event gate
  // itself, so it has to turn that gate on first.
  tracker.startAutocapture();
  // Keep the event inside this test: no batcher, no queue, no fetch.
  vi.spyOn(tracker as unknown as Private, '_onTrackData').mockImplementation(
    () => {},
  );
  vi.spyOn(tracker, 'isUserOptIn').mockReturnValue(true);
});

afterEach(() => {
  tracker.dispose();
  document.body.innerHTML = '';
});

describe('autoTracker html event ids (INT-3796)', () => {
  it('emits the ids it validated, not whatever the getters say afterwards', async () => {
    // Each getter moves on after its first call — the cookie/page rewrite.
    vi.spyOn(tracker, 'getSessionId')
      .mockReturnValueOnce('ses-validated')
      .mockReturnValue('ses-rotated');
    vi.spyOn(tracker, 'getProfileId')
      .mockReturnValueOnce('prof-validated')
      .mockReturnValue('prof-rotated');
    vi.spyOn(tracker, 'getPageId')
      .mockReturnValueOnce('page-validated')
      .mockReturnValue('page-rotated');
    // The old code took `pageId` from the private twin of `getPageId`, which was
    // never the value the guard above checked.
    const privatePageId = vi
      .spyOn(tracker as unknown as Private, '_getPageId')
      .mockReturnValue('page-from-the-private-getter');

    const target = document.createElement('button');
    document.body.appendChild(target);

    const seen = await captureEvent(() => {
      document.dispatchEvent(
        new CustomEvent(IntemptEventListenerName.HTML, {
          detail: {
            eventName: IntemptEventName.CLICK_ON,
            domEventName: 'click',
            target,
          },
        }),
      );
    });

    expect(seen).toHaveLength(1);
    const payload = seen[0].payload[0];

    // THE MUTANT: any of these three restored to a second getter call ships the
    // "rotated" value — an event whose ids were never the ones checked.
    expect(payload.sessionId).toBe('ses-validated');
    expect(payload.profileId).toBe('prof-validated');
    expect(payload.pageId).toBe('page-validated');
    expect(privatePageId).not.toHaveBeenCalled();
  });

  it('reads each getter exactly once per handled event', async () => {
    // The direct statement of the same rule, and it also keeps the handler from
    // quietly becoming three cookie reads per click again.
    const session = vi.spyOn(tracker, 'getSessionId').mockReturnValue('ses-1');
    const profile = vi.spyOn(tracker, 'getProfileId').mockReturnValue('prof-1');
    const page = vi.spyOn(tracker, 'getPageId').mockReturnValue('page-1');

    const target = document.createElement('a');
    document.body.appendChild(target);

    await captureEvent(() => {
      document.dispatchEvent(
        new CustomEvent(IntemptEventListenerName.HTML, {
          detail: {
            eventName: IntemptEventName.CLICK_ON,
            domEventName: 'click',
            target,
          },
        }),
      );
    });

    expect(session).toHaveBeenCalledTimes(1);
    expect(profile).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('emits nothing at all when one of the ids is missing', async () => {
    // The guard the fix depends on: an event with a blank id is dropped, not
    // sent with a blank field.
    vi.spyOn(tracker, 'getSessionId').mockReturnValue('ses-1');
    vi.spyOn(tracker, 'getProfileId').mockReturnValue('');
    vi.spyOn(tracker, 'getPageId').mockReturnValue('page-1');

    const target = document.createElement('button');
    document.body.appendChild(target);

    const seen = await captureEvent(() => {
      document.dispatchEvent(
        new CustomEvent(IntemptEventListenerName.HTML, {
          detail: {
            eventName: IntemptEventName.CLICK_ON,
            domEventName: 'click',
            target,
          },
        }),
      );
    });

    expect(seen).toHaveLength(0);
  });
});
