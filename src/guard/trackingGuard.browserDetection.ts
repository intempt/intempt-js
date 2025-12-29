/**
 * Browser detection patterns based on useragentstring.com
 * These patterns identify legitimate browsers
 */
export function isLegitimateBrowser(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  
  // First check: Exclude known bots even if they have browser-like patterns
  // Check for specific bot names first (before checking browser patterns)
  const knownBotPatterns = [
    /\bgooglebot\b/i,
    /\bbingbot\b/i,
    /\bbaiduspider\b/i,
    /\byandexbot\b/i,
    /\bslurp\b/i,
    /compatible;\s*[a-z]+bot/i,  // Pattern: "compatible; Googlebot"
    /compatible;\s*[a-z]+spider/i, // Pattern: "compatible; Baiduspider"
  ];
  
  // If it matches known bot patterns, it's not a browser
  if (knownBotPatterns.some(pattern => pattern.test(userAgent))) {
    return false;
  }
  
  // Also check for generic bot indicators in compatible strings
  if (ua.includes('compatible;')) {
    const compatiblePart = ua.split('compatible;')[1] || '';
    if (/\b(bot|crawler|spider|scraper)\b/i.test(compatiblePart)) {
      return false; // It's a bot
    }
  }
  
  // Major browser engines and identifiers
  const browserPatterns = [
    // Chrome and Chromium-based browsers
    'chrome/',
    'crios/',        // Chrome iOS
    'edg/',          // Edge (Chromium-based)
    'edge/',         // Edge (Legacy)
    'chromium/',
    
    // Firefox and Gecko-based
    'firefox/',
    'fxios/',        // Firefox iOS
    'gecko/',        // Firefox engine
    
    // Safari and WebKit-based
    'safari/',
    'version/',      // Safari version indicator
    'webkit/',       // WebKit engine
    
    // Opera
    'opr/',          // Opera
    'opera/',
    'opios/',        // Opera iOS
    'presto/',       // Old Opera engine
    
    // Internet Explorer / Legacy
    'msie',
    'trident/',
    'iemobile',
    
    // Mobile browsers
    'samsungbrowser/',
    'ucbrowser',
    'ucweb',
    'whale/',
    
    // Other legitimate browsers
    'konqueror',
    'applewebkit/',  // WebKit browsers
  ];
  
  // Check if it contains browser patterns
  const hasBrowserPattern = browserPatterns.some(pattern => 
    ua.includes(pattern)
  );
  
  // Additional validation: Mozilla string with no obvious bot indicators
  const hasMozilla = ua.includes('mozilla/5.0') || ua.includes('mozilla/4.0');
  const hasNoObviousBot = !/\b(bot|crawler|spider|scraper)\b/i.test(ua);
  
  return hasBrowserPattern || (hasMozilla && hasNoObviousBot);
}

/**
 * Check if user agent is likely a bot/crawler
 * More conservative check that avoids false positives
 */
export function isLikelyBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  
  // Very specific bot indicators
  const botIndicators = [
    // Search engine bots (specific)
    'googlebot',
    'bingbot',
    'baiduspider',
    'yandexbot',
    'slurp',
    
    // Bot-specific patterns
    '/bot',
    'bot/',
    'crawler/',
    'spider/',
    'scraper/',
    
    // Bot in user agent (with word boundaries)
    /\b(bot|crawler|spider|scraper)\b/i
  ];
  
  return botIndicators.some(indicator => {
    if (typeof indicator === 'string') {
      return ua.includes(indicator);
    }
    return indicator.test(ua);
  });
}

