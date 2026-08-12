import { SetCookieParams } from '../intemptJs/types/autoTracker.types.ts';
import { LocalStorageCache } from '../intemptJs/types/intemptJs.types.ts';
import { extractEtldPlusOne, isHostOnlyTarget } from './publicSuffix.ts';

// In-memory mirror of the cookie jar. Cookie values are raw strings — the JSON
// parsing happens at the two readers below — so `string`, not `any`: it is a
// stronger statement than `unknown` and the writers below only ever put strings in.
const appLocalCookie: { [key: string]: string } = {};

export const localIntemptSessionCookie = () =>
  appLocalCookie['intempt_session']
    ? JSON.parse(appLocalCookie['intempt_session'])
    : null;

export const localIntemptPageSessionCookie = () =>
  appLocalCookie['page_session']
    ? JSON.parse(appLocalCookie['page_session'])
    : null;

export function setCookie({
  name,
  value,
  path,
  expiration,
  domain = '',
}: SetCookieParams) {
  const cookieValue = `${name}=${value};`;
  const cookiePath = `path=${path};`;
  const expires = expiration
    ? `expires=${new Date(Date.now() + expiration).toUTCString()};`
    : '';
  // handleDomain() returns '' for hosts that cannot be domain-scoped (IPs,
  // localhost). Resolve first, then decide — emitting `domain=;` would be a
  // malformed attribute rather than an absent one.
  const resolvedDomain = domain ? handleDomain(domain) : '';
  const cookieDomain = resolvedDomain ? `domain=${resolvedDomain};` : '';
  document.cookie = `${cookieValue}${expires}${cookiePath}${cookieDomain}`;

  appLocalCookie[name] = value;

  return { [name]: value };
}

export function getCookie(name: string) {
  const cookies = document.cookie.split(';');

  const cookie = cookies.find((cookie) => cookie.trim().startsWith(name + '='));

  if (!cookie) return null;

  const firstEqualIndex = cookie.indexOf('=');
  const key = cookie.substring(0, firstEqualIndex).trim();
  const value = cookie.substring(firstEqualIndex + 1).trim();

  if (key !== name.trim()) return null;

  return { [name]: decodeURIComponent(value) };
}

/**
 * Cookie `domain` attribute for a hostname.
 *
 * Returns the registrable domain with a leading dot (`.example.com`) so the
 * cookie is shared across subdomains — unchanged from the previous `psl`-backed
 * behaviour, minus 152 KB of public-suffix data. See `publicSuffix.ts` for the
 * heuristic and its bounded failure mode.
 *
 * Hosts that cannot be domain-scoped (IP literals, `localhost`) return an empty
 * string, which makes `setCookie` omit the attribute entirely and write a
 * host-only cookie. The old code returned `.localhost` / `.127.0.0.1` here,
 * which browsers reject outright — dropping the cookie instead of scoping it.
 */
export function handleDomain(domain: string) {
  if (isHostOnlyTarget(domain)) {
    return '';
  }

  const registrable = extractEtldPlusOne(domain);

  return registrable ? `.${registrable}` : '';
}

export const localStorageCache: LocalStorageCache = {
  get: (key: string): unknown => {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  },
  set: (key: string, value: unknown): void =>
    localStorage.setItem(key, JSON.stringify(value)),
  remove: (key: string): void => localStorage.removeItem(key),
  getAllKeys: (): string[] => Object.keys(localStorage),
  clear: (): void => localStorage.clear(),
};
