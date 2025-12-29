import { SDK } from './loaders/sdkLoader.ts';
import { WEB_EDITOR } from './loaders/webEditorLoader.ts';
import { TrackingGuardManager } from './guard/trackingGuard.manager.ts';
import { shouldBlockTracking } from './guard/trackingGuard.checker.ts';
import { 
  createDomainBlockGuard, 
  createCrawlerBotBlockGuard 
} from './guard/trackingGuard.conditions.ts';

// Create global guard manager instance
const guardManager = new TrackingGuardManager();

// Register default guards (can be customized)
function setupDefaultGuards() {
  // Block on localhost
  guardManager.register({
    id: 'block-localhost',
    name: 'Block Localhost',
    description: 'Prevent tracking on localhost',
    condition: createDomainBlockGuard(['localhost', '127.0.0.1']),
    enabled: true
  });

  // Block crawler/bot user agents
  guardManager.register({
    id: 'block-crawler-bots',
    name: 'Block Crawler/Bot User Agents',
    description: 'Prevent tracking from crawlers, bots, and automated tools',
    condition: createCrawlerBotBlockGuard(),
    enabled: true
  });
}

// Initialize guards
setupDefaultGuards();

// Main initialization function
(async () => {
  const qs = new URLSearchParams(location.search);
  const openerOrigin = (qs.get('openerOrigin') || '').replace(/\/+$/, '');
  const channel      = qs.get('channel') || '';
  const cameFromOpener = Boolean(openerOrigin && channel);

  if(import.meta.env.VITE_ENV !== 'production') {
    console.log('ENVIRONMENT ',import.meta.env.VITE_ENV);
    console.log('version:', 'v6.0');
    console.log('cameFromOpener',cameFromOpener);
  }

  // Check guard conditions before initializing
  const blocked = await shouldBlockTracking(guardManager);
  
  if (blocked) {
    if(import.meta.env.VITE_ENV !== 'production') {
      console.log('[Intempt] Tracking blocked by guard conditions');
    }
    return; // Exit early, don't initialize SDK
  }

  // Guard check passed, proceed with initialization
  if (cameFromOpener) {
    WEB_EDITOR.init();
  } else {
    SDK.init();
  }
})();

// Export guard manager for external configuration (optional)
// This allows users to configure guards before SDK loads
if (typeof window !== 'undefined') {
  (window as any).__intemptGuardManager = guardManager;
}


