import { test, expect, loadSdk, HOST } from './fixtures.ts';

/**
 * The WebKit smoke tier. **Deliberately small, and deliberately not a port of the
 * unit tier.**
 *
 * A second engine is worth running for the things an engine can disagree about:
 * whether the bundle parses at all, whether the APIs it reaches for exist, whether
 * storage works, whether the unload path fires. Re-asserting queue logic here would
 * cost minutes of CI to re-answer questions 1048 unit tests already answer in two
 * seconds, on a tier that is far more expensive to debug when it goes red.
 *
 * So: does it load, does it initialise, does it store, does it send, does it flush on
 * unload, and does it never throw. Six questions, each of which has a real WebKit
 * answer.
 */

test('the production bundle parses and executes on WebKit', async ({
  page,
  harness,
}) => {
  // The failure this catches is total and silent-to-CI: one syntax feature WebKit
  // does not implement (the §3h regex lookbehind would have been exactly this on
  // Safari < 16.4) and the whole bundle is a parse error. Every other test in this
  // file would fail too — this one names why.
  await loadSdk(page);

  expect(harness.pageErrors()).toEqual([]);
  expect(await page.evaluate(() => typeof window.intempt)).toBe('object');
});

test('finds its own script tag at the production CDN path', async ({
  page,
  harness,
}) => {
  await loadSdk(page);

  // `CAN'T FIND SCRIPT` is the console string support tells customers to look for,
  // and the signature of the mutable `/v1` deploy coupling. The fixture serves the
  // bundle from the real `cdn.intempt.com/v1/…` URL precisely so this path is
  // exercised rather than bypassed.
  expect(harness.pageErrors().join('\n')).not.toContain("CAN'T FIND SCRIPT");
});

test('exposes the version it was built with', async ({ page }) => {
  await loadSdk(page);

  const version = await page.evaluate(() => window.intempt?.VERSION);
  // Not a hardcoded number: the point is that the build-time `__SDK_VERSION__`
  // define survived minification, not which version it is.
  expect(version).toMatch(/^\d+\.\d+\.\d+/);
});

test('delivers a tracked event to ingest', async ({ page, harness }) => {
  await loadSdk(page);

  // The public signature is `track({ eventTitle, data })`, and `IntemptJsGuard`
  // rejects both a bare string ("eventTitle is required") and an empty `data`
  // ("'data' can't be empty"). Calling it exactly the way a customer must is the
  // point of an end-to-end tier — the unit tier mocks past this.
  await page.evaluate(() =>
    window.intempt?.track({
      eventTitle: 'WebKit smoke',
      data: { tier: 'browser' },
    }),
  );

  await harness.waitForEvent('WebKit smoke');
});

test('persists the queue through IndexedDB or its fallback', async ({
  page,
}) => {
  await loadSdk(page);

  // The storage tier demotes IndexedDB → localStorage → memory, and WebKit is where
  // that demotion actually happens in the wild (ITP, private browsing, quota). This
  // asserts that *some* tier accepted a write, not which one — pinning the tier
  // would make a correct demotion look like a regression.
  const stored = await page.evaluate(async () => {
    const keys = Object.keys(window.localStorage);
    const databases = (await indexedDB.databases?.()) ?? [];
    return {
      localStorageKeys: keys.length,
      databaseNames: databases.map((database) => database.name),
    };
  });

  expect(stored.localStorageKeys > 0 || stored.databaseNames.length > 0).toBe(
    true,
  );
});

test('auto-tracks a click without throwing', async ({ page, harness }) => {
  await loadSdk(page);
  await page.click('#cta');

  // The assertion is the absence of an exception, not the presence of an event:
  // auto-tracked events are batched, and whether one has flushed by now is a timing
  // question the unit tier owns. What WebKit can tell us is whether the DOM reads in
  // `HtmlEventData` — `classList`, `getAttributeNames`, `FormData` — behave here.
  expect(harness.pageErrors()).toEqual([]);
});

test('flushes on page hide rather than losing the batch', async ({
  page,
  harness,
}) => {
  await loadSdk(page);
  await page.evaluate(() =>
    window.intempt?.track({
      eventTitle: 'Unload flush',
      data: { tier: 'browser' },
    }),
  );

  // **This is the single most WebKit-specific assertion in the file.** Safari does
  // not reliably fire `beforeunload`/`unload`, and `fetch(keepalive)` support has
  // differed from Chromium's for years — so the unload path is the one most likely
  // to work in Electron and lose events on a real Apple device. Navigating away is
  // what triggers it.
  await page.goto(`${HOST}/second-page`, { waitUntil: 'load' });

  await expect
    .poll(() => harness.ingested().length, {
      timeout: 15_000,
      message: 'nothing reached ingest across a navigation',
    })
    .toBeGreaterThan(0);
});
