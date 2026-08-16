/**
 * @vitest-environment-options { "url": "https://shop.example.com/" }
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearStoredConsent,
  DO_NOT_TRACK_COOKIE,
  DO_NOT_TRACK_KEY,
  loadDoNotTrack,
  loadStoredConsent,
  persistDoNotTrack,
} from '../../src/shared/consentState.ts';
import { consentCookieDomain } from '../../src/shared/privacy/consentCookie.ts';

/**
 * Consent has to outlive the page that captured it — an opt-out that resets on
 * reload is a compliance defect, so these are correctness tests, not
 * nice-to-haves.
 *
 * This file runs on `https://shop.example.com` rather than jsdom's default
 * `http://localhost`, because the whole point of the cookie (D15) is the
 * *cross-subdomain* case and `localhost` is precisely the host that cannot carry
 * a domain-scoped cookie. The host-only path has its own file.
 *
 * Note the explicit `clearStoredConsent()` in `beforeEach`: the shared
 * `setup.ts` teardown expires cookies at `path=/` with **no domain**, which does
 * not match a cookie written at `domain=.example.com`. Without this, one test's
 * opt-out leaks into the next.
 */
describe('persisted opt-out state', () => {
  beforeEach(() => {
    clearStoredConsent();
  });

  it('defaults to tracking allowed when nothing is stored', () => {
    expect(loadDoNotTrack()).toBe(false);
  });

  it('survives a reload after opt-out', () => {
    persistDoNotTrack(true);
    expect(loadDoNotTrack()).toBe(true);
  });

  it('lets an explicit opt-in clear a stored opt-out', () => {
    persistDoNotTrack(true);
    persistDoNotTrack(false);
    expect(loadDoNotTrack()).toBe(false);
  });

  it('treats a corrupt stored value as tracking allowed', () => {
    localStorage.setItem(DO_NOT_TRACK_KEY, '{not json');
    expect(loadDoNotTrack()).toBe(false);
  });

  it('treats a non-boolean stored value as tracking allowed', () => {
    localStorage.setItem(DO_NOT_TRACK_KEY, '"yes"');
    expect(loadDoNotTrack()).toBe(false);
  });

  it('distinguishes "never asked" from "opted in", which a banner needs', () => {
    expect(loadStoredConsent()).toBe(null);
    persistDoNotTrack(false);
    expect(loadStoredConsent()).toBe(false);
    persistDoNotTrack(true);
    expect(loadStoredConsent()).toBe(true);
  });

  it('clears both stores, returning the visitor to "never asked"', () => {
    persistDoNotTrack(true);
    clearStoredConsent();

    expect(loadStoredConsent()).toBe(null);
    expect(document.cookie).not.toContain(DO_NOT_TRACK_COOKIE);
    expect(localStorage.getItem(DO_NOT_TRACK_KEY)).toBe(null);
  });
});

describe('cross-subdomain scope — the D15 fix', () => {
  beforeEach(() => {
    clearStoredConsent();
  });

  it('writes the cookie at the eTLD+1, not the full host', () => {
    // `shop.example.com` must not write a cookie only `shop` can read, or an
    // opt-out on the store still leaves `www` tracking.
    expect(consentCookieDomain()).toBe('.example.com');

    persistDoNotTrack(true);
    expect(document.cookie).toContain(`${DO_NOT_TRACK_COOKIE}=1`);
  });

  it('writes both stores on every change, so neither can be stale', () => {
    persistDoNotTrack(true);
    expect(document.cookie).toContain(`${DO_NOT_TRACK_COOKIE}=1`);
    expect(localStorage.getItem(DO_NOT_TRACK_KEY)).toBe('true');

    persistDoNotTrack(false);
    expect(document.cookie).toContain(`${DO_NOT_TRACK_COOKIE}=0`);
    expect(localStorage.getItem(DO_NOT_TRACK_KEY)).toBe('false');
  });
});

describe('cookie / localStorage precedence', () => {
  beforeEach(() => {
    clearStoredConsent();
  });

  it('lets the cookie win over a stale localStorage opt-in', () => {
    // The realistic path: the visitor opted in on www (localStorage era), then
    // opted out on shop, which wrote the shared cookie. The cookie is the newer,
    // wider decision and must win.
    localStorage.setItem(DO_NOT_TRACK_KEY, 'false');
    document.cookie = `${DO_NOT_TRACK_COOKIE}=1;path=/;domain=.example.com`;

    expect(loadDoNotTrack()).toBe(true);
  });

  it('lets the cookie win over a stale localStorage opt-out', () => {
    localStorage.setItem(DO_NOT_TRACK_KEY, 'true');
    document.cookie = `${DO_NOT_TRACK_COOKIE}=0;path=/;domain=.example.com`;

    expect(loadDoNotTrack()).toBe(false);
  });

  it('falls back to localStorage when no cookie exists', () => {
    // Every visitor who opted out before this change is in exactly this state.
    // Dropping the fallback would silently re-enrol all of them.
    localStorage.setItem(DO_NOT_TRACK_KEY, 'true');

    expect(loadDoNotTrack()).toBe(true);
  });

  it('upgrades a legacy localStorage-only opt-out to a shared cookie on read', () => {
    localStorage.setItem(DO_NOT_TRACK_KEY, 'true');

    expect(loadDoNotTrack()).toBe(true);
    // This write is what actually closes D15 for the *existing* population,
    // rather than only for people who opt out after the upgrade.
    expect(document.cookie).toContain(`${DO_NOT_TRACK_COOKIE}=1`);
  });

  it('never upgrades a legacy opt-IN into a cookie', () => {
    // The upgrade may only ever widen an opt-out. Widening an opt-in would let
    // one subdomain's stale "yes" authorise tracking on another, which is the one
    // direction consent code must not be wrong in.
    localStorage.setItem(DO_NOT_TRACK_KEY, 'false');

    expect(loadDoNotTrack()).toBe(false);
    expect(document.cookie).not.toContain(DO_NOT_TRACK_COOKIE);
  });

  it('ignores a cookie value it does not recognise and falls through', () => {
    document.cookie = `${DO_NOT_TRACK_COOKIE}=maybe;path=/;domain=.example.com`;
    localStorage.setItem(DO_NOT_TRACK_KEY, 'true');

    expect(loadDoNotTrack()).toBe(true);
  });
});

describe('storage that throws — the hard rule', () => {
  /**
   * `optOut()` runs inside the host page's consent-banner click handler. Safari
   * private mode, a full quota and a sandboxed iframe all make these APIs throw.
   * A throw here turns our compliance fix into the customer's broken banner, so
   * every one of these asserts *no propagation* rather than a return value.
   */
  const originalCookie = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'cookie',
  );

  function breakCookies() {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        throw new Error('SecurityError: sandboxed iframe');
      },
      set() {
        throw new Error('SecurityError: sandboxed iframe');
      },
    });
  }

  afterEach(() => {
    delete (document as unknown as { cookie?: unknown }).cookie;
    if (originalCookie) {
      Object.defineProperty(Document.prototype, 'cookie', originalCookie);
    }
  });

  it('survives localStorage throwing, and keeps consent in the cookie', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });

    expect(() => persistDoNotTrack(true)).not.toThrow();
    // Strictly better than before: with localStorage dead the old implementation
    // lost the opt-out entirely. The cookie now carries it.
    expect(loadDoNotTrack()).toBe(true);

    setItem.mockRestore();
    getItem.mockRestore();
  });

  it('survives document.cookie throwing, and keeps consent in localStorage', () => {
    breakCookies();

    expect(() => persistDoNotTrack(true)).not.toThrow();
    expect(loadDoNotTrack()).toBe(true);
  });

  it('never throws when both stores are dead, and reports tracking allowed', () => {
    breakCookies();
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });

    expect(() => persistDoNotTrack(true)).not.toThrow();
    expect(() => loadDoNotTrack()).not.toThrow();
    // Nothing can be stored and nothing can be read, so there is no evidence of a
    // decision. The in-memory flag held by AutoTrackerModule still governs the
    // current page — this is only what a *fresh* page would conclude.
    expect(loadDoNotTrack()).toBe(false);
    expect(loadStoredConsent()).toBe(null);

    setItem.mockRestore();
    getItem.mockRestore();
  });

  it('never throws from clearStoredConsent when both stores are dead', () => {
    breakCookies();
    const removeItem = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(() => {
        throw new Error('SecurityError');
      });

    expect(() => clearStoredConsent()).not.toThrow();

    removeItem.mockRestore();
  });
});

/**
 * The domain-scoped half of `consentCookie.ts`. It can only be asserted from this
 * file: jsdom fixes the document URL per file, and `localhost` — where
 * `consentCookie.test.ts` runs — cannot carry a domain cookie at all.
 */
describe('the attributes written at the eTLD+1', () => {
  function captureCookieWrites(): { written: string[]; restore: () => void } {
    const written: string[] = [];
    const descriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'cookie',
    );

    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: (value: string) => {
        written.push(value);
      },
    });

    return {
      written,
      restore: () => {
        delete (document as unknown as { cookie?: unknown }).cookie;
        if (descriptor) {
          Object.defineProperty(Document.prototype, 'cookie', descriptor);
        }
      },
    };
  }

  it('scopes the cookie to the registrable domain and marks it Secure over https', () => {
    // The domain attribute is the entire mechanism behind D15: without it,
    // `shop.example.com` and `www.example.com` hold separate opt-outs.
    const capture = captureCookieWrites();
    try {
      persistDoNotTrack(true);
    } finally {
      capture.restore();
    }

    expect(capture.written[0]).toContain('domain=.example.com');
    expect(capture.written[0]).toContain('Secure');
    expect(capture.written[0]).toContain('SameSite=Lax');
    expect(capture.written[0]).toContain('max-age=31536000');
  });

  it('expires the cookie at BOTH scopes when clearing', () => {
    // A visitor who first arrived on localhost and later on app.example.com can
    // hold either scope. Clearing one leaves the other live, which leaves the
    // opt-out state ambiguous — the worst outcome for a compliance signal.
    const capture = captureCookieWrites();
    try {
      clearStoredConsent();
    } finally {
      capture.restore();
    }

    const expiries = capture.written.filter((w) =>
      w.includes('expires=Thu, 01 Jan 1970'),
    );
    expect(expiries.length).toBeGreaterThanOrEqual(2);
    expect(expiries.some((w) => !w.includes('domain='))).toBe(true);
    expect(expiries.some((w) => w.includes('domain=.example.com'))).toBe(true);
  });
});
