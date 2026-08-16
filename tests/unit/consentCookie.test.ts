import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearConsentCookie,
  consentCookieDomain,
  readConsentCookie,
  writeConsentCookie,
} from '../../src/shared/privacy/consentCookie.ts';
import {
  DO_NOT_TRACK_COOKIE,
  loadDoNotTrack,
  persistDoNotTrack,
} from '../../src/shared/consentState.ts';

/**
 * This file deliberately runs on jsdom's **default** `http://localhost/`, which
 * is the host-only case: `localhost` is a single-label host, and a browser
 * rejects `domain=.localhost` outright — silently dropping the cookie rather than
 * mis-scoping it. Local development and every automated test of a customer's site
 * runs here, so "consent works on localhost" is not an edge case, it is the
 * developer's first experience of the feature.
 *
 * The eTLD+1 case has its own file (`consentState.test.ts`), because the document
 * URL is fixed per file in jsdom.
 */
describe('host-only hosts cannot carry a domain cookie', () => {
  beforeEach(() => {
    clearConsentCookie(DO_NOT_TRACK_COOKIE);
  });

  it('omits the domain attribute on localhost', () => {
    expect(consentCookieDomain()).toBe('');
  });

  it.each([
    ['127.0.0.1', 'IPv4 literal'],
    ['[::1]', 'bracketed IPv6 literal'],
    ['localhost', 'single-label host'],
    ['intranet-box', 'single-label intranet name'],
    ['', 'empty hostname'],
  ])('omits the domain attribute for %s (%s)', (hostname) => {
    expect(consentCookieDomain(hostname)).toBe('');
  });

  it.each([
    ['shop.example.com', '.example.com'],
    ['www.oxford.ac.uk', '.oxford.ac.uk'],
    ['example.com', '.example.com'],
    // A hosted-store hostname: `myshopify.com` is a private suffix, so the
    // registrable unit is three labels. This SDK ships a Shopify tracker, so
    // getting it wrong would mis-scope consent for a whole customer segment.
    ['checkout.acme.myshopify.com', '.acme.myshopify.com'],
    ['UPPER.Example.COM', '.example.com'],
    ['trailing.example.com.', '.example.com'],
  ])('scopes %s to %s', (hostname, expected) => {
    expect(consentCookieDomain(hostname)).toBe(expected);
  });

  it('still round-trips consent on localhost, host-only', () => {
    persistDoNotTrack(true);
    expect(loadDoNotTrack()).toBe(true);
    expect(document.cookie).toContain(`${DO_NOT_TRACK_COOKIE}=1`);
  });
});

describe('cookie primitives', () => {
  beforeEach(() => {
    clearConsentCookie('probe');
  });

  it('round-trips a value', () => {
    expect(writeConsentCookie('probe', 'hello')).toBe(true);
    expect(readConsentCookie('probe')).toBe('hello');
  });

  it('encodes and decodes values that would otherwise break the cookie syntax', () => {
    writeConsentCookie('probe', 'a=b; c');
    expect(readConsentCookie('probe')).toBe('a=b; c');
  });

  it('returns null for a cookie that is not set', () => {
    expect(readConsentCookie('never_written')).toBe(null);
  });

  it('does not match a cookie whose name merely shares a prefix', () => {
    // `intempt_do_not_track_v2` must not answer a read for `intempt_do_not_track`.
    writeConsentCookie('probe_extended', 'wrong');
    expect(readConsentCookie('probe')).toBe(null);
    clearConsentCookie('probe_extended');
  });

  it('sets SameSite=Lax and path=/ so the cookie is readable site-wide', () => {
    // jsdom does not expose attributes through document.cookie, so assert on what
    // was written rather than on what was parsed back.
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

    writeConsentCookie('probe', 'x');

    delete (document as unknown as { cookie?: unknown }).cookie;
    if (descriptor) {
      Object.defineProperty(Document.prototype, 'cookie', descriptor);
    }

    expect(written[0]).toContain('SameSite=Lax');
    expect(written[0]).toContain('path=/');
    expect(written[0]).toContain('max-age=31536000');
    // http page, so no Secure — setting it would make the browser drop the cookie.
    expect(written[0]).not.toContain('Secure');
  });
});

/**
 * Capture what was assigned to `document.cookie` without letting jsdom parse it.
 * jsdom does not expose cookie attributes through the getter, so the only way to
 * assert on `domain`, `Secure` or `expires` is to intercept the write.
 */
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

describe('environments where the globals are missing', () => {
  // Not hypothetical: the snippet gets pulled into SSR bundles and into
  // sandboxed iframes, and rule 1 of this module is that nothing throws.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads null when there is no document', () => {
    vi.stubGlobal('document', undefined);
    expect(readConsentCookie('probe')).toBe(null);
  });

  it('reports a failed write when there is no document', () => {
    vi.stubGlobal('document', undefined);
    expect(writeConsentCookie('probe', 'x')).toBe(false);
  });

  it('clears without throwing when there is no document', () => {
    vi.stubGlobal('document', undefined);
    expect(() => clearConsentCookie('probe')).not.toThrow();
  });

  it('has no cookie domain when there is no window', () => {
    vi.stubGlobal('window', undefined);
    expect(consentCookieDomain()).toBe('');
  });

  it('has no cookie domain when window carries no location', () => {
    vi.stubGlobal('window', {} as unknown as Window);
    expect(consentCookieDomain()).toBe('');
  });

  it('has no cookie domain when reading the hostname throws', () => {
    // A cross-origin `window.location` access throws rather than returning
    // undefined, which is why currentHostname has a try/catch and not a guard.
    vi.stubGlobal('window', {
      get location(): Location {
        throw new Error('SecurityError');
      },
    } as unknown as Window);

    expect(consentCookieDomain()).toBe('');
  });
});

describe('parsing the cookie jar', () => {
  let capture: ReturnType<typeof captureCookieWrites> | null = null;

  afterEach(() => {
    capture?.restore();
    capture = null;
  });

  function withJar(jar: string) {
    const descriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'cookie',
    );
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => jar,
      set: () => undefined,
    });
    capture = {
      written: [],
      restore: () => {
        delete (document as unknown as { cookie?: unknown }).cookie;
        if (descriptor) {
          Object.defineProperty(Document.prototype, 'cookie', descriptor);
        }
      },
    };
  }

  it('reads null from an empty jar', () => {
    withJar('');
    expect(readConsentCookie('probe')).toBe(null);
  });

  it('skips an entry that has no separator', () => {
    // Some hosts leave a bare flag in the jar; it must not shift the parse of
    // everything after it.
    withJar('bare_flag; probe=found');
    expect(readConsentCookie('probe')).toBe('found');
  });

  it('tolerates whitespace around the name', () => {
    withJar('other=1;   probe=found  ');
    expect(readConsentCookie('probe')).toBe('found');
  });

  it('keeps everything after the first separator, so a raw = survives', () => {
    // Split-on-= would truncate this to 'a'.
    withJar('probe=a=b=c');
    expect(readConsentCookie('probe')).toBe('a=b=c');
  });

  it('returns the first match rather than the last', () => {
    withJar('probe=first;probe=second');
    expect(readConsentCookie('probe')).toBe('first');
  });

  it('does not match a name that is a suffix of the entry name', () => {
    withJar('x_probe=wrong');
    expect(readConsentCookie('probe')).toBe(null);
  });

  it('reads an empty value as empty string, not null', () => {
    // Distinguishable from absent, and consentState relies on it: '' is not '1'.
    withJar('probe=');
    expect(readConsentCookie('probe')).toBe('');
  });
});

describe('the attributes actually written', () => {
  it('omits domain on a host-only target and never sets Secure over http', () => {
    const capture = captureCookieWrites();
    try {
      writeConsentCookie('probe', 'x');
    } finally {
      capture.restore();
    }

    expect(capture.written).toHaveLength(1);
    expect(capture.written[0]).not.toContain('domain=');
    expect(capture.written[0]).not.toContain('Secure');
  });

  it('expires the cookie at the host-only scope when clearing', () => {
    const capture = captureCookieWrites();
    try {
      clearConsentCookie('probe');
    } finally {
      capture.restore();
    }

    // One write, because there is no domain scope to clear on localhost. The
    // eTLD+1 case writes two — asserted in consentState.test.ts, which runs on a
    // domain-scoped host.
    expect(capture.written).toHaveLength(1);
    expect(capture.written[0]).toContain(
      'expires=Thu, 01 Jan 1970 00:00:00 GMT',
    );
    expect(capture.written[0]).toContain('path=/');
    expect(capture.written[0]).not.toContain('domain=');
  });

  it('encodes the value so a delimiter cannot forge a second cookie', () => {
    const capture = captureCookieWrites();
    try {
      writeConsentCookie('probe', 'x; evil=1');
    } finally {
      capture.restore();
    }

    expect(capture.written[0]).toContain('probe=x%3B%20evil%3D1');
    expect(capture.written[0]).not.toContain('evil=1;');
  });
});

describe('cookie access that throws', () => {
  const originalCookie = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'cookie',
  );

  function breakCookies() {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
      set() {
        throw new Error('SecurityError');
      },
    });
  }

  afterEach(() => {
    delete (document as unknown as { cookie?: unknown }).cookie;
    if (originalCookie) {
      Object.defineProperty(Document.prototype, 'cookie', originalCookie);
    }
  });

  it('reports a read failure and answers null instead of throwing', () => {
    breakCookies();
    const onFailure = vi.fn();

    expect(readConsentCookie('probe', onFailure)).toBe(null);
    expect(onFailure).toHaveBeenCalled();
  });

  it('reports a write failure and answers false instead of throwing', () => {
    breakCookies();
    const onFailure = vi.fn();

    expect(writeConsentCookie('probe', 'x', onFailure)).toBe(false);
    expect(onFailure).toHaveBeenCalled();
  });

  it('swallows a clear failure', () => {
    breakCookies();
    const onFailure = vi.fn();

    expect(() => clearConsentCookie('probe', onFailure)).not.toThrow();
    expect(onFailure).toHaveBeenCalled();
  });

  it('reports false when the write silently does not stick', () => {
    // A cookie-blocking extension accepts the assignment and drops the cookie.
    // The caller needs to know so it can lean on localStorage instead — this is
    // information, not an error.
    const descriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'cookie',
    );
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: () => undefined,
    });

    const result = writeConsentCookie('probe', 'x');

    delete (document as unknown as { cookie?: unknown }).cookie;
    if (descriptor) {
      Object.defineProperty(Document.prototype, 'cookie', descriptor);
    }

    expect(result).toBe(false);
  });
});
