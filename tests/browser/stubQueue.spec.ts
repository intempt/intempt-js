import { test, expect, HOST } from './fixtures.ts';

/**
 * The pre-init queue stub, end to end in a real browser.
 *
 * **Why this deserves its own spec.** The stub is the only part of the integration a
 * customer hand-writes, and its failure mode is the quietest one the SDK has: every
 * call the page made before the bundle finished loading is lost, with no error, no
 * console output and no dropped-request signature. `sdkLoader.test.ts` covers the
 * replay logic in jsdom, but jsdom cannot reproduce the thing that makes the queue
 * necessary in the first place — **a real script-loading order**, where the page runs
 * and calls `intempt.track()` while the bundle is still in flight.
 *
 * The fixture's `/stub` page reproduces exactly that: an inline stub that queues, a
 * `defer`red SDK tag so the bundle genuinely arrives late, and a `track()` plus a
 * `recommendation()` issued before it does.
 */

const STUB_PAGE = `${HOST}/stub`;

/** Load the stub page and wait until the real SDK has replaced the stub. */
async function loadStubPage(page: import('@playwright/test').Page) {
  await page.goto(STUB_PAGE, { waitUntil: 'load' });
  await page.waitForFunction(
    () => typeof window.intempt?.VERSION === 'string',
    null,
    { timeout: 15_000 },
  );
}

test('the call really did go through the queue, not to an already-loaded bundle', async ({
  page,
}) => {
  // Asserted first and on its own: if the bundle were not genuinely late, every
  // other test in this file would pass while proving nothing. The stub records its
  // own queue length at the moment of the call, because the window itself is not
  // observable from the test — the bundle is served from disk and replaces the stub
  // almost immediately.
  await loadStubPage(page);

  const queuedAtCall = await page.evaluate(
    () =>
      (window as unknown as { __stubQueueLengthAtCall?: number })
        .__stubQueueLengthAtCall,
  );
  expect(queuedAtCall).toBe(1);
});

test('the real SDK replaces the stub once it loads', async ({ page }) => {
  await loadStubPage(page);

  expect(await page.evaluate(() => typeof window.intempt?.track)).toBe(
    'function',
  );
  // `VERSION` only exists on the real instance, so this is what distinguishes
  // "replaced" from "the stub is still there and silently swallowing calls".
  expect(await page.evaluate(() => window.intempt?.VERSION)).toMatch(
    /^\d+\.\d+\.\d+/,
  );
});

test('the queued event is replayed and reaches ingest', async ({
  page,
  harness,
}) => {
  await loadStubPage(page);

  // The whole point of the stub: a call made before the bundle existed still ends up
  // on the wire. If the replay is broken this is where it shows, and nowhere else.
  await harness.waitForEvent('Queued before load');
});

test('the queue is drained, so nothing is replayed twice', async ({ page }) => {
  await loadStubPage(page);

  // `replayQueuedCalls` truncates the array in place. Left full, a second loader run
  // — or anything else reading `_queue` — would re-send every queued event, and
  // duplicate events are harder to spot in a dashboard than missing ones.
  const leftover = await page.evaluate(
    () =>
      (window.intempt as unknown as { _queue?: unknown[] })?._queue?.length ??
      0,
  );
  expect(leftover).toBe(0);
});

test('the promise the stub handed the page is settled by the real SDK', async ({
  page,
}) => {
  await loadStubPage(page);

  // `recommendation()` is the one async public method, so the stub returned the page
  // a promise it cannot resolve itself. If the handoff drops it, the customer's
  // `.then()` never runs — a hang rather than an error, which is worse.
  await page.waitForFunction(
    () =>
      ((window as unknown as { __stubSettled?: string[] }).__stubSettled
        ?.length ?? 0) > 0,
    null,
    { timeout: 15_000 },
  );

  const settled = await page.evaluate(
    () => (window as unknown as { __stubSettled: string[] }).__stubSettled,
  );
  // Either outcome is a pass: what is under test is that it settles at all. It
  // resolves in practice — `recommendation()` degrades to control rather than
  // rejecting — but pinning that here would duplicate a unit assertion and make this
  // spec fail on an unrelated policy change.
  expect(settled).toHaveLength(1);
  expect(['resolved', 'rejected']).toContain(settled[0]);
});

test('the stub script tag is removed from the page', async ({ page }) => {
  await loadStubPage(page);

  // Left in place it is dead markup that still looks like the SDK to anyone
  // debugging the page. The SDK's own tag must survive, which the next assertion
  // checks — deleting that instead would be the SDK removing itself.
  const scripts = await page.evaluate(() =>
    Array.from(document.scripts).map((s) => ({
      src: s.src,
      inline: s.textContent?.includes('_queue') ?? false,
    })),
  );

  expect(scripts.some((s) => s.inline)).toBe(false);
  expect(scripts.some((s) => s.src.includes('intempt.min.js'))).toBe(true);
});

test('nothing threw while the handoff happened', async ({ page, harness }) => {
  await loadStubPage(page);

  // The replay runs inside the loader with a try/catch per call, and an uncaught
  // throw here would land in the customer's own JavaScript rather than ours.
  expect(harness.pageErrors()).toEqual([]);
});
