import { TrackingGuardManager } from './trackingGuard.manager.ts';
import { GuardContext } from './trackingGuard.types.ts';

/**
 * Create guard context from current page state
 */
export function createGuardContext(): GuardContext {
  return {
    url: window.location.href,
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    userAgent: navigator.userAgent,
    referrer: document.referrer,
    timestamp: Date.now(),
    searchParams: new URLSearchParams(window.location.search),
  };
}

/**
 * Check if tracking should be blocked
 * This is the main function to call in main.ts
 */
export async function shouldBlockTracking(
  guardManager: TrackingGuardManager
): Promise<boolean> {
  const context = createGuardContext();
  const result = await guardManager.evaluate(context);
  return result.blocked;
}

