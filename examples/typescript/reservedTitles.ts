/**
 * Making the SDK's reserved event titles unrepresentable at compile time.
 *
 * This is a convenience, not a guarantee. It catches a reserved title written as a literal
 * in your source — the common mistake — and nothing else. The SDK's runtime guard remains
 * the contract; see docs/API.md, "Reserved event titles".
 *
 * What it cannot catch:
 *   - a title held in a `string` variable, where the literal type is gone
 *   - a case variant, since `Lowercase<T>` only helps when `T` is a literal
 */

export type ReservedTitle =
  | 'auto-track'
  | 'view page'
  | 'leave page'
  | 'change on'
  | 'click on'
  | 'submit on'
  | 'identify'
  | 'consent';

/** `never` for a reserved title (in any casing), otherwise `T` itself. */
export type AllowedTitle<T extends string> = Lowercase<T> extends ReservedTitle ? never : T;

export function trackSafe<T extends string>(
  eventTitle: AllowedTitle<T>,
  data: Record<string, unknown>,
): void {
  window.intempt?.track({ eventTitle, data });
}

// --- Proof that it behaves, checked by `npx tsc -p examples/typescript` ------------

trackSafe('Checkout Started', { cartId: 'c_1' });
trackSafe('consent banner shown', { variant: 'a' }); // allowed: not an exact match

// @ts-expect-error — 'click on' is reserved
trackSafe('click on', { a: 1 });

// @ts-expect-error — reserved titles are matched case-insensitively
trackSafe('Click On', { a: 1 });

// @ts-expect-error — 'identify' is reserved
trackSafe('identify', { a: 1 });

// The limit of the technique: a `string` has no literal type left to test, so this
// compiles and is caught only at runtime.
const titleFromConfig: string = 'click on';
trackSafe(titleFromConfig, { a: 1 });
