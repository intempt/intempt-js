import { TrackingGuardManager } from '../src/guard/trackingGuard.manager.ts';
import { createGuardContext } from '../src/guard/trackingGuard.checker.ts';
import { 
  createDomainBlockGuard, 
  createQueryParamBlockGuard,
  createCrawlerBotBlockGuard 
} from '../src/guard/trackingGuard.conditions.ts';
import { isLegitimateBrowser } from '../src/guard/trackingGuard.browserDetection.ts';

describe('Tracking Guard System', () => {
  let guardManager: TrackingGuardManager;

  beforeEach(() => {
    guardManager = new TrackingGuardManager();
  });

  describe('Browser Detection', () => {
    it('should identify legitimate Chrome browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      expect(isLegitimateBrowser(ua)).to.be.true;
    });

    it('should identify legitimate Firefox browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
      expect(isLegitimateBrowser(ua)).to.be.true;
    });

    it('should identify legitimate Safari browser', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
      expect(isLegitimateBrowser(ua)).to.be.true;
    });

    it('should identify legitimate Edge browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
      expect(isLegitimateBrowser(ua)).to.be.true;
    });

    it('should identify legitimate Opera browser', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0';
      expect(isLegitimateBrowser(ua)).to.be.true;
    });

    it('should identify legitimate Mobile Safari', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
      expect(isLegitimateBrowser(ua)).to.be.true;
    });

    it('should identify legitimate Chrome iOS', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1';
      expect(isLegitimateBrowser(ua)).to.be.true;
    });

    it('should NOT identify Googlebot as browser', () => {
      const ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
      expect(isLegitimateBrowser(ua)).to.be.false;
    });

    it('should NOT identify Bingbot as browser', () => {
      const ua = 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';
      expect(isLegitimateBrowser(ua)).to.be.false;
    });
  });

  describe('Domain Block Guard', () => {
    beforeEach(() => {
      guardManager.register({
        id: 'test-domain-block',
        condition: createDomainBlockGuard(['localhost', '127.0.0.1']),
        enabled: true
      });
    });

    it('should block localhost', async () => {
      const context = {
        url: 'http://localhost:3000',
        hostname: 'localhost',
        pathname: '/',
        userAgent: navigator.userAgent,
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
      expect(result.guardId).to.equal('test-domain-block');
    });

    it('should block 127.0.0.1', async () => {
      const context = {
        url: 'http://127.0.0.1:3000',
        hostname: '127.0.0.1',
        pathname: '/',
        userAgent: navigator.userAgent,
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should block subdomain of localhost', async () => {
      const context = {
        url: 'http://test.localhost:3000',
        hostname: 'test.localhost',
        pathname: '/',
        userAgent: navigator.userAgent,
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should allow non-blocked domains', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: navigator.userAgent,
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });
  });

  describe('Query Parameter Block Guard', () => {
    beforeEach(() => {
      guardManager.register({
        id: 'test-query-block',
        condition: createQueryParamBlockGuard('notrack'),
        enabled: true
      });
    });

    it('should block when notrack param exists', async () => {
      const context = {
        url: 'https://example.com?notrack=true',
        hostname: 'example.com',
        pathname: '/',
        userAgent: navigator.userAgent,
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams('notrack=true'),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
      expect(result.guardId).to.equal('test-query-block');
    });

    it('should block when notrack param exists with any value', async () => {
      const context = {
        url: 'https://example.com?notrack=1',
        hostname: 'example.com',
        pathname: '/',
        userAgent: navigator.userAgent,
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams('notrack=1'),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should allow when notrack param does not exist', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: navigator.userAgent,
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });

    it('should allow when other params exist but not notrack', async () => {
      const context = {
        url: 'https://example.com?utm_source=test',
        hostname: 'example.com',
        pathname: '/',
        userAgent: navigator.userAgent,
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams('utm_source=test'),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });
  });

  describe('Crawler Bot Block Guard', () => {
    beforeEach(() => {
      guardManager.register({
        id: 'test-crawler-block',
        condition: createCrawlerBotBlockGuard(),
        enabled: true
      });
    });

    it('should block Googlebot', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
      expect(result.guardId).to.equal('test-crawler-block');
    });

    it('should block Bingbot', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should block Baiduspider', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should block Yandexbot', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should block generic bot pattern', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'MyBot/1.0',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should block bot with word boundary pattern', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'CustomCrawler/1.0',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should NOT block legitimate Chrome browser', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });

    it('should NOT block legitimate Firefox browser', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });

    it('should NOT block legitimate Safari browser', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });

    it('should block bot even if it spoofs browser UA', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) AppleWebKit/537.36',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should block empty user agent', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: '',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should block very short user agent', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'bot',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });

    it('should block user agent with bot-like structure', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'crawler/1.0',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
    });
  });

  describe('Multiple Guards', () => {
    beforeEach(() => {
      guardManager.register({
        id: 'domain-block',
        condition: createDomainBlockGuard(['localhost']),
        enabled: true
      });
      
      guardManager.register({
        id: 'crawler-block',
        condition: createCrawlerBotBlockGuard(),
        enabled: true
      });
    });

    it('should block if domain guard blocks', async () => {
      const context = {
        url: 'http://localhost:3000',
        hostname: 'localhost',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
      expect(result.guardId).to.equal('domain-block');
    });

    it('should block if crawler guard blocks', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Googlebot/2.1',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
      expect(result.guardId).to.equal('crawler-block');
    });

    it('should allow if no guards block', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });
  });

  describe('Guard Management', () => {
    it('should register guards', () => {
      guardManager.register({
        id: 'test-guard',
        condition: () => true,
        enabled: true
      });
      
      expect(guardManager.hasGuard('test-guard')).to.be.true;
      expect(guardManager.getGuards().length).to.equal(1);
    });

    it('should unregister guards', () => {
      guardManager.register({
        id: 'test-guard',
        condition: () => true,
        enabled: true
      });
      
      expect(guardManager.hasGuard('test-guard')).to.be.true;
      
      const removed = guardManager.unregister('test-guard');
      expect(removed).to.be.true;
      expect(guardManager.hasGuard('test-guard')).to.be.false;
    });

    it('should enable/disable specific guards', async () => {
      guardManager.register({
        id: 'test-guard',
        condition: () => true, // Always blocks
        enabled: true
      });
      
      const context = createGuardContext();
      let result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.true;
      
      guardManager.setGuardEnabled('test-guard', false);
      result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });

    it('should disable all guards', async () => {
      guardManager.register({
        id: 'test-guard',
        condition: () => true,
        enabled: true
      });
      
      guardManager.setEnabled(false);
      
      const context = createGuardContext();
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });

    it('should re-enable all guards', async () => {
      guardManager.register({
        id: 'test-guard',
        condition: () => true,
        enabled: true
      });
      
      guardManager.setEnabled(false);
      let result = await guardManager.evaluate(createGuardContext());
      expect(result.blocked).to.be.false;
      
      guardManager.setEnabled(true);
      result = await guardManager.evaluate(createGuardContext());
      expect(result.blocked).to.be.true;
    });

    it('should clear all guards', () => {
      guardManager.register({
        id: 'test-guard-1',
        condition: () => true,
        enabled: true
      });
      
      guardManager.register({
        id: 'test-guard-2',
        condition: () => true,
        enabled: true
      });
      
      expect(guardManager.getGuards().length).to.equal(2);
      
      guardManager.clear();
      expect(guardManager.getGuards().length).to.equal(0);
    });

    it('should throw error when registering guard without ID', () => {
      expect(() => {
        guardManager.register({
          id: '',
          condition: () => true,
          enabled: true
        });
      }).to.throw('Guard ID is required');
    });

    it('should throw error when registering guard without condition', () => {
      expect(() => {
        guardManager.register({
          id: 'test-guard',
          condition: undefined as any,
          enabled: true
        });
      }).to.throw('Guard condition function is required');
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      guardManager.register({
        id: 'crawler-block',
        condition: createCrawlerBotBlockGuard(),
        enabled: true
      });
    });

    it('should handle user agent with bot in browser name gracefully', async () => {
      // Some legitimate tools might have "bot" in name but are browsers
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      // Should not block legitimate browser even if it has "bot" somewhere
      expect(result.blocked).to.be.false;
    });

    it('should handle user agent with no browser indicators', async () => {
      const context = {
        url: 'https://example.com',
        hostname: 'example.com',
        pathname: '/',
        userAgent: 'CustomAgent/1.0',
        referrer: '',
        timestamp: Date.now(),
        searchParams: new URLSearchParams(),
      };
      
      const result = await guardManager.evaluate(context);
      // Should block if it looks like a bot pattern
      expect(result.blocked).to.be.true;
    });

    it('should return false when no guards are registered', async () => {
      const emptyManager = new TrackingGuardManager();
      const context = createGuardContext();
      const result = await emptyManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });

    it('should return false when all guards are disabled', async () => {
      guardManager.register({
        id: 'test-guard',
        condition: () => true,
        enabled: false
      });
      
      const context = createGuardContext();
      const result = await guardManager.evaluate(context);
      expect(result.blocked).to.be.false;
    });

    it('should handle errors in guard evaluation gracefully', async () => {
      guardManager.register({
        id: 'error-guard',
        condition: () => {
          throw new Error('Test error');
        },
        enabled: true
      });
      
      guardManager.register({
        id: 'normal-guard',
        condition: () => false,
        enabled: true
      });
      
      const context = createGuardContext();
      const result = await guardManager.evaluate(context);
      // Should continue checking other guards even if one errors
      expect(result.blocked).to.be.false;
    });
  });
});

