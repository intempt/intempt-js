/**
 * Hand-written declarations for `window.intempt`.
 *
 * The SDK does not publish types (there is no module build to attach them to), so this
 * file is the declaration you maintain in your own project. It mirrors
 * `src/intemptJs/types/intemptJs.types.ts` in the SDK, with two deliberate departures
 * noted inline.
 *
 * Copy this file into your project as e.g. `types/intempt.d.ts`. It needs no import to
 * take effect — any path covered by your tsconfig `include` works.
 */

export type ConsentAction = 'accept' | 'reject';

export interface IdentifyParams {
  /** Must be truthy at runtime: `''` and `0` are rejected by the SDK's guard. */
  userId: string;
  /** Required if you pass `userAttributes`. Must not be a reserved title. */
  eventTitle?: string;
  userAttributes?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface GroupParams {
  /** Rejected only if `undefined`/`null` at runtime — unlike `identify`, `''` passes. */
  accountId: string;
  /** Required if you pass `accountAttributes`. */
  eventTitle?: string;
  accountAttributes?: Record<string, unknown>;
}

export interface TrackParams {
  eventTitle: string;
  /** Must be a non-empty object. `{}` throws. */
  data: Record<string, unknown>;
}

export interface RecordParams {
  eventTitle: string;
  accountId?: string;
  userId?: string;
  accountAttributes?: Record<string, unknown>;
  userAttributes?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface ConsentParams {
  /** Case-sensitive at runtime: `'Accept'` throws. */
  action: ConsentAction;
  /** Declared required here to match the SDK's own type, but never validated at runtime. */
  validUntil: number;
  email?: string;
  message?: string;
  category?: string;
}

export interface ProductParams {
  productId: string;
  quantity?: number;
}

export interface RecommendationParams {
  /** Feed ID. */
  id: number;
  /** Sent to the API as `limit`. */
  quantity: number;
  fields: string[];
}

export interface Intempt {
  /** Present only on the real SDK — `undefined` while the queue stub is in place. */
  readonly VERSION?: string;
  /** `true` while the queue stub is in place. */
  readonly _isStub?: boolean;

  identify(params: IdentifyParams): void;
  group(params: GroupParams): void;
  track(params: TrackParams): void;
  record(params: RecordParams): void;
  consent(params: ConsentParams): void;

  productAdd(product: ProductParams): void;
  productView(productId: string): void;
  productOrdered(products: ProductParams[]): void;

  optIn(): void;
  optOut(): void;
  /**
   * Departure 1: typed `boolean | undefined`, not `boolean`. Through the queue stub this
   * returns `undefined`, and `!undefined` reads as "opted out" when it means "not ready".
   */
  isUserOptIn(): boolean | undefined;
  logOut(): void;

  /**
   * Resolves to the feed response, or `null` on a network error. Rejects if the response
   * body is not JSON — see docs/API.md.
   */
  recommendation(params: RecommendationParams): Promise<unknown>;
}

declare global {
  interface Window {
    /** Departure 2: optional. It is genuinely absent until the install snippet runs. */
    intempt?: Intempt;
  }
}
