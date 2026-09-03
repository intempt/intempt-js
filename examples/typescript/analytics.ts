/**
 * A typed wrapper around `window.intempt`.
 *
 * Worth the file for three reasons:
 *
 * 1. The SDK is blocked on localhost, for bot user agents, and by most ad blockers, so
 *    `window.intempt` may never appear. Every call site would otherwise need `?.`.
 * 2. Argument validation throws on your own stack. A mistyped event should not take down
 *    a checkout.
 * 3. It is a seam. Swap this module in tests and assert on calls instead of on the DOM.
 */

import type {
  IdentifyParams,
  Intempt,
  RecordParams,
  TrackParams,
} from './types/intempt';

/** Set from your own build config. Controls only whether swallowed errors are logged. */
const DEBUG = false;

function sdk(): Intempt | undefined {
  return typeof window === 'undefined' ? undefined : window.intempt;
}

/**
 * True once the real SDK has replaced the queue stub.
 *
 * Before this is true you can still call every method — the stub queues them and the SDK
 * replays them in order — but synchronous return values are not available.
 */
export function isReady(): boolean {
  const s = sdk();
  return s !== undefined && s._isStub !== true;
}

/** The loaded SDK version, or `undefined` if the stub is still in place. */
export function version(): string | undefined {
  return sdk()?.VERSION;
}

function safely(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    // eslint-disable-next-line no-console -- example code, printing is the point.
    if (DEBUG) console.warn(`[analytics] ${label} rejected the payload:`, err);
  }
}

export function track(eventTitle: string, data: Record<string, unknown>): void {
  const s = sdk();
  if (!s) return;
  safely('track', () => s.track({ eventTitle, data } satisfies TrackParams));
}

export function record(params: RecordParams): void {
  const s = sdk();
  if (!s) return;
  safely('record', () => s.record(params));
}

export function identify(params: IdentifyParams): void {
  const s = sdk();
  if (!s) return;
  safely('identify', () => s.identify(params));
}

export function group(
  accountId: string,
  eventTitle?: string,
  accountAttributes?: Record<string, unknown>,
): void {
  const s = sdk();
  if (!s) return;
  // The SDK requires an eventTitle whenever accountAttributes are present.
  safely('group', () => s.group({ accountId, eventTitle, accountAttributes }));
}


/**
 * Records a consent decision as an event. It does NOT stop collection — call `optOut()`
 * for that. Gated on the opt-out flag itself, so a re-consent flow must `optIn()` first
 * or the decision is silently dropped.
 */
export function recordConsent(
  action: 'accept' | 'reject',
  validUntilMs: number,
  extra: { email?: string; message?: string; category?: string } = {},
): void {
  const s = sdk();
  if (!s) return;
  if (action === 'accept') s.optIn();
  safely('consent', () =>
    s.consent({ action, validUntil: validUntilMs, ...extra }),
  );
  if (action === 'reject') s.optOut();
}

/**
 * Consent switches are deliberately NOT wrapped in `safely`. Swallowing an error here
 * would leave you believing a visitor opted out when they did not.
 */
export function optOut(): void {
  sdk()?.optOut();
}

export function optIn(): void {
  sdk()?.optIn();
}

/** `undefined` means "cannot tell yet" — not the same as opted out. */
export function isOptedIn(): boolean | undefined {
  return sdk()?.isUserOptIn();
}

/** Resets profile and session state. Call on sign-out. */
export function logOut(): void {
  sdk()?.logOut();
}

export function productView(productId: string): void {
  sdk()?.productView(productId);
}

export function productAdd(productId: string, quantity?: number): void {
  sdk()?.productAdd({ productId, quantity });
}

export function productOrdered(
  items: Array<{ productId: string; quantity?: number }>,
): void {
  sdk()?.productOrdered(items);
}

/**
 * Always resolves. The SDK resolves to `null` on a network error but *rejects* when the
 * response body is not JSON (a proxy error page, an empty 401), so both are handled.
 *
 * Note this call is NOT gated on the opt-out flag inside the SDK — the guard below is
 * ours, not the SDK's. Remove it only if your consent posture allows it.
 */
export async function recommend(
  id: number,
  quantity: number,
  fields: string[],
): Promise<unknown | null> {
  const s = sdk();
  if (!s) return null;
  if (isOptedIn() === false) return null;
  try {
    return (await s.recommendation({ id, quantity, fields })) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves once the real SDK has replaced the stub, or after `timeoutMs`.
 *
 * You rarely need this — the stub queues calls for you. It is here for the cases that
 * genuinely need a synchronous return value, such as reading `isUserOptIn()` to paint a
 * consent toggle in its correct initial state.
 */
export function whenReady(timeoutMs = 5000): Promise<boolean> {
  if (isReady()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = window.setInterval(() => {
      if (isReady()) {
        window.clearInterval(poll);
        resolve(true);
      } else if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(poll);
        resolve(false);
      }
    }, 50);
  });
}
