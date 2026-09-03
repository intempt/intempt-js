import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  test as base,
  expect,
  type Page,
  type Request,
} from '@playwright/test';

/**
 * The harness for the WebKit tier.
 *
 * **Why route interception rather than a dev server.** The bundle finds its own
 * `<script>` tag by matching `VITE_CDN_LINK` — `https://cdn.intempt.com/v1/intempt.min.js`
 * — and failing that path is the known signature behind the `CAN'T FIND SCRIPT`
 * incidents (`build.yaml`'s mutable `/v1` deploy). Serving the bundle from
 * `localhost:xxxx` would mean building with a different CDN literal, i.e. testing a
 * bundle no customer receives and skipping the detection path entirely. `page.route()`
 * serves the **production artifact** at the **production URL**, offline.
 *
 * **Why a real https origin rather than `about:blank`.** `localStorage`, IndexedDB and
 * cookies are all unavailable or opaque on `about:blank`, and storage is precisely
 * what this tier exists to exercise on a second engine.
 *
 * Nothing here reaches the network: the fixture host, the CDN, ingest and the geo API
 * are all fulfilled locally, and `page.route('**')` aborts anything else so a test
 * cannot silently pass by talking to production.
 */

const HOST = 'https://sdk-browser-tier.example.com';
const CDN = 'https://cdn.intempt.com/v1/intempt.min.js';
const INGEST = 'https://api.intempt.com/v1';
const BUNDLE = resolve(process.cwd(), 'dist/intempt.min.js');

const CONFIG_QUERY =
  'project=browser-tier&key=test-write-key&source=test-source&organization=test-org';

export type Harness = {
  /** Every request the page made to ingest, in order, already JSON-parsed. */
  ingested: () => unknown[];
  /**
   * Every URL the SDK requested that no fixture route handles. Must stay empty.
   *
   * Not a list of known geo vendors. An earlier version recorded `ipapi.co` alone, so a
   * lookup pointed at any other host was aborted by the catch-all without ever being
   * recorded, and the guard passed. This records whatever reaches the catch-all, which by
   * construction is every host the fixtures do not serve.
   */
  unroutedRequests: () => string[];
  /**
   * Wait until an ingest request whose body mentions `name` has landed.
   *
   * Matched against the serialised body rather than a named field on purpose: the
   * wire shape is the unit tier's contract (`tests/unit/__golden__/payload/`), and
   * duplicating it here would mean this tier goes red on a payload change that has
   * nothing to do with the engine. What WebKit can answer is "did the request leave
   * the browser at all", and that is what this asserts.
   */
  waitForEvent: (name: string) => Promise<void>;
  /** Console errors and page exceptions — a bundle that fails to parse shows here. */
  pageErrors: () => string[];
};

function readBundle(): string {
  if (!existsSync(BUNDLE)) {
    throw new Error(
      `dist/intempt.min.js is missing — run \`npm run build\` before \`npm run test:browser\`. ` +
        `This tier deliberately tests the built artifact, not the source.`,
    );
  }
  return readFileSync(BUNDLE, 'utf-8');
}

export const test = base.extend<{ harness: Harness }>({
  // `auto: true` — the routing must be installed for **every** test in this tier,
  // including the ones that never destructure `harness`. Without it a spec that only
  // asks for `page` gets no interception, resolves `sdk-browser-tier.example.com`
  // against real DNS, and fails with `ERR_NAME_NOT_RESOLVED` — which reads as a
  // network problem rather than a missing fixture. Found exactly that way.
  harness: [
    async ({ page }, use) => {
      const bundle = readBundle();
      const ingested: unknown[] = [];
      const pageErrors: string[] = [];
      const unroutedRequests: string[] = [];

      page.on('pageerror', (error) => pageErrors.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error') pageErrors.push(message.text());
      });

      // **Registered first on purpose.** Playwright matches routes in reverse
      // registration order, so the catch-all has to go in before the specific
      // handlers or it swallows every request — including the fixture page itself.
      // Anything not matched below must not reach the network: a test that passes by
      // talking to real ingest is worse than one that fails.
      // Recorded before aborting. Every specific handler below is registered later and
      // therefore wins, so a request arriving here is one no fixture serves — which is the
      // definition of a third-party call, whoever the vendor turns out to be.
      await page.route('**', (route) => {
        const url = route.request().url();
        if (url.startsWith('http://') || url.startsWith('https://')) {
          unroutedRequests.push(url);
        }
        return route.abort();
      });

      await page.route(`${CDN}*`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          headers: { 'access-control-allow-origin': '*' },
          body: bundle,
        }),
      );

      /**
       * `/stub` serves the same page with the **pre-init queue stub** installed
       * ahead of the SDK tag, which is how the real snippet is deployed: a tiny
       * inline shim records calls in `window.intempt._queue` (and holds the promise
       * for the async `recommendation`) so nothing the page does before the bundle
       * arrives is lost. The loader drains that queue onto the real instance.
       *
       * A separate page rather than a flag on the default one, because the stub has
       * to run *before* the bundle, and the difference between "queued then
       * replayed" and "called directly" is the whole thing under test.
       *
       * `defer` on the SDK tag is what makes the window real: without it the bundle
       * executes immediately, nothing is ever queued, and the test would pass while
       * proving nothing.
       */
      await page.route(`${HOST}/**`, (route) => {
        const wantsStub = new URL(route.request().url()).pathname.startsWith(
          '/stub',
        );
        const stub = wantsStub
          ? `<script>
  window.intempt = {
    _queue: [],
    _pendingPromises: [],
    track: function () {
      this._queue.push({ method: 'track', args: [].slice.call(arguments) });
    },
    recommendation: function () {
      var self = this;
      this._queue.push({ method: 'recommendation', args: [].slice.call(arguments) });
      return new Promise(function (resolve, reject) {
        self._pendingPromises.push({ resolve: resolve, reject: reject });
      });
    },
  };
  window.__stubSettled = [];
  window.__stubIsStub = true;
  window.intempt.track({ eventTitle: 'Queued before load', data: { via: 'stub' } });
  // Recorded synchronously, at the moment of the call: proof that this call went
  // into the queue rather than straight to a bundle that had already loaded. The
  // test cannot observe that window afterwards — the bundle is served from disk and
  // replaces the stub almost immediately — so the stub has to leave the evidence.
  window.__stubQueueLengthAtCall = window.intempt._queue.length;
  window.intempt
    .recommendation({ id: 'rec-1' })
    .then(function () { window.__stubSettled.push('resolved'); })
    .catch(function () { window.__stubSettled.push('rejected'); });
</script>`
          : '';

        return route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SDK browser tier</title>
${stub}
<script ${wantsStub ? 'defer ' : ''}src="${CDN}?${CONFIG_QUERY}"></script>
</head><body>
  <h1>Fixture</h1>
  <a id="cta" class="btn" href="/pricing">Pricing</a>
  <form id="login" action="/login">
    <input name="user" value="ada" />
    <input name="pw" type="password" value="hunter2" />
    <button type="submit">Sign in</button>
  </form>
</body></html>`,
        });
      });

      await page.route(`${INGEST}/**`, async (route, request: Request) => {
        try {
          ingested.push(JSON.parse(request.postData() ?? 'null'));
        } catch {
          ingested.push(request.postData());
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: '{"success":true}',
        });
      });

      await use({
        unroutedRequests: () => unroutedRequests,
        ingested: () => ingested,
        pageErrors: () => pageErrors,
        waitForEvent: async (name: string) => {
          await expect
            .poll(() => JSON.stringify(ingested).includes(name), {
              timeout: 15_000,
              message: `no ingest request mentioning "${name}"`,
            })
            .toBe(true);
        },
      });
    },
    { auto: true },
  ],
});

export { expect, HOST, CDN };

/** Load the fixture page and wait for the SDK to have installed itself. */
export async function loadSdk(page: Page): Promise<void> {
  await page.goto(HOST, { waitUntil: 'load' });
  await page.waitForFunction(
    () => typeof window.intempt !== 'undefined',
    null,
    {
      timeout: 15_000,
    },
  );
}
