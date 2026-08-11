import { afterEach, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * Shared jsdom setup for the unit tier.
 *
 * Adapted from `/home/beso/mixpanel-js/tests/unit/jsdom-setup.js` (Apache-2.0 —
 * see NOTICE). The valuable part of that file is not the jsdom boilerplate but
 * the discipline around determinism: the queue and batcher are timer- and
 * storage-driven, and tests that share either across files go flaky in ways that
 * are miserable to debug. So:
 *
 *  - `fake-indexeddb/auto` gives a real IndexedDB implementation in jsdom, which
 *    the Phase 3 persistence tier will need and which must be in place before
 *    those tests are written, not after.
 *  - storage is cleared between every test, because localStorage in jsdom is a
 *    single shared object for the whole file.
 *  - fake timers are opt-in per suite (`vi.useFakeTimers()`), but the teardown
 *    here always restores real ones, so one suite forgetting to clean up cannot
 *    hang the next file.
 */

beforeEach(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // jsdom always provides these; a throw here means an environment change.
  }

  // jsdom keeps cookies for the document's lifetime; expire them all.
  //
  // D-26: expiring with `path=/` alone is not enough. A cookie written with a
  // `domain=` attribute — which the consent cookie does, deliberately, so an
  // opt-out on `www.example.com` carries to `shop.example.com` (§3g/D-23) — is a
  // *different* cookie from the host-only one of the same name, and a deletion
  // that omits `domain` does not match it. Such a cookie therefore survived
  // teardown and leaked into the next test, which is why the privacy suites clear
  // their own state instead of trusting this hook. Expiring the name against every
  // registrable suffix of the current host as well as host-only covers both.
  const hostname = location.hostname;
  const labels = hostname.split('.');
  const domains: (string | null)[] = [null]; // host-only: no `domain=` attribute
  for (let i = 0; i < labels.length - 1; i++) {
    domains.push(labels.slice(i).join('.'), `.${labels.slice(i).join('.')}`);
  }

  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (!name) continue;
    for (const domain of domains) {
      const scope = domain === null ? '' : `;domain=${domain}`;
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/${scope}`;
    }
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
