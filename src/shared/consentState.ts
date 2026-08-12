import { localStorageCache } from './storageHandler.ts';
import {
  clearConsentCookie,
  readConsentCookie,
  writeConsentCookie,
} from './privacy/consentCookie.ts';

/**
 * Persisted opt-out state.
 *
 * `optOut()` used to set an in-memory flag only, so a visitor who opted out
 * started tracking again on the next page load. That is a compliance defect, not
 * a missing feature — consent has to outlive the page that captured it.
 *
 * ## Two stores, deliberately
 *
 * The original version used `localStorage` alone, which is **origin-scoped**: an
 * opt-out on `www.example.com` did not carry to `shop.example.com`, so a visitor
 * who opted out on the marketing site was tracked again on the store (D15). The
 * fix is a cookie at the eTLD+1, and the fix is *additive* rather than a
 * replacement:
 *
 *  - **Cookie is authoritative when present.** It is the only one of the two
 *    that can be shared across subdomains, so a disagreement between the stores
 *    means the cookie carries the more recent, more widely-scoped decision.
 *  - **localStorage is the fallback, and is still written.** Two independent
 *    reasons, either of which alone justifies keeping it: a visitor may block
 *    cookies while allowing localStorage (common with tracker-blocking
 *    extensions), and every visitor who opted out *before* this change has their
 *    opt-out in localStorage only. Dropping the localStorage read would silently
 *    re-enrol every one of those people — the exact failure this module exists
 *    to prevent, reintroduced by the fix for it.
 *  - **A localStorage-only opt-out is upgraded to a cookie on read.** That is
 *    what actually closes D15 for the existing population rather than only for
 *    new opt-outs. It is a write inside a read, which is normally worth
 *    avoiding; here the alternative is that pre-existing opt-outs stay
 *    origin-scoped forever.
 *
 * The upgrade only ever widens an opt-**out**. It never manufactures an opt-in,
 * so the failure direction is "more private than asked", which is the correct
 * way for consent code to be wrong.
 *
 * ## Failures are swallowed, always
 *
 * In Safari private mode, at full quota, and in a sandboxed iframe, both
 * `localStorage` and `document.cookie` throw on access. These functions are
 * called from a consent banner's click handler, so a throw here would turn our
 * compliance fix into the host page's outage. The in-memory flag still holds for
 * the current page in that case. Nothing below propagates an exception.
 */
export const DO_NOT_TRACK_KEY = 'intempt_do_not_track';

/**
 * Cookie name. Same string as the localStorage key on purpose — one concept, one
 * name, and the two stores cannot collide because they are different namespaces.
 */
export const DO_NOT_TRACK_COOKIE = 'intempt_do_not_track';

const COOKIE_OPTED_OUT = '1';
const COOKIE_OPTED_IN = '0';

function readLocalStorageFlag(): boolean | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    const stored = localStorageCache.get(DO_NOT_TRACK_KEY);
    // Anything that is not an actual boolean is treated as absent rather than as
    // false: a corrupt or foreign value is no evidence of a decision either way,
    // and reading it as "tracking allowed" would let a bad write undo an opt-out.
    if (stored === true || stored === false) {
      return stored;
    }
    return null;
  } catch {
    return null;
  }
}

function writeLocalStorageFlag(value: boolean): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    localStorageCache.set(DO_NOT_TRACK_KEY, value);
  } catch {
    // See the module note — never propagate.
  }
}

/**
 * The visitor's stored decision, or `null` if they have not made one.
 *
 * Distinguishing "no decision" from "decided to allow" is what lets the caller
 * layer a browser DNT/GPC signal underneath a stored decision without the
 * absence of a cookie looking like an explicit opt-in.
 */
export function loadStoredConsent(): boolean | null {
  const cookie = readConsentCookie(DO_NOT_TRACK_COOKIE);

  if (cookie === COOKIE_OPTED_OUT) {
    return true;
  }
  if (cookie === COOKIE_OPTED_IN) {
    return false;
  }

  const local = readLocalStorageFlag();

  if (local === true) {
    // Pre-existing, origin-scoped opt-out. Widen it so it follows the visitor
    // across subdomains — see the module note. Best-effort: if the cookie write
    // fails we still return the opt-out, which is what matters here.
    writeConsentCookie(DO_NOT_TRACK_COOKIE, COOKIE_OPTED_OUT);
  }

  return local;
}

/**
 * Whether the visitor has a stored opt-out. Absent decision means tracking is
 * allowed, matching the SDK's documented default.
 */
export function loadDoNotTrack(): boolean {
  return loadStoredConsent() === true;
}

export function persistDoNotTrack(value: boolean): void {
  // Written on opt-IN as well as opt-out: an explicit opt-in must be able to
  // clear a stored opt-out, otherwise consent becomes a one-way door.
  //
  // Both stores are written on every change, and the cookie first. If only one
  // of the two succeeds the states must not disagree in the direction that
  // resurrects a stale opt-in, and the cookie is the authoritative reader, so
  // writing it first means a partial failure leaves the newer value winning.
  writeConsentCookie(
    DO_NOT_TRACK_COOKIE,
    value ? COOKIE_OPTED_OUT : COOKIE_OPTED_IN,
  );
  writeLocalStorageFlag(value);
}

/**
 * Erase the stored decision entirely, returning the visitor to "has not decided".
 *
 * Distinct from `persistDoNotTrack(false)`, which records an explicit opt-in. A
 * customer re-presenting their consent banner on policy change needs this one —
 * with an explicit opt-in stored, the banner has nothing to ask about.
 */
export function clearStoredConsent(): void {
  clearConsentCookie(DO_NOT_TRACK_COOKIE);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorageCache.remove(DO_NOT_TRACK_KEY);
    }
  } catch {
    // See the module note — never propagate.
  }
}
