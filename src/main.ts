// Import EnvConfig first to ensure it's initialized before other modules
import { EnvConfig } from './shared/envConfig.ts';
import { SDK_VERSION } from './shared/version.ts';
import { SDK } from './loaders/sdkLoader.ts';
import { WEB_EDITOR } from './loaders/webEditorLoader.ts';
import { TrackingGuardManager } from './guard/trackingGuard.manager.ts';
import { shouldBlockTracking } from './guard/trackingGuard.checker.ts';
import {
  createDomainBlockGuard,
  createCrawlerBotBlockGuard,
} from './guard/trackingGuard.conditions.ts';

import { createLogger } from './shared/logger/logger.ts';

const log = createLogger('Intempt');

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
    enabled: true,
  });

  // Block crawler/bot user agents
  guardManager.register({
    id: 'block-crawler-bots',
    name: 'Block Crawler/Bot User Agents',
    description: 'Prevent tracking from crawlers, bots, and automated tools',
    condition: createCrawlerBotBlockGuard(),
    enabled: true,
  });
}

// Initialize guards
setupDefaultGuards();

/**
 * D-21: this is INTERNAL, for inspection and tests — it is NOT a configuration
 * hook, despite what the comment here used to claim.
 *
 * The bootstrap below starts during this module's evaluation and its first `await`
 * resolves in a microtask, i.e. before any subsequent `<script>` on the page can
 * run. So a host page has no window in which to register or disable a guard: by
 * the time it sees `window.__intemptGuardManager`, `shouldBlockTracking` has
 * already decided. Registering afterwards mutates a manager nothing will consult
 * again.
 *
 * It is assigned here, ahead of the bootstrap, rather than at the foot of the file,
 * so it at least exists for the whole of the SDK's own startup.
 *
 * Making it a real hook means giving the bootstrap something to await — a promise
 * the host resolves, or a documented `window.intemptGuards` array read before the
 * check. Both delay every page's first event and are a product decision, not a
 * drive-by; see DEFECTS.md D-21. Until then, treat the name's `__` prefix as
 * meaning what it says.
 */
if (typeof window !== 'undefined') {
  (window as any).__intemptGuardManager = guardManager;
}

// Main initialization function
(async () => {
  const qs = new URLSearchParams(location.search);
  const openerOrigin = (qs.get('openerOrigin') || '').replace(/\/+$/, '');
  const channel = qs.get('channel') || '';
  const cameFromOpener = Boolean(openerOrigin && channel);

  log.debug(`environment ${EnvConfig.getEnv()}, version ${SDK_VERSION}`, {
    cameFromOpener,
  });

  // Check guard conditions before initializing
  const blocked = await shouldBlockTracking(guardManager);

  if (blocked) {
    log.info('tracking blocked by guard conditions');
    return; // Exit early, don't initialize SDK
  }

  // Guard check passed, proceed with initialization
  if (cameFromOpener) {
    WEB_EDITOR.init();
  } else {
    SDK.init();
  }
})();
