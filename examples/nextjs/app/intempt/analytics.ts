/**
 * The wrapper to put between the app and `window.intempt`, covering the whole
 * surface.
 *
 * Two things it exists for in a Next app specifically:
 *
 *  - `window` does not exist during server rendering, so every call has to go
 *    through a guard. Reaching for `window.intempt` directly in a component is
 *    the failure this prevents.
 *  - the loader is async. Calls made before it lands go to the queue stub in
 *    `app/layout.tsx` and replay; `sdk()` still throws if the SDK never
 *    installs at all, which is what happens on `localhost`.
 *
 * Every runtime rule encoded below is a guard in
 * `src/intemptJs/guards/intemptJs.guard.ts` that throws. They are not
 * suggestions: an `identify` carrying `userAttributes` without an `eventTitle`
 * raises "set 'eventTitle' to use 'userAttributes'" and nothing is sent.
 */
import type {
  ConsentAction,
  ProductParams,
  RecommendationParams,
} from './intempt';

function sdk(): NonNullable<Window['intempt']> {
  if (typeof window === 'undefined') {
    throw new Error(
      'Intempt was called during server rendering. Move the call into a client component.',
    );
  }
  if (!window.intempt) {
    throw new Error(
      'Intempt is not installed. Either the loader in app/layout.tsx has not run, ' +
        'or you are on localhost — the SDK blocks localhost and 127.0.0.1 by default, ' +
        'so it never assigns window.intempt there. Use a staging hostname.',
    );
  }
  return window.intempt;
}

export const analytics = {
  // ---- identity ----

  /**
   * `eventTitle` is required whenever `traits` are passed — the SDK throws
   * otherwise. `userId` must also be truthy: `''` is rejected.
   */
  identify(
    userId: string,
    traits?: Record<string, unknown>,
    eventTitle = 'Identify user',
  ) {
    sdk().identify({
      userId,
      ...(traits ? { eventTitle, userAttributes: traits } : {}),
    });
  },

  /** Links an anonymous id to an authenticated one. */
  alias(userId: string, anotherUserId: string) {
    sdk().alias({ userId, anotherUserId });
  },

  /** Same `eventTitle` rule as `identify`, for `accountAttributes`. */
  group(
    accountId: string,
    accountAttributes?: Record<string, unknown>,
    eventTitle = 'Identify account',
  ) {
    sdk().group({
      accountId,
      ...(accountAttributes ? { eventTitle, accountAttributes } : {}),
    });
  },

  // ---- events ----

  /** `data` must be non-empty — the SDK throws on `{}`. */
  track(eventTitle: string, data: Record<string, unknown>) {
    sdk().track({ eventTitle, data });
  },

  /** Like `track`, but carries identity on the event itself. */
  record(
    eventTitle: string,
    context: {
      userId?: string;
      accountId?: string;
      userAttributes?: Record<string, unknown>;
      accountAttributes?: Record<string, unknown>;
      data?: Record<string, unknown>;
    } = {},
  ) {
    sdk().record({ eventTitle, ...context });
  },

  // ---- consent ----

  /**
   * Records the decision AND flips the collection switch.
   *
   * `consent()` alone does not stop tracking — the SDK collects by default, so
   * a banner that only records a rejection carries on sending events. The pair
   * has to happen in this order: `optIn()` before an accept, because `consent()`
   * is itself gated on the opt-out flag and would be dropped; `optOut()` after a
   * reject, so the record reaches the server before collection stops.
   *
   * `validUntil` is epoch **milliseconds**.
   */
  consent(
    action: ConsentAction,
    validUntilMs: number,
    details: { email?: string; message?: string; category?: string } = {},
  ) {
    const intempt = sdk();
    if (action === 'accept') intempt.optIn();
    intempt.consent({ action, validUntil: validUntilMs, ...details });
    if (action === 'reject') intempt.optOut();
  },

  // ---- commerce ----

  productAdd(product: ProductParams) {
    sdk().productAdd(product);
  },

  /** Takes a bare string, not an object — the one asymmetry in the surface. */
  productView(productId: string) {
    sdk().productView(productId);
  },

  productOrdered(products: ProductParams[]) {
    sdk().productOrdered(products);
  },

  // ---- privacy ----

  optIn() {
    sdk().optIn();
  },

  optOut() {
    sdk().optOut();
  },

  /** `undefined` while the queue stub is still standing in for the SDK. */
  isUserOptIn(): boolean | undefined {
    return sdk().isUserOptIn();
  },

  // ---- session ----

  /** Resets profile and session state. Call on logout, not on navigation. */
  logOut() {
    sdk().logOut();
  },

  // ---- decisions ----

  recommendation(params: RecommendationParams): Promise<unknown> {
    return sdk().recommendation(params);
  },
};
