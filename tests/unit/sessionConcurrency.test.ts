import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionTrackerModule } from '../../src/intemptJs/modules/autoTracker/modules/sessionTracker/sessionTracker.module.ts';

/**
 * INT-3777 — two events arriving together with no session cookie must open ONE
 * session. `_onNewSession` awaits `_getPlatform()` after writing the cookie, and
 * nothing marked "a session is being created", so whenever the cookie is not
 * readable back (blocked / rejected by the browser) every concurrent event opened
 * its own session and dispatched its own `intempt:session`.
 */
function clearCookies() {
  document.cookie.split(';').forEach((c) => {
    const name = c.split('=')[0].trim();
    if (name)
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 20));
};

let started: CustomEvent[];
const onSession = (e: Event) => started.push(e as CustomEvent);

beforeEach(() => {
  clearCookies();
  started = [];
  document.addEventListener('intempt:session', onSession);
});

afterEach(() => {
  document.removeEventListener('intempt:session', onSession);
  vi.restoreAllMocks();
  clearCookies();
});

describe('concurrent session creation (INT-3777)', () => {
  it('opens one session for two simultaneous events (cookie readable)', async () => {
    const tracker = new SessionTrackerModule();
    tracker.touch('Page view');
    tracker.touch('Click');
    await flush();
    expect(started).toHaveLength(1);
  });

  it('opens one session for two simultaneous events when the cookie jar rejects writes', async () => {
    // Browser refuses the cookie: document.cookie reads back empty every time.
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: () => {},
    });
    try {
      const tracker = new SessionTrackerModule();
      tracker.touch('Page view');
      tracker.touch('Click');
      await flush();
      expect(started).toHaveLength(1);
    } finally {
      // Drop the own-property override so the jsdom accessor shows through again.
      delete (document as unknown as { cookie?: string }).cookie;
    }
  });

  it('keeps the session id available synchronously after touch (INT-5992)', async () => {
    const tracker = new SessionTrackerModule();
    tracker.touch('Page view');
    const first = tracker.getId();
    tracker.touch('Click');
    expect(first).not.toBe('');
    expect(tracker.getId()).toBe(first);
    await flush();
  });

  it('opens a new session after the previous creation finished and the cookie is gone', async () => {
    const tracker = new SessionTrackerModule();
    tracker.touch('Page view');
    await flush();
    clearCookies();
    tracker.touch('Page view');
    await flush();
    expect(started).toHaveLength(2);
  });
});
