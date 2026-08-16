import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getCookie,
  handleDomain,
  localIntemptPageSessionCookie,
  localIntemptSessionCookie,
  setCookie,
} from '../../src/shared/storageHandler.ts';

// --- Mutation-driven assertions (measured run, CHECKPOINT.md §3f) -----------
//
// This file exists because `publicSuffix.test.ts` exercises storageHandler's
// happy paths but left 14 mutants (12 survived + 2 no-coverage) alive: every
// one of them is a computed cookie-string value or a real branch of
// `setCookie`/`getCookie`/the local-cookie getters, not a guard or reporter —
// the §3f-iii heuristic says exactly this shape is worth testing.

/**
 * Replace `document.cookie` with a fixed string for the getter and a capture
 * array for the setter, restoring the real descriptor after. jsdom does not
 * expose cookie attributes any other way (see requestBatcher's
 * `captureCookieWrites` precedent in consentCookie.test.ts).
 */
function stubCookie(readValue: string) {
  const written: string[] = [];
  const descriptor = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'cookie',
  );
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    set(value: string) {
      written.push(value);
    },
    get() {
      return readValue;
    },
  });
  return {
    written,
    restore() {
      if (descriptor) {
        Object.defineProperty(document, 'cookie', descriptor);
      }
    },
  };
}

describe('setCookie — string construction', () => {
  let stub: ReturnType<typeof stubCookie>;

  beforeEach(() => {
    stub = stubCookie('');
  });

  afterEach(() => {
    stub.restore();
  });

  it('writes the path segment', () => {
    // Kills the StringLiteral mutant that empties `path=${path};`.
    setCookie({ name: 'n', value: 'v', path: '/checkout' });
    expect(stub.written[0]).toContain('path=/checkout;');
  });

  it('writes an expires segment when an expiration is given', () => {
    // Kills the StringLiteral mutant that empties the expires template.
    setCookie({ name: 'n', value: 'v', path: '/', expiration: 60_000 });
    expect(stub.written[0]).toMatch(/expires=.+GMT;/);
  });

  it('omits the expires segment when no expiration is given', () => {
    // Kills the StringLiteral mutant on the `''` fallback for the expires
    // ternary (`:'';` → `:"Stryker was here!";`) — the fallback is a real
    // computed value (an absent attribute), not a guard.
    setCookie({ name: 'n', value: 'v', path: '/' });
    expect(stub.written[0]).not.toContain('expires=');
    expect(stub.written[0]).not.toContain('Stryker');
  });

  it('defaults the domain parameter to empty, not a literal placeholder', () => {
    // Kills the StringLiteral mutant on the `domain = ''` default parameter.
    // A non-empty default would make `domain` truthy and route every call
    // that omits it into handleDomain() with garbage input.
    setCookie({ name: 'n', value: 'v', path: '/' });
    expect(stub.written[0]).not.toContain('domain=');
  });

  it('writes a domain attribute for a shareable host', () => {
    // Kills the NoCoverage mutant that empties the truthy branch of the
    // cookieDomain ternary (`domain=${resolvedDomain};` → ``). Nothing before
    // this batch called setCookie with a domain that actually resolves.
    setCookie({ name: 'n', value: 'v', path: '/', domain: 'shop.example.com' });
    expect(stub.written[0]).toContain('domain=.example.com;');
  });

  it('omits the domain attribute rather than writing a placeholder for a host-only target', () => {
    // Kills the StringLiteral mutant on the cookieDomain ternary's `''`
    // fallback (the false branch, as distinct from the no-coverage true
    // branch above).
    setCookie({ name: 'n', value: 'v', path: '/', domain: 'localhost' });
    expect(stub.written[0]).not.toContain('domain=');
    expect(stub.written[0]).not.toContain('Stryker');
  });

  it('assembles the cookie value pair first', () => {
    setCookie({ name: 'unit_construct', value: 'hello', path: '/' });
    expect(stub.written[0].startsWith('unit_construct=hello;')).toBe(true);
  });
});

describe('handleDomain', () => {
  it('returns empty, not a placeholder, when there is no registrable suffix', () => {
    // Kills the NoCoverage StringLiteral on handleDomain's own '' fallback
    // (distinct from setCookie's — this is reached only when the host is NOT
    // host-only but extractEtldPlusOne still cannot resolve a suffix).
    expect(handleDomain('...')).toBe('');
  });
});

describe('getCookie — key/value extraction', () => {
  it('trims whitespace out of the decoded value', () => {
    // Kills the MethodExpression mutant that drops `.trim()` from the value
    // extraction. Without it, a cookie written with incidental padding would
    // decode with the padding still attached.
    const stub2 = stubCookie('padded= hello ;');
    try {
      expect(getCookie('padded')).toEqual({ padded: 'hello' });
    } finally {
      stub2.restore();
    }
  });

  it('does not let a value containing "=" impersonate a different cookie name', () => {
    // Kills the ConditionalExpression mutant on `if (key !== name.trim())
    // return null;` → `if (false) return null;`. A cookie named "foo" with a
    // value containing "=" makes `startsWith(name + '=')` true for a lookup
    // of "foo=x" too; the guard is what stops that from being misread as a
    // match.
    const stub2 = stubCookie('foo=x=y;');
    try {
      expect(getCookie('foo=x')).toBeNull();
      expect(getCookie('foo')).toEqual({ foo: 'x=y' });
    } finally {
      stub2.restore();
    }
  });

  it('requires the exact "name=" prefix, not merely a "name"-starting cookie', () => {
    // Kills the StringLiteral mutant `startsWith(name + '=')` →
    // `startsWith(name + "")`. With two cookies where the shorter name is a
    // prefix of the longer one, a bare-prefix match picks the wrong (earlier)
    // cookie and the key guard then discards it — losing the real match.
    const stub2 = stubCookie('ab=1; a=2;');
    try {
      expect(getCookie('a')).toEqual({ a: '2' });
    } finally {
      stub2.restore();
    }
  });
});

describe('local in-memory cookie mirrors', () => {
  // `appLocalCookie` is a module-level singleton with no reset hook, so the
  // "nothing set yet" case has to run before any test in this file writes to
  // it — order here is deliberate, not incidental.
  it('returns null before any session cookie has been set', () => {
    expect(localIntemptSessionCookie()).toBeNull();
  });

  it('returns the parsed session cookie once one has been set', () => {
    // Kills the BooleanLiteral mutants on `!!appLocalCookie['intempt_session']`
    // (→ `!...`) and the StringLiteral mutant on the lookup key (→ ''): both
    // would make a present value read as absent.
    const stub = stubCookie('');
    try {
      setCookie({
        name: 'intempt_session',
        value: JSON.stringify({ sid: 1 }),
        path: '/',
      });
      expect(localIntemptSessionCookie()).toEqual({ sid: 1 });
    } finally {
      stub.restore();
    }
  });

  it('returns the parsed page-session cookie once one has been set', () => {
    const stub = stubCookie('');
    try {
      setCookie({
        name: 'page_session',
        value: JSON.stringify({ pid: 2 }),
        path: '/',
      });
      expect(localIntemptPageSessionCookie()).toEqual({ pid: 2 });
    } finally {
      stub.restore();
    }
  });
});
