import { beforeAll, describe, expect, it } from 'vitest';
import { SessionTrackerModule } from '../../src/intemptJs/modules/autoTracker/modules/sessionTracker/sessionTracker.module.ts';

/**
 * INT-3768 — the session-activity listener read `detail.eventName` and called
 * `.toLowerCase()` on it unguarded, so any `intempt:*` CustomEvent without a
 * string `detail.eventName` (page code, a replayed event, `detail: null`) threw
 * a TypeError inside the listener. A throw in a DOM listener is reported on
 * `window` as an `error` event, which is what this watches for.
 */
describe('session activity listener (INT-3768)', () => {
  const cases: Array<[string, CustomEventInit]> = [
    ['no detail', {}],
    ['null detail', { detail: null }],
    ['detail without eventName', { detail: {} }],
    ['non-string eventName', { detail: { eventName: 42 } }],
  ];

  // The module registers anonymous document listeners and has no teardown, so
  // build it once: one per `it.each` case would stack listeners across cases.
  beforeAll(() => {
    new SessionTrackerModule();
  });

  it.each(cases)('does not throw for an event with %s', (_label, init) => {
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(e.error ?? e.message);
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      document.dispatchEvent(new CustomEvent('intempt:track', init));
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toEqual([]);
  });
});
