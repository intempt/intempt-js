import { extractEtldPlusOne, isHostOnlyTarget } from '../publicSuffix.ts';

/**
 * Cookie primitives for consent state, scoped to the eTLD+1.
 *
 * Why a dedicated module rather than `storageHandler.setCookie`: consent cookies
 * have requirements the general-purpose helper does not meet, and one of them is
 * a hard behavioural rule for this whole area.
 *
 *  1. **They must never throw.** `document.cookie` access throws in sandboxed
 *     iframes without `allow-same-origin`, and these functions run inside a
 *     customer's consent-banner click handler. A throw there turns our
 *     compliance fix into the host page's broken banner. Every export below
 *     swallows and reports; none propagates.
 *  2. **They need `SameSite` and `Secure`.** Chrome treats a cookie with no
 *     `SameSite` as `Lax` but warns, and Safari's ITP is harsher on unmarked
 *     cookies. `storageHandler.setCookie` sets neither.
 *  3. **They must survive being read by a *different subdomain*** — the entire
 *     point (D15). `setCookie` also mutates a module-level `appLocalCookie`
 *     mirror used by the session trackers, which consent has no business
 *     touching.
 *
 * Scope: the cookie is written with `domain=.<eTLD+1>` so `www.example.com` and
 * `shop.example.com` share it. Hosts that cannot be domain-scoped — IP literals,
 * `localhost`, single-label intranet names — get a **host-only** cookie instead.
 * A browser rejects `domain=.localhost` outright, which silently drops the
 * cookie rather than mis-scoping it, so omitting the attribute is the only
 * option that works there. `isHostOnlyTarget` from `publicSuffix.ts` is the
 * authority on which case a host is in; do not re-derive that test here.
 */

/** One year. Long enough that consent is not re-asked on a normal return visit. */
const CONSENT_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export type CookieFailureReporter = (message: string, error?: unknown) => void;

function currentHostname(): string {
  try {
    if (typeof window === 'undefined' || !window.location) {
      return '';
    }
    return window.location.hostname || '';
  } catch {
    return '';
  }
}

/**
 * The `domain` attribute value for a consent cookie on this host, or `''` when
 * the cookie must be host-only.
 *
 * Exported for tests and for callers that need to delete a cookie at the same
 * scope it was written — a `Set-Cookie` deletion only matches if the domain
 * matches, so an expiry written host-only will not remove a domain cookie.
 */
export function consentCookieDomain(hostname?: string): string {
  const host = (hostname ?? currentHostname()).toLowerCase().replace(/\.$/, '');

  if (!host || isHostOnlyTarget(host)) {
    return '';
  }

  const registrable = extractEtldPlusOne(host);

  return registrable ? `.${registrable}` : '';
}

function isSecureContext(): boolean {
  try {
    return typeof window !== 'undefined' && window.location?.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Read a cookie by name. Returns `null` when absent or unreadable.
 *
 * Unreadable and absent are deliberately the same answer: the caller's next step
 * is a fallback lookup in either case, and distinguishing them would only give
 * it a reason to throw.
 */
export function readConsentCookie(name: string, onFailure?: CookieFailureReporter): string | null {
  try {
    if (typeof document === 'undefined') {
      return null;
    }

    const cookies = document.cookie ? document.cookie.split(';') : [];

    for (const entry of cookies) {
      const separator = entry.indexOf('=');
      if (separator === -1) {
        continue;
      }
      if (entry.slice(0, separator).trim() !== name) {
        continue;
      }
      return decodeURIComponent(entry.slice(separator + 1).trim());
    }

    return null;
  } catch (error) {
    onFailure?.('failed to read consent cookie', error);
    return null;
  }
}

/**
 * Write a cookie at the eTLD+1 (or host-only where that is invalid).
 *
 * Returns whether the write appears to have taken effect. That return value is
 * information for the caller's fallback decision, **not** an error channel — a
 * `false` here is normal when the visitor blocks cookies, and the caller's job
 * is then to lean on localStorage rather than to complain.
 */
export function writeConsentCookie(
  name: string,
  value: string,
  onFailure?: CookieFailureReporter,
): boolean {
  try {
    if (typeof document === 'undefined') {
      return false;
    }

    const domain = consentCookieDomain();

    const parts = [
      `${name}=${encodeURIComponent(value)}`,
      'path=/',
      `max-age=${CONSENT_COOKIE_MAX_AGE_SECONDS}`,
      'SameSite=Lax',
    ];

    if (domain) {
      parts.push(`domain=${domain}`);
    }
    // `Secure` on an http page makes the browser drop the cookie entirely, so it
    // is conditional. Consent state is not a credential; the cost of it being
    // readable over http on an http-only site is nil compared with losing it.
    if (isSecureContext()) {
      parts.push('Secure');
    }

    document.cookie = parts.join(';');

    return readConsentCookie(name, onFailure) === value;
  } catch (error) {
    onFailure?.('failed to write consent cookie', error);
    return false;
  }
}

/**
 * Expire a consent cookie at both scopes it could have been written at.
 *
 * Both, because the scope depends on the hostname the cookie was *written* from:
 * a visitor who first arrived on `localhost` (host-only) and later on
 * `app.example.com` (domain) can have either. Deleting only the current scope
 * leaves the other one live and the opt-out state ambiguous.
 */
export function clearConsentCookie(name: string, onFailure?: CookieFailureReporter): void {
  try {
    if (typeof document === 'undefined') {
      return;
    }

    const expiry = 'expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = `${name}=;path=/;${expiry}`;

    const domain = consentCookieDomain();
    if (domain) {
      document.cookie = `${name}=;path=/;domain=${domain};${expiry}`;
    }
  } catch (error) {
    onFailure?.('failed to clear consent cookie', error);
  }
}
