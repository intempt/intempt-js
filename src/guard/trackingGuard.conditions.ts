import { GuardCondition, GuardContext } from './trackingGuard.types.ts';
import { isLegitimateBrowser } from './trackingGuard.browserDetection.ts';

/**
 * Block tracking on specific domains
 */
export function createDomainBlockGuard(blockedDomains: string[]): GuardCondition {
  return (context: GuardContext): boolean => {
    const hostname = context.hostname.toLowerCase();
    return blockedDomains.some(domain => 
      hostname === domain.toLowerCase() || 
      hostname.endsWith('.' + domain.toLowerCase())
    );
  };
}

/**
 * Block tracking on specific paths
 */
export function createPathBlockGuard(blockedPaths: string[]): GuardCondition {
  return (context: GuardContext): boolean => {
    const pathname = context.pathname.toLowerCase();
    return blockedPaths.some(path => 
      pathname.startsWith(path.toLowerCase()) ||
      pathname === path.toLowerCase()
    );
  };
}

/**
 * Block tracking based on URL pattern (regex)
 */
export function createUrlPatternBlockGuard(pattern: RegExp): GuardCondition {
  return (context: GuardContext): boolean => {
    return pattern.test(context.url);
  };
}

/**
 * Block tracking for specific user agents
 */
export function createUserAgentBlockGuard(blockedUserAgents: string[]): GuardCondition {
  return (context: GuardContext): boolean => {
    const userAgent = context.userAgent.toLowerCase();
    return blockedUserAgents.some(ua => 
      userAgent.includes(ua.toLowerCase())
    );
  };
}

/**
 * Block tracking if URL contains specific query parameter
 */
export function createQueryParamBlockGuard(paramName: string, value?: string): GuardCondition {
  return (context: GuardContext): boolean => {
    const paramValue = context.searchParams.get(paramName);
    if (value === undefined) {
      return paramValue !== null; // Block if param exists
    }
    return paramValue === value; // Block if value matches
  };
}

/**
 * Block tracking if cookie exists/has specific value
 */
export function createCookieGuard(cookieName: string, value?: string): GuardCondition {
  return (context: GuardContext): boolean => {
    const cookies = document.cookie.split(';');
    const cookie = cookies.find(c => 
      c.trim().startsWith(cookieName + '=')
    );
    
    if (!cookie) {
      return false; // Cookie doesn't exist, allow tracking
    }
    
    if (value === undefined) {
      return true; // Cookie exists, block tracking
    }
    
    const cookieValue = cookie.split('=')[1]?.trim();
    return cookieValue === value; // Block if value matches
  };
}

/**
 * Block tracking if localStorage key exists/has specific value
 */
export function createLocalStorageGuard(key: string, value?: string): GuardCondition {
  return (context: GuardContext): boolean => {
    try {
      const stored = localStorage.getItem(key);
      if (value === undefined) {
        return stored !== null; // Block if key exists
      }
      return stored === value; // Block if value matches
    } catch {
      return false; // Allow tracking if localStorage access fails
    }
  };
}

/**
 * Block tracking during specific time periods
 */
export function createTimeBlockGuard(
  startHour: number,
  endHour: number
): GuardCondition {
  return (context: GuardContext): boolean => {
    const now = new Date();
    const hour = now.getHours();
    
    // Handle overnight periods (e.g., 22:00 - 06:00)
    if (startHour > endHour) {
      return hour >= startHour || hour < endHour;
    }
    
    return hour >= startHour && hour < endHour;
  };
}

/**
 * Block tracking for crawler/bot user agents
 * Improved version that whitelists legitimate browsers
 */
export function createCrawlerBotBlockGuard(): GuardCondition {
  // Specific bot/crawler names (no generic terms)
  const BLOCKED_CRAWLER_UA_STRS = [
    // Search Engine Crawlers
    'ahrefsbot',
    'ahrefssiteaudit',
    'amazonbot',
    'baiduspider',
    'bingbot',
    'bingpreview',
    'googlebot',
    'petalbot',
    'sogou',
    'yandexbot',
    'yandeximages',
    'yahoo! slurp',
    'yahoo! slurp china',
    'yahooseeker',
    
    // Google-specific crawlers
    'adsbot-google',
    'apis-google',
    'duplexweb-google',
    'feedfetcher-google',
    'google favicon',
    'google web preview',
    'google-read-aloud',
    'googleweblight',
    'mediapartners-google',
    'storebot-google',
    
    // Social Media Crawlers
    'facebookexternal',
    'facebookcatalog',
    'pinterest',
    'twitterbot',
    'linkedinbot',
    'slackbot',
    
    // SEO/Testing Tools
    'chrome-lighthouse',  // Keep this - it's a testing tool, not a browser
    'screaming frog',
    'semrushbot',
    'mj12bot',
    'dotbot',
    'megaindex',
    'ahrefs',
    
    // Other Common Bots (specific names only)
    '008',
    'abachobot',
    'accoona-ai-agent',
    'addsugarsiderbot',
    'anyapexbot',
    'arachmo',
    'b-l-i-t-z-b-o-t',
    'becomebot',
    'beslistbot',
    'billybobbot',
    'bimbot',
    'blitzbot',
    'boitho.com-dc',
    'boitho.com-robot',
    'btbot',
    'catchbot',
    'cerberian drtrs',
    'yacybot',
    'zao',
    'zealbot',
    'zspider',
    'zyborg',
    'yeti',
    'yodao',
    'youdao',
    'yooglifetchagent',
    
    // Monitoring/Testing Tools (specific)
    'pingdom',
    'uptimerobot',
    
    // REMOVED generic terms: 'monitor', 'crawler', 'spider', 'bot', 'scraper', 'crawling'
    // These will be handled by pattern matching below
  ];

  return (context: GuardContext): boolean => {
    const userAgent = context.userAgent.toLowerCase();
    
    // Step 1: Check if it's a legitimate browser first
    if (isLegitimateBrowser(context.userAgent)) {
      // It's a browser, but double-check for obvious bots
      // Some bots spoof browser user agents
      const hasObviousBot = BLOCKED_CRAWLER_UA_STRS.some(crawler => 
        userAgent.includes(crawler.toLowerCase())
      );
      
      if (hasObviousBot) {
        return true; // Block bots with specific names
      }
      
      // Additional check: Look for suspicious patterns even in browser-like UAs
      // Check for "compatible;" followed by non-browser identifiers
      if (userAgent.includes('compatible;')) {
        const compatiblePart = userAgent.split('compatible;')[1] || '';
        // If compatible part doesn't look like a real browser/OS, might be a bot
        const looksLikeRealBrowser = /(windows|macintosh|linux|x11|android|iphone|ipad)/i.test(compatiblePart);
        if (!looksLikeRealBrowser && compatiblePart.trim().length > 0) {
          // Suspicious - might be a bot
          return true;
        }
      }
      
      return false; // Allow legitimate browsers
    }
    
    // Step 2: Not a browser - check for specific bot names
    const matchesSpecificBot = BLOCKED_CRAWLER_UA_STRS.some(crawler => 
      userAgent.includes(crawler.toLowerCase())
    );
    
    if (matchesSpecificBot) {
      return true; // Block specific bots
    }
    
    // Step 3: Check for generic bot patterns (only if not a browser)
    // Use word boundaries to avoid false matches
    const genericBotPattern = /\b(bot|crawler|spider|scraper)\b/i;
    if (genericBotPattern.test(userAgent)) {
      // Additional check: exclude if it looks like a browser despite having "bot"
      // Some legitimate tools might have "bot" in their name
      const hasBrowserLikePattern = /(chrome|firefox|safari|edge|opera|webkit|gecko)/i.test(userAgent);
      return !hasBrowserLikePattern;
    }
    
    // Step 4: Check for other suspicious patterns
    // Empty or very short user agents
    if (userAgent.length < 10) {
      return true;
    }
    
    // No browser indicators at all
    const hasAnyBrowserIndicator = /(mozilla|webkit|gecko|trident|presto)/i.test(userAgent);
    if (!hasAnyBrowserIndicator && userAgent.length > 0) {
      // Might be a bot, but be conservative
      // Block if it has obvious bot-like structure (name/version pattern)
      const botLikePattern = /^[a-z]+\/[0-9]+(\.[0-9]+)*\s*$/i.test(userAgent.trim());
      if (botLikePattern) {
        return true; // Pattern like "CustomCrawler/1.0" or "bot/1.0"
      }
      
      // Also block if it contains "crawler" or "spider" without browser indicators
      if (/\b(crawler|spider)\b/i.test(userAgent)) {
        return true;
      }
    }
    
    return false; // Default: allow
  };
}

/**
 * Block tracking based on custom function
 */
export function createCustomGuard(
  condition: (context: GuardContext) => boolean
): GuardCondition {
  return condition;
}

