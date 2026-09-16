import { afterEach, describe, expect, it } from 'vitest';
import { SessionTrackerModule } from '../../src/intemptJs/modules/autoTracker/modules/sessionTracker/sessionTracker.module.ts';
import { IntemptEventName } from '../../src/intemptJs/types/constants.types.ts';

/**
 * INT-3757 — `IntemptEventName.SESSION_START` disagreed with the wire.
 *
 * Two places name this event and only one of them reaches the backend:
 * `SessionTrackerModule._eventName`, the string actually dispatched, has always
 * been `'Session start'`, while the enum read `'Session Start'`. The enum is what
 * anything typing or filtering the event compares against — and the collection
 * title in single-metadata is `Session start` too — so the capital S made every
 * such comparison silently false. The enum now matches.
 *
 * A test that only asserted the enum's literal would pass with either spelling on
 * whichever side was edited last, which is the failure mode that produced the bug.
 * So this drives the tracker until it emits and compares the two, which is the
 * only assertion that cannot drift.
 */

afterEach(() => {
  document.body.innerHTML = '';
});

describe('session start event name (INT-3757)', () => {
  it('dispatches exactly the name the enum declares', async () => {
    const emitted = new Promise<string>((resolve) => {
      document.addEventListener(
        'intempt:session',
        (event) => resolve((event as CustomEvent).detail.eventName),
        { once: true },
      );
    });

    // Subscribes to the tracked-event names in its constructor. The shared setup
    // clears cookies before every test, so there is no session cookie and the
    // first tracked event opens a new session.
    new SessionTrackerModule();

    document.dispatchEvent(
      new CustomEvent('intempt:html', {
        detail: { eventName: IntemptEventName.CLICK_ON },
      }),
    );

    // THE MUTANT: either side capitalised differently and these stop matching.
    await expect(emitted).resolves.toBe(IntemptEventName.SESSION_START);
    // Pinned literally as well, because both sides moving together would still
    // break the single-metadata collection title this has to equal.
    await expect(emitted).resolves.toBe('Session start');
  });
});
