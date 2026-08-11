import { describe, expect, it } from 'vitest';
import {
  isLegitimateBrowser,
  isLikelyBot,
} from '../../src/guard/trackingGuard.browserDetection.ts';
import { createCrawlerBotBlockGuard } from '../../src/guard/trackingGuard.conditions.ts';
import { GuardContext } from '../../src/guard/trackingGuard.types.ts';

/**
 * Bot / browser detection — tier 1.
 *
 * Ported from `__tests__/botGuard.cy.ts` (45 assertions) and the browser-detection
 * and crawler blocks of `__tests__/trackingGuard.cy.ts`. Both Cypress specs are
 * deleted in the same commit — these are string predicates over a user-agent
 * literal, so running them in a real browser tested nothing about the browser.
 *
 * Two changes from the originals, both deliberate:
 *
 *  1. **The three `it.skip`s are now assertions.** They were skipped with
 *     comments saying "the guard doesn't block this" — a skip records nothing and
 *     silently passes if the behaviour changes. They are ported as
 *     `known false negatives`, asserting the *current* answer so a future change
 *     to the heuristic shows up as a failing test to be consciously updated.
 *  2. **`isLikelyBot` is covered.** It is exported from `src/guard/index.ts` as
 *     public API and had no test at all.
 */

const BOT_GUARD = createCrawlerBotBlockGuard();

function blocksUA(userAgent: string): boolean {
  const context: GuardContext = {
    url: 'https://example.com',
    hostname: 'example.com',
    pathname: '/',
    userAgent,
    referrer: '',
    timestamp: 1_700_000_000_000,
    searchParams: new URLSearchParams(),
  };
  return BOT_GUARD(context) as boolean;
}

const CHROME_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FIREFOX_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
const SAFARI_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

describe('isLegitimateBrowser', () => {
  const browsers: Array<[string, string]> = [
    ['Chrome desktop', CHROME_DESKTOP],
    ['Firefox desktop', FIREFOX_DESKTOP],
    ['Safari desktop', SAFARI_DESKTOP],
    [
      'Edge desktop',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    ],
    [
      'Opera desktop',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
    ],
    [
      'Mobile Safari (iOS)',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    ],
    [
      'Chrome iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1',
    ],
    ['legacy IE 10', 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0)'],
  ];

  it.each(browsers)('recognises %s', (_name, ua) => {
    expect(isLegitimateBrowser(ua)).toBe(true);
  });

  const bots: Array<[string, string]> = [
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['Bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
    [
      'Baiduspider',
      'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
    ],
    ['YandexBot', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'],
    [
      'Yahoo! Slurp',
      'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
    ],
  ];

  it.each(bots)('rejects %s even though it claims Mozilla', (_name, ua) => {
    expect(isLegitimateBrowser(ua)).toBe(false);
  });

  it('rejects a bot hiding behind a full Mobile Safari string', () => {
    // Googlebot's real mobile UA is a complete iPhone Safari string with
    // "(compatible; Googlebot/2.1; …)" appended. Every browser pattern matches,
    // so only the bot-name check ahead of them saves this case.
    expect(
      isLegitimateBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/602.1.50 (KHTML, like Gecko) Mobile/14E304 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      ),
    ).toBe(false);
  });

  it('rejects a bot word inside a compatible; block only when it stands alone', () => {
    // The check is /\b(bot|crawler|spider|scraper)\b/, so a *run-together* name
    // like "SomeCrawler" has no word boundary before "crawler" and slips past.
    // The `compatible;\s*[a-z]+bot` pattern above covers the -bot suffix, but
    // there is no equivalent for -crawler.
    expect(isLegitimateBrowser('Mozilla/5.0 (compatible; Some crawler/1.0)')).toBe(false);
    expect(
      isLegitimateBrowser('Mozilla/5.0 (compatible; SomeCrawler/1.0)'),
      'run-together -crawler is not caught here; the guard catches it later',
    ).toBe(true);
  });

  it('rejects an empty user agent', () => {
    expect(isLegitimateBrowser('')).toBe(false);
  });

  it('accepts a bare Mozilla string with no bot marker', () => {
    // The final fallback: mozilla/5.0 plus no bot word. Broad on purpose —
    // false-allowing an unknown agent costs a stray event, false-blocking a real
    // browser costs a customer's data.
    expect(isLegitimateBrowser('Mozilla/5.0 (Unknown Device)')).toBe(true);
  });
});

describe('isLikelyBot', () => {
  it.each([
    'Googlebot/2.1',
    'bingbot/2.0',
    'Mozilla/5.0 (compatible; Baiduspider/2.0)',
    'YandexBot/3.0',
    'Yahoo! Slurp',
    'CustomCrawler/1.0',
    'somespider/2.0',
    'scraper/1.0',
    'MyBot/2.0',
  ])('flags %s', (ua) => {
    expect(isLikelyBot(ua)).toBe(true);
  });

  it.each([CHROME_DESKTOP, FIREFOX_DESKTOP, SAFARI_DESKTOP])('does not flag %s', (ua) => {
    expect(isLikelyBot(ua)).toBe(false);
  });

  it('disagrees with the guard, and is not the guard', () => {
    // isLikelyBot matches a bare 'bot' anywhere, so a full Chrome UA with the
    // word appended is flagged. The *guard* allows the same string: it checks
    // isLegitimateBrowser first, and a UA with chrome/ and no named bot and no
    // compatible; block comes out a browser.
    //
    // Neither answer is wrong for its own job — but they differ, so a future
    // refactor must not "unify" them on the assumption that they agree.
    // `isLikelyBot` is exported from src/guard/index.ts and is not used by any
    // guard; it exists for callers who want the aggressive answer.
    const spoofy = `${CHROME_DESKTOP} bot`;
    expect(isLikelyBot(spoofy)).toBe(true);
    expect(blocksUA(spoofy), 'the guard trusts the browser tokens and allows it').toBe(false);
  });
});

describe('createCrawlerBotBlockGuard', () => {
  describe('search engine crawlers', () => {
    it.each([
      ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
      [
        'Googlebot Mobile',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3_1 like Mac OS X) AppleWebKit/602.1.50 (KHTML, like Gecko) Mobile/14E304 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      ],
      ['Bingbot', 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
      [
        'Baiduspider',
        'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
      ],
      ['YandexBot', 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'],
      [
        'Yahoo! Slurp',
        'Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)',
      ],
    ])('blocks %s', (_name, ua) => {
      expect(blocksUA(ua)).toBe(true);
    });
  });

  describe('social media crawlers', () => {
    it.each([
      ['Facebook external hit', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
      ['Twitterbot', 'Twitterbot/1.0'],
      ['LinkedInBot', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; +http://www.linkedin.com)'],
      ['Pinterest', 'Pinterest/0.2 (+http://www.pinterest.com/bot.html)'],
    ])('blocks %s', (_name, ua) => {
      expect(blocksUA(ua)).toBe(true);
    });
  });

  describe('SEO and monitoring tools', () => {
    it.each([
      ['AhrefsBot', 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)'],
      ['SemrushBot', 'Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)'],
      ['Screaming Frog', 'Screaming Frog SEO Spider/14.0'],
      [
        'Chrome Lighthouse',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Chrome-Lighthouse',
      ],
      ['Pingdom', 'Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)'],
    ])('blocks %s', (_name, ua) => {
      expect(blocksUA(ua)).toBe(true);
    });

    it('blocks Lighthouse specifically, so synthetic audits do not pollute analytics', () => {
      // Worth its own case: Lighthouse sends a complete, legitimate Chrome UA
      // with one token appended. It reaches the browser branch and is caught by
      // the named-bot check inside it -- the only reason that branch exists.
      expect(
        blocksUA(
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Chrome-Lighthouse',
        ),
      ).toBe(true);
    });
  });

  describe('generic patterns', () => {
    it.each([
      ['name/version bot', 'CustomBot/1.0'],
      ['name/version crawler', 'CustomCrawler/1.0'],
      ['name/version spider', 'CustomSpider/1.0'],
      ['MyBot', 'MyBot/2.0'],
      ['bare crawler', 'crawler/1.0'],
      ['too-short UA', 'Bot'],
      ['empty UA', ''],
      ['unbranded name/version', 'CustomAgent/1.0'],
    ])('blocks %s', (_name, ua) => {
      expect(blocksUA(ua)).toBe(true);
    });

    it('blocks a UA shorter than ten characters regardless of content', () => {
      expect(blocksUA('curl/8.4')).toBe(true);
      expect(blocksUA('x')).toBe(true);
    });
  });

  describe('legitimate browsers', () => {
    it.each([
      ['Chrome desktop', CHROME_DESKTOP],
      ['Firefox desktop', FIREFOX_DESKTOP],
      ['Safari desktop', SAFARI_DESKTOP],
      [
        'Edge desktop',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      ],
      [
        'Opera desktop',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0',
      ],
      [
        'Chrome Android',
        'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      ],
      [
        'Safari iOS',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ],
      ['Firefox Android', 'Mozilla/5.0 (Android 13; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0'],
      ['legacy IE 10', 'Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0)'],
      [
        'Chrome without a Safari token',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
      ],
    ])('allows %s', (_name, ua) => {
      expect(blocksUA(ua)).toBe(false);
    });
  });

  describe('spoofing', () => {
    it('blocks a bot that appends browser tokens to its own name', () => {
      expect(
        blocksUA(
          'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) AppleWebKit/537.36',
        ),
      ).toBe(true);
    });

    it('blocks an unrecognised identifier inside a compatible; block', () => {
      // The browser branch inspects what follows "compatible;": if it names no
      // OS or device, the agent is treated as suspicious. This is what catches
      // bots that mimic the IE-style UA without getting the details right.
      expect(blocksUA('Mozilla/5.0 (compatible; SomethingElse/1.0)')).toBe(true);
    });

    it('allows a real OS inside a compatible; block', () => {
      expect(blocksUA('Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0)')).toBe(
        false,
      );
    });
  });

  describe('known false negatives — asserted, not skipped', () => {
    /**
     * These three cases were `it.skip`ed in `botGuard.cy.ts` with comments
     * explaining that the guard does not catch them. A skip is invisible: it
     * neither documents the gap where anyone looks nor notices when it closes.
     * Asserting the current answer means improving the heuristic shows up here
     * as a failure to be consciously updated, and the gap is written down.
     *
     * **The cause is the bot pre-check itself, which is worth understanding
     * before anyone tries to fix it.** `isLegitimateBrowser` rejects
     * `compatible; XxxBot` via `/compatible;\s*[a-z]+bot/i` — so the UA is *not*
     * a browser, and the guard therefore never runs its browser branch. But that
     * branch is exactly the one that blocks an unrecognised identifier after
     * `compatible;`. Meanwhile the non-browser path only catches named bots and
     * bare `\bbot\b` words, and `SuspiciousBot` is neither.
     *
     * So the pre-check that correctly identifies these as non-browsers is what
     * routes them around the check that would have blocked them. A denylist
     * entry will not fix that; the browser branch's compatible;-inspection has
     * to move out of the browser branch.
     */
    it('does NOT block SuspiciousBot — the non-browser path has no compatible; check', () => {
      // botGuard.cy.ts recorded this twice and inconsistently: `it.skip` in one
      // place, and an assertion of `false` in the Multiple Bot Patterns table.
      // The table was right.
      expect(blocksUA('Mozilla/5.0 (compatible; SuspiciousBot/1.0)')).toBe(false);
    });

    it('does NOT block FakeBot, for the same reason', () => {
      expect(blocksUA('Mozilla/5.0 (compatible; FakeBot/1.0)')).toBe(false);
    });

    it('does NOT block an agent naming a real OS with no bot word', () => {
      // The other evasion shape, via the opposite route: this one *is* treated
      // as a browser, reaches the browser branch, and passes its compatible;
      // check because "windows nt" looks like a real OS. Closing it needs a
      // positive browser-token requirement, not another denylist entry.
      expect(blocksUA('Mozilla/5.0 (compatible; Harvester/1.0; Windows NT 10.0)')).toBe(false);
    });
  });
});
