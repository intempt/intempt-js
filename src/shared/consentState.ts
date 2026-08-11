import { localStorageCache } from './storageHandler.ts';

/**
 * Persisted opt-out state.
 *
 * `optOut()` used to set an in-memory flag only, so a visitor who opted out
 * started tracking again on the next page load. That is a compliance defect, not
 * a missing feature — consent has to outlive the page that captured it.
 *
 * Storage notes:
 * - localStorage, matching the rest of the SDK's client state. It is therefore
 *   origin-scoped: an opt-out on `www.example.com` does NOT carry to
 *   `shop.example.com`. Cross-subdomain consent needs a cookie written at the
 *   eTLD+1, which lands with the `gdpr-utils` port (Phase 4).
 * - Failures are swallowed deliberately. In Safari private mode and under a
 *   full quota, localStorage throws; the caller must not have `optOut()` throw
 *   back into a consent banner's click handler. The in-memory flag still holds
 *   for the current page in that case.
 */
export const DO_NOT_TRACK_KEY = 'intempt_do_not_track';

export function loadDoNotTrack(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return false;
    }
    return localStorageCache.get(DO_NOT_TRACK_KEY) === true;
  } catch {
    return false;
  }
}

export function persistDoNotTrack(value: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    // Written on opt-IN as well as opt-out: an explicit opt-in must be able to
    // clear a stored opt-out, otherwise consent becomes a one-way door.
    localStorageCache.set(DO_NOT_TRACK_KEY, value);
  } catch {
    // See note above — never propagate.
  }
}
