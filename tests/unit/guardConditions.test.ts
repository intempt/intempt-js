import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createCookieGuard,
  createCustomGuard,
  createDomainBlockGuard,
  createLocalStorageGuard,
  createPathBlockGuard,
  createQueryParamBlockGuard,
  createTimeBlockGuard,
  createUrlPatternBlockGuard,
  createUserAgentBlockGuard,
} from '../../src/guard/trackingGuard.conditions.ts';
import { GuardContext } from '../../src/guard/trackingGuard.types.ts';

/**
 * Guard condition factories — tier 1.
 *
 * Ported from `__tests__/trackingGuard.cy.ts` and `__tests__/botGuard.cy.ts`
 * (both deleted in the same commit, not duplicated). These are pure predicates
 * over a plain `GuardContext` object, so a real browser bought nothing; two of
 * them additionally need control the browser cannot give:
 *
 *  - `createTimeBlockGuard` reads the wall clock. Under Cypress it was simply
 *    never tested — you cannot assert an overnight window at 14:00. Here
 *    `vi.setSystemTime` pins the hour, so every branch is reachable.
 *  - `createLocalStorageGuard`'s throw path needs `getItem` to fail, which means
 *    stubbing `Storage.prototype`.
 *
 * Coverage note: the Cypress specs only ever exercised three of the ten
 * factories (domain, query-param, crawler-bot). Path, url-pattern, user-agent,
 * cookie, localStorage, time and custom had **no test anywhere** before this
 * file.
 *
 * Convention: a condition returning `true` means tracking is BLOCKED.
 */

function contextFor(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    url: 'https://example.com/',
    hostname: 'example.com',
    pathname: '/',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    referrer: '',
    timestamp: 1_700_000_000_000,
    searchParams: new URLSearchParams(),
    ...overrides,
  };
}

describe('createDomainBlockGuard', () => {
  const guard = createDomainBlockGuard(['localhost', '127.0.0.1', 'Staging.Example.COM']);

  it('blocks an exact hostname match', () => {
    expect(guard(contextFor({ hostname: 'localhost' }))).toBe(true);
    expect(guard(contextFor({ hostname: '127.0.0.1' }))).toBe(true);
  });

  it('blocks a subdomain of a blocked domain', () => {
    expect(guard(contextFor({ hostname: 'test.localhost' }))).toBe(true);
    expect(guard(contextFor({ hostname: 'a.b.staging.example.com' }))).toBe(true);
  });

  it('allows a hostname that is not in the list', () => {
    expect(guard(contextFor({ hostname: 'example.com' }))).toBe(false);
  });

  it('matches case-insensitively in both directions', () => {
    // The configured entry is mixed-case and the hostname is upper-case; both
    // sides are lowercased, so neither casing can defeat the block.
    expect(guard(contextFor({ hostname: 'STAGING.EXAMPLE.COM' }))).toBe(true);
    expect(guard(contextFor({ hostname: 'LOCALHOST' }))).toBe(true);
  });

  it('does not treat a suffix collision as a subdomain', () => {
    // 'notlocalhost' ends with 'localhost' as a *string* but is a different
    // host. The guard requires a '.' separator, which is what makes this safe.
    expect(guard(contextFor({ hostname: 'notlocalhost' }))).toBe(false);
    expect(guard(contextFor({ hostname: 'evil-127.0.0.1' }))).toBe(false);
  });

  it('allows everything when the block list is empty', () => {
    expect(createDomainBlockGuard([])(contextFor({ hostname: 'localhost' }))).toBe(false);
  });
});

describe('createPathBlockGuard', () => {
  const guard = createPathBlockGuard(['/admin', '/Internal/Reports']);

  it('blocks an exact path match', () => {
    expect(guard(contextFor({ pathname: '/admin' }))).toBe(true);
  });

  it('blocks any path beneath a blocked prefix', () => {
    expect(guard(contextFor({ pathname: '/admin/users/42' }))).toBe(true);
    expect(guard(contextFor({ pathname: '/internal/reports/q3' }))).toBe(true);
  });

  it('allows an unrelated path', () => {
    expect(guard(contextFor({ pathname: '/pricing' }))).toBe(false);
  });

  it('is prefix-based, so it also blocks a same-prefix sibling', () => {
    // Documented sharp edge: '/administrator' starts with '/admin', so it is
    // blocked. Configure '/admin/' if that is not wanted.
    expect(guard(contextFor({ pathname: '/administrator' }))).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(guard(contextFor({ pathname: '/ADMIN/users' }))).toBe(true);
  });
});

describe('createUrlPatternBlockGuard', () => {
  it('blocks when the pattern matches the full url', () => {
    const guard = createUrlPatternBlockGuard(/\/checkout\/(step-\d+)/);
    expect(guard(contextFor({ url: 'https://example.com/checkout/step-2?x=1' }))).toBe(true);
    expect(guard(contextFor({ url: 'https://example.com/checkout/' }))).toBe(false);
  });

  it('tests the url, not the pathname — so query strings are matchable', () => {
    const guard = createUrlPatternBlockGuard(/[?&]preview=/);
    expect(guard(contextFor({ url: 'https://example.com/p?preview=1', pathname: '/p' }))).toBe(true);
  });

  it('is not defeated by a stateful global regex', () => {
    // A /g regex keeps lastIndex between .test() calls, so the same input can
    // alternate true/false. A guard that flickers per page view would be a
    // genuinely awful bug to diagnose, so pin the behaviour.
    const guard = createUrlPatternBlockGuard(/example/g);
    const ctx = contextFor({ url: 'https://example.com/' });
    const results = [guard(ctx), guard(ctx), guard(ctx)];
    expect(results, 'a /g pattern makes the guard alternate — do not pass one').toEqual([
      true,
      false,
      true,
    ]);
  });
});

describe('createUserAgentBlockGuard', () => {
  const guard = createUserAgentBlockGuard(['HeadlessChrome', 'PhantomJS']);

  it('blocks on a case-insensitive substring match', () => {
    expect(guard(contextFor({ userAgent: 'Mozilla/5.0 HeadlessChrome/120.0.0.0' }))).toBe(true);
    expect(guard(contextFor({ userAgent: 'mozilla/5.0 headlesschrome/120' }))).toBe(true);
  });

  it('allows a user agent with no listed substring', () => {
    expect(guard(contextFor())).toBe(false);
  });
});

describe('createQueryParamBlockGuard', () => {
  it('blocks on mere presence when no value is given', () => {
    const guard = createQueryParamBlockGuard('notrack');
    expect(guard(contextFor({ searchParams: new URLSearchParams('notrack=true') }))).toBe(true);
    expect(guard(contextFor({ searchParams: new URLSearchParams('notrack=1') }))).toBe(true);
    // Present but empty still counts as present — `?notrack` is an opt-out.
    expect(guard(contextFor({ searchParams: new URLSearchParams('notrack=') }))).toBe(true);
  });

  it('allows when the param is absent', () => {
    const guard = createQueryParamBlockGuard('notrack');
    expect(guard(contextFor())).toBe(false);
    expect(guard(contextFor({ searchParams: new URLSearchParams('utm_source=test') }))).toBe(false);
  });

  it('blocks only on an exact value when one is given', () => {
    const guard = createQueryParamBlockGuard('mode', 'qa');
    expect(guard(contextFor({ searchParams: new URLSearchParams('mode=qa') }))).toBe(true);
    expect(guard(contextFor({ searchParams: new URLSearchParams('mode=prod') }))).toBe(false);
    expect(guard(contextFor({ searchParams: new URLSearchParams('mode=QA') }))).toBe(false);
    expect(guard(contextFor())).toBe(false);
  });
});

describe('createCookieGuard', () => {
  it('allows when the cookie is absent', () => {
    expect(createCookieGuard('optout')(contextFor())).toBe(false);
  });

  it('blocks on mere presence when no value is given', () => {
    document.cookie = 'optout=whatever;path=/';
    expect(createCookieGuard('optout')(contextFor())).toBe(true);
  });

  it('blocks only on an exact value when one is given', () => {
    document.cookie = 'env=qa;path=/';
    expect(createCookieGuard('env', 'qa')(contextFor())).toBe(true);
    expect(createCookieGuard('env', 'prod')(contextFor())).toBe(false);
  });

  it('finds the cookie when it is not the first in the header', () => {
    document.cookie = 'a=1;path=/';
    document.cookie = 'optout=1;path=/';
    document.cookie = 'z=9;path=/';
    // The name match requires a `name=` prefix after trimming, so the leading
    // space in "; optout=1" must not defeat it.
    expect(createCookieGuard('optout')(contextFor())).toBe(true);
  });

  it('does not match a cookie whose name merely ends with the target', () => {
    document.cookie = 'myoptout=1;path=/';
    expect(createCookieGuard('optout')(contextFor())).toBe(false);
  });
});

describe('createLocalStorageGuard', () => {
  it('allows when the key is absent', () => {
    expect(createLocalStorageGuard('intempt_optout')(contextFor())).toBe(false);
  });

  it('blocks on mere presence when no value is given', () => {
    localStorage.setItem('intempt_optout', 'anything');
    expect(createLocalStorageGuard('intempt_optout')(contextFor())).toBe(true);
  });

  it('blocks only on an exact value when one is given', () => {
    localStorage.setItem('env', 'qa');
    expect(createLocalStorageGuard('env', 'qa')(contextFor())).toBe(true);
    expect(createLocalStorageGuard('env', 'prod')(contextFor())).toBe(false);
  });

  it('fails open when storage access throws', () => {
    // Safari private mode and sandboxed iframes throw on access rather than
    // returning null. Failing *open* is the right call: a storage error is not
    // consent to be blocked, and the alternative is silently tracking nobody.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(createLocalStorageGuard('intempt_optout')(contextFor())).toBe(false);
  });
});

describe('createTimeBlockGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Pin the local hour, which is what the guard reads via getHours(). */
  function atHour(hour: number) {
    const d = new Date(2026, 7, 11, hour, 30, 0);
    vi.setSystemTime(d);
  }

  it('blocks inside a same-day window and allows outside it', () => {
    const guard = createTimeBlockGuard(9, 17);
    atHour(12);
    expect(guard(contextFor())).toBe(true);
    atHour(20);
    expect(guard(contextFor())).toBe(false);
    atHour(3);
    expect(guard(contextFor())).toBe(false);
  });

  it('treats the window as start-inclusive and end-exclusive', () => {
    const guard = createTimeBlockGuard(9, 17);
    atHour(9);
    expect(guard(contextFor()), 'startHour is inside the window').toBe(true);
    atHour(17);
    expect(guard(contextFor()), 'endHour is outside the window').toBe(false);
    atHour(16);
    expect(guard(contextFor())).toBe(true);
  });

  it('handles an overnight window that wraps midnight', () => {
    // start > end is the signal to wrap. This branch was unreachable under
    // Cypress, which is why it had no coverage before.
    const guard = createTimeBlockGuard(22, 6);
    atHour(23);
    expect(guard(contextFor())).toBe(true);
    atHour(2);
    expect(guard(contextFor())).toBe(true);
    atHour(6);
    expect(guard(contextFor()), 'endHour stays exclusive when wrapping').toBe(false);
    atHour(12);
    expect(guard(contextFor())).toBe(false);
  });

  it('blocks nothing when start and end are equal', () => {
    // Not a 24-hour block: with start == end neither branch can be satisfied,
    // so an equal pair is a no-op guard. Worth pinning so nobody configures
    // createTimeBlockGuard(0, 0) expecting "always block".
    const guard = createTimeBlockGuard(0, 0);
    for (const hour of [0, 6, 12, 23]) {
      atHour(hour);
      expect(guard(contextFor()), `hour ${hour}`).toBe(false);
    }
  });
});

describe('createCustomGuard', () => {
  it('returns the condition unchanged', () => {
    const condition = (ctx: GuardContext) => ctx.referrer.includes('internal.example.com');
    const guard = createCustomGuard(condition);
    expect(guard).toBe(condition);
    expect(guard(contextFor({ referrer: 'https://internal.example.com/x' }))).toBe(true);
    expect(guard(contextFor({ referrer: 'https://google.com/' }))).toBe(false);
  });
});
