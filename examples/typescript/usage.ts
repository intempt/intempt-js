/**
 * Call sites for the wrapper in `analytics.ts`, and the four traps the type system will
 * not catch for you.
 *
 * This file type-checks; the lines under "Runtime failures" are commented out because
 * they compile cleanly and fail only when they run.
 */

import * as analytics from './analytics';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export function onSignIn(user: {
  id: string;
  email: string;
  plan: string;
}): void {
  analytics.identify({
    userId: user.id,
    eventTitle: 'Signed In',
    // userAttributes require an eventTitle. Passing them without one throws.
    userAttributes: { email: user.email, plan: user.plan },
  });
}

export function onSignUp(newUserId: string): void {
  analytics.identify({ userId: newUserId });
}

export function onSignOut(): void {
  // Resets profile and session so the next visitor is not attributed to this user.
  analytics.logOut();
}

export function onJoinWorkspace(workspace: { id: string; name: string }): void {
  analytics.group(workspace.id, 'Workspace Joined', { name: workspace.name });
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function onExport(format: 'csv' | 'pdf', rowCount: number): void {
  analytics.track('Dashboard Exported', { format, rowCount });
}

export function onFeatureUsed(userId: string, feature: string): void {
  // `record` takes user/account context inline and does not require `data`.
  analytics.record({ eventTitle: 'Feature Used', userId, data: { feature } });
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function onConsentBannerAccept(email?: string): void {
  analytics.recordConsent('accept', Date.now() + ONE_YEAR_MS, {
    email,
    category: 'analytics',
  });
}

export function onConsentBannerReject(): void {
  // Records the decision, then stops collection. Order matters: `consent()` is itself
  // gated on the opt-out flag, so opting out first would drop the event.
  analytics.recordConsent('reject', Date.now() + ONE_YEAR_MS);
}

/**
 * Painting a toggle in its correct initial state is the one case that genuinely needs to
 * wait for the SDK: through the queue stub, `isUserOptIn()` returns `undefined`.
 */
export async function paintConsentToggle(el: HTMLInputElement): Promise<void> {
  const ready = await analytics.whenReady();
  if (!ready) {
    // The SDK never loaded — blocked on localhost, by a bot guard, or by an ad blocker.
    el.disabled = true;
    return;
  }
  el.checked = analytics.isOptedIn() === true;
}

// ---------------------------------------------------------------------------
// Commerce and recommendations
// ---------------------------------------------------------------------------

export function onProductPage(productId: string): void {
  analytics.productView(productId);
}

export function onAddToCart(productId: string, quantity: number): void {
  // On a Shopify store loaded with &shopify=1 this is also detected automatically —
  // calling it yourself there double-counts.
  analytics.productAdd(productId, quantity);
}

export async function loadRecommendations(): Promise<unknown[]> {
  const items = await analytics.recommend(123, 10, [
    'productId',
    'name',
    'price',
  ]);
  return Array.isArray(items) ? items : [];
}

// ---------------------------------------------------------------------------
// Listening to what the SDK sends
// ---------------------------------------------------------------------------

export function mirrorToOwnLogger(log: (payload: unknown) => void): () => void {
  const onEvent = (e: CustomEvent<{ event: unknown }>) => log(e.detail.event);
  window.addEventListener('intempt:event', onEvent);
  return () => window.removeEventListener('intempt:event', onEvent);
}

// ---------------------------------------------------------------------------
// Runtime failures that compile cleanly
// ---------------------------------------------------------------------------

export function theTraps(): void {
  // 1. Reserved event title, matched case-insensitively:
  //    window.intempt?.track({ eventTitle: 'Click On', data: { a: 1 } });
  //    -> Error: The 'Click On' event title is forbidden
  // 2. `data` must be non-empty:
  //    window.intempt?.track({ eventTitle: 'Signup', data: {} });
  //    -> Error: Track parameters are invalid: 'data' can't be empty.
  // 3. `userId` must be truthy — '' is rejected:
  //    window.intempt?.identify({ userId: '' });
  //    -> Error: Identify parameters are invalid: 'userId' is required.
  // 4. `validUntil` is typed required but never validated, so this succeeds and sends a
  //    consent event with validUntil 0:
  //    window.intempt?.consent({ action: 'accept', validUntil: 0 });
}
