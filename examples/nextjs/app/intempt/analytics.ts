/**
 * The wrapper to put between the app and `window.intempt`, covering the whole
 * surface.
 *
 * Two things it exists for in a Next app specifically:
 *
 *  - `window` does not exist during server rendering, so every call has to go
 *    through a guard. Reaching for `window.intempt` directly in a component is
 *    the failure this prevents.
 *  - the loader is async. A call made before it lands would otherwise be a
 *    silent no-op; here it throws with a message naming the cause.
 *
 * The runtime rules encoded below are the SDK's, not inventions: each one is a
 * guard in `intemptJs.guard.ts` that throws.
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
      'Intempt is not loaded yet. Check the next/script tag in app/layout.tsx.',
    );
  }
  return window.intempt;
}

export const analytics = {
  // ---- identity ----

  /** `userId` must be truthy: the SDK rejects `''`. */
  identify(userId: string, traits?: Record<string, unknown>) {
    sdk().identify({ userId, userAttributes: traits });
  },

  /** Links an anonymous id to an authenticated one. */
  alias(userId: string, anotherUserId: string) {
    sdk().alias({ userId, anotherUserId });
  },

  group(accountId: string, accountAttributes?: Record<string, unknown>) {
    sdk().group({ accountId, accountAttributes });
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
   * `action` is case-sensitive: `'Accept'` throws. `validUntil` is an epoch
   * value, declared required to match the SDK's type though never validated.
   */
  consent(
    action: ConsentAction,
    validUntil: number,
    details: { email?: string; message?: string; category?: string } = {},
  ) {
    sdk().consent({ action, validUntil, ...details });
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

  /** `undefined` while the queue stub is still in place, before the SDK lands. */
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
