/**
 * Context data available to guard conditions at initialization
 */
export interface GuardContext {
  url: string;
  hostname: string;
  pathname: string;
  userAgent: string;
  referrer: string;
  timestamp: number;
  searchParams: URLSearchParams;
}

/**
 * Guard condition function
 * Returns true if tracking should be BLOCKED (SDK should not initialize)
 * Returns false if tracking should be ALLOWED (SDK can initialize)
 */
export type GuardCondition = (context: GuardContext) => boolean | Promise<boolean>;

/**
 * Guard configuration
 */
export interface GuardConfig {
  id: string;
  name?: string;
  description?: string;
  condition: GuardCondition;
  enabled?: boolean;
}

/**
 * Guard evaluation result
 */
export interface GuardResult {
  blocked: boolean;
  guardId?: string;
  reason?: string;
}

