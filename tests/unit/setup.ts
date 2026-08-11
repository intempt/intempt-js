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
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (name) {
      document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
