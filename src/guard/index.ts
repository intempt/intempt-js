// Export all guard-related types and classes
export { TrackingGuardManager } from './trackingGuard.manager.ts';
export { shouldBlockTracking, createGuardContext } from './trackingGuard.checker.ts';
export {
  createDomainBlockGuard,
  createPathBlockGuard,
  createUrlPatternBlockGuard,
  createUserAgentBlockGuard,
  createQueryParamBlockGuard,
  createCookieGuard,
  createLocalStorageGuard,
  createTimeBlockGuard,
  createCrawlerBotBlockGuard,
  createCustomGuard
} from './trackingGuard.conditions.ts';
export {
  isLegitimateBrowser,
  isLikelyBot
} from './trackingGuard.browserDetection.ts';
export type {
  GuardContext,
  GuardCondition,
  GuardConfig,
  GuardResult
} from './trackingGuard.types.ts';

