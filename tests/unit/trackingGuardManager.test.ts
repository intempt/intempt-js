import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TrackingGuardManager } from '../../src/guard/trackingGuard.manager.ts';
import {
  createGuardContext,
  shouldBlockTracking,
} from '../../src/guard/trackingGuard.checker.ts';
import {
  createCrawlerBotBlockGuard,
  createDomainBlockGuard,
} from '../../src/guard/trackingGuard.conditions.ts';
import { GuardContext } from '../../src/guard/trackingGuard.types.ts';

/**
 * Guard manager and checker — tier 1.
 *
 * Ported from the Guard Management, Multiple Guards, Edge Cases and Integration
 * blocks of `__tests__/trackingGuard.cy.ts` and `__tests__/botGuard.cy.ts`, both
 * deleted in the same commit.
 *
 * This is the module that decides whether the SDK initialises at all, so its
 * failure mode is the worst one available: block by accident and the customer
 * silently collects nothing. Hence the emphasis below on the fail-open paths —
 * no guards, all disabled, a throwing condition.
 */

function contextFor(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    url: 'https://example.com/',
    hostname: 'example.com',
    pathname: '/',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    referrer: '',
    timestamp: 1_700_000_000_000,
    searchParams: new URLSearchParams(),
    ...overrides,
  };
}

const ALWAYS_BLOCK = () => true;
const NEVER_BLOCK = () => false;

describe('TrackingGuardManager — registration', () => {
  let manager: TrackingGuardManager;

  beforeEach(() => {
    manager = new TrackingGuardManager();
  });

  it('registers and reports a guard', () => {
    manager.register({
      id: 'test-guard',
      condition: ALWAYS_BLOCK,
      enabled: true,
    });
    expect(manager.hasGuard('test-guard')).toBe(true);
    expect(manager.getGuards()).toHaveLength(1);
  });

  it('unregisters a guard and reports whether anything was removed', () => {
    manager.register({ id: 'test-guard', condition: ALWAYS_BLOCK });
    expect(manager.unregister('test-guard')).toBe(true);
    expect(manager.hasGuard('test-guard')).toBe(false);
    expect(
      manager.unregister('test-guard'),
      'removing it twice reports false',
    ).toBe(false);
  });

  it('clears every guard', () => {
    manager.register({ id: 'g1', condition: ALWAYS_BLOCK });
    manager.register({ id: 'g2', condition: ALWAYS_BLOCK });
    expect(manager.getGuards()).toHaveLength(2);
    manager.clear();
    expect(manager.getGuards()).toHaveLength(0);
  });

  it('replaces a guard registered under an existing id', () => {
    // Keyed by a Map, so re-registering overwrites rather than adding a second
    // guard under the same id. Worth pinning: a caller registering in a
    // re-entrant init path must not accumulate duplicates.
    manager.register({ id: 'dup', condition: ALWAYS_BLOCK });
    manager.register({ id: 'dup', condition: NEVER_BLOCK });
    expect(manager.getGuards()).toHaveLength(1);
  });

  it('defaults enabled to true when omitted', async () => {
    manager.register({ id: 'no-flag', condition: ALWAYS_BLOCK });
    expect(manager.getGuards()[0].enabled).toBe(true);
    expect((await manager.evaluate(contextFor())).blocked).toBe(true);
  });

  it('rejects a missing or blank id', () => {
    expect(() => manager.register({ id: '', condition: ALWAYS_BLOCK })).toThrow(
      'Guard ID is required',
    );
    expect(() =>
      manager.register({ id: '   ', condition: ALWAYS_BLOCK }),
    ).toThrow('Guard ID is required');
  });

  it('rejects a condition that is not a function', () => {
    expect(() =>
      manager.register({ id: 'bad', condition: undefined as never }),
    ).toThrow('Guard condition function is required');
    expect(() =>
      manager.register({ id: 'bad', condition: 'nope' as never }),
    ).toThrow('Guard condition function is required');
  });
});

describe('TrackingGuardManager — evaluation', () => {
  let manager: TrackingGuardManager;

  beforeEach(() => {
    manager = new TrackingGuardManager();
  });

  it('reports which guard blocked, and why', async () => {
    manager.register({
      id: 'domain-block',
      description: 'internal hostname',
      condition: createDomainBlockGuard(['localhost']),
    });
    const result = await manager.evaluate(
      contextFor({ hostname: 'localhost' }),
    );
    expect(result).toEqual({
      blocked: true,
      guardId: 'domain-block',
      reason: 'internal hostname',
    });
  });

  it('falls back to a generated reason when no description is set', async () => {
    manager.register({ id: 'anon', condition: ALWAYS_BLOCK });
    const result = await manager.evaluate(contextFor());
    expect(result.reason).toBe('Blocked by guard: anon');
  });

  it('blocks if any registered guard blocks, naming that guard', async () => {
    manager.register({
      id: 'domain-block',
      condition: createDomainBlockGuard(['localhost']),
    });
    manager.register({
      id: 'crawler-block',
      condition: createCrawlerBotBlockGuard(),
    });

    const byDomain = await manager.evaluate(
      contextFor({ hostname: 'localhost' }),
    );
    expect(byDomain.guardId).toBe('domain-block');

    const byCrawler = await manager.evaluate(
      contextFor({ userAgent: 'Googlebot/2.1' }),
    );
    expect(byCrawler.guardId).toBe('crawler-block');

    const allowed = await manager.evaluate(contextFor());
    expect(allowed.blocked).toBe(false);
  });

  it('short-circuits on the first blocking guard', async () => {
    // Guards can do real work (regex over a long UA, storage reads), so the
    // second one must not run once the answer is known.
    const second = vi.fn(() => true);
    manager.register({ id: 'first', condition: ALWAYS_BLOCK });
    manager.register({ id: 'second', condition: second });

    const result = await manager.evaluate(contextFor());
    expect(result.guardId).toBe('first');
    expect(second).not.toHaveBeenCalled();
  });

  it('awaits an async condition', async () => {
    manager.register({
      id: 'async-guard',
      condition: async () => {
        await Promise.resolve();
        return true;
      },
    });
    expect((await manager.evaluate(contextFor())).blocked).toBe(true);
  });

  it('treats only a literal true as blocking', async () => {
    // `shouldBlock === true` is a strict comparison, so a truthy non-boolean
    // does not block. That is the safe direction — a condition returning a
    // string by accident must not silently disable the customer's SDK.
    manager.register({ id: 'truthy', condition: (() => 'yes') as never });
    expect((await manager.evaluate(contextFor())).blocked).toBe(false);
  });

  it('allows when nothing is registered', async () => {
    expect((await manager.evaluate(contextFor())).blocked).toBe(false);
  });

  it('allows when every guard is individually disabled', async () => {
    manager.register({ id: 'off', condition: ALWAYS_BLOCK, enabled: false });
    expect((await manager.evaluate(contextFor())).blocked).toBe(false);
  });

  it('toggles a single guard at runtime', async () => {
    manager.register({ id: 'toggle', condition: ALWAYS_BLOCK });
    expect((await manager.evaluate(contextFor())).blocked).toBe(true);

    manager.setGuardEnabled('toggle', false);
    expect((await manager.evaluate(contextFor())).blocked).toBe(false);

    manager.setGuardEnabled('toggle', true);
    expect((await manager.evaluate(contextFor())).blocked).toBe(true);
  });

  it('ignores setGuardEnabled for an unknown id', () => {
    expect(() => manager.setGuardEnabled('nope', false)).not.toThrow();
  });

  it('honours the master switch in both directions', async () => {
    manager.register({ id: 'guard', condition: ALWAYS_BLOCK });
    expect(manager.isEnabled()).toBe(true);

    manager.setEnabled(false);
    expect(manager.isEnabled()).toBe(false);
    expect((await manager.evaluate(contextFor())).blocked).toBe(false);

    manager.setEnabled(true);
    expect((await manager.evaluate(contextFor())).blocked).toBe(true);
  });

  it('keeps evaluating after a guard throws', async () => {
    // Fail-open on error is the whole point: a customer's custom guard with a
    // bug must not take their analytics down. The throwing guard is skipped and
    // the remaining guards still decide.
    const throwing = vi.fn(() => {
      throw new Error('Test error');
    });
    manager.register({ id: 'error-guard', condition: throwing });
    manager.register({ id: 'blocking-guard', condition: ALWAYS_BLOCK });

    const result = await manager.evaluate(contextFor());
    expect(throwing).toHaveBeenCalled();
    expect(result.blocked, 'the later guard still gets to block').toBe(true);
    expect(result.guardId).toBe('blocking-guard');
  });

  it('allows when the only guard throws', async () => {
    manager.register({
      id: 'error-guard',
      condition: () => {
        throw new Error('Test error');
      },
    });
    expect((await manager.evaluate(contextFor())).blocked).toBe(false);
  });

  it('survives a rejected async condition', async () => {
    // `await guard.condition(context)` inside the try means a rejected promise
    // lands in the same catch as a synchronous throw. Asserting it because the
    // two are easy to conflate and only one is obvious from reading.
    manager.register({
      id: 'rejects',
      condition: () => Promise.reject(new Error('nope')),
    });
    manager.register({ id: 'fine', condition: NEVER_BLOCK });
    expect((await manager.evaluate(contextFor())).blocked).toBe(false);
  });
});

describe('createGuardContext', () => {
  it('snapshots the current page state', () => {
    const context = createGuardContext();
    expect(context.url).toBe(window.location.href);
    expect(context.hostname).toBe(window.location.hostname);
    expect(context.pathname).toBe(window.location.pathname);
    expect(context.userAgent).toBe(navigator.userAgent);
    expect(context.referrer).toBe(document.referrer);
    expect(typeof context.timestamp).toBe('number');
    expect(context.searchParams).toBeInstanceOf(URLSearchParams);
  });

  it('parses the query string into searchParams', () => {
    const search = '?notrack=1&utm_source=test';
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      href: `https://example.com/p${search}`,
      hostname: 'example.com',
      pathname: '/p',
      search,
    } as Location);

    const context = createGuardContext();
    expect(context.searchParams.get('notrack')).toBe('1');
    expect(context.searchParams.get('utm_source')).toBe('test');
  });
});

describe('shouldBlockTracking', () => {
  /** Swap the UA the checker will read, and restore it afterwards. */
  function withUserAgent(userAgent: string, run: () => Promise<void>) {
    const original = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      get: () => userAgent,
      configurable: true,
    });
    return run().finally(() => {
      Object.defineProperty(navigator, 'userAgent', {
        get: () => original,
        configurable: true,
      });
    });
  }

  let manager: TrackingGuardManager;

  beforeEach(() => {
    manager = new TrackingGuardManager();
    manager.register({
      id: 'block-crawler-bots',
      name: 'Block Crawler/Bot User Agents',
      description: 'Prevent tracking from crawlers, bots, and automated tools',
      condition: createCrawlerBotBlockGuard(),
      enabled: true,
    });
  });

  it('blocks tracking for Googlebot, reading the live navigator', async () => {
    await withUserAgent(
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      async () => {
        expect(await shouldBlockTracking(manager)).toBe(true);
      },
    );
  });

  it('allows tracking for Chrome', async () => {
    await withUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      async () => {
        expect(await shouldBlockTracking(manager)).toBe(false);
      },
    );
  });

  it('returns a boolean, not the GuardResult', async () => {
    // main.ts branches on this directly, so the contract is the primitive.
    const blocked = await shouldBlockTracking(new TrackingGuardManager());
    expect(blocked).toBe(false);
  });
});
