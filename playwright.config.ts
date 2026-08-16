import { defineConfig, devices } from '@playwright/test';

/**
 * Tier 3 — the WebKit browser tier.
 *
 * The two tiers that existed before this one both run on a Chromium-family engine:
 * vitest in **jsdom** (not a browser at all) and Cypress in **Electron**. So every
 * Safari and Firefox claim in this repo was inferred and never executed — `AUDIT.md`
 * dimension 8, and `BACKLOG.md` §3, which parked the whole question on "money".
 *
 * It is not all blocked on money. WebKit — the engine Safari is built on — ships with
 * Playwright and runs on a free GitHub runner. That covers the failure class this repo
 * has actually been bitten by: **an engine-level parse or API gap that takes the whole
 * bundle down**, which is what the regex lookbehind found in §3h would have done on
 * Safari < 16.4.
 *
 * **What this tier does NOT cover, so nobody reads more into a green run than is
 * there.** WebKit is the engine, not the browser. It does not carry Safari's
 * Intelligent Tracking Prevention, its 7-day script-written-cookie cap, or iOS's
 * storage eviction — and those are the *other* half of the Safari risk, the half that
 * silently loses data rather than failing loudly. Real Safari cannot be driven by
 * Playwright at all (there is no Safari channel; it needs `safaridriver` over
 * WebDriver, a separate harness), and iOS Safari needs a device cloud. Both remain in
 * `BACKLOG.md` §3.
 *
 * The macOS leg is the closest free approximation: on `macos-latest` the WebKit build
 * links against Apple's own system frameworks rather than the Linux GTK/WPE port, so
 * it fails differently — and differently is the entire value of a second engine.
 */
export default defineConfig({
  testDir: './tests/browser',
  // The SDK is global, module-level state; two specs sharing a page would share it.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // One retry in CI only. A retry that hides a flake locally is how a flake ships;
  // in CI it distinguishes "the runner hiccuped" from "WebKit disagrees with us",
  // and §0c is a list of five failures where that distinction mattered.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    // No `baseURL`: every request in these specs is served by `page.route()` from
    // the built bundle on disk, so the tier needs no server and no network. See
    // `tests/browser/fixtures.ts` for why the fixture is served from a real https
    // origin rather than `about:blank`.
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    /**
     * The control, and it earns its runtime twice over.
     *
     * A red WebKit run is ambiguous on its own — engine disagreement, or a spec that
     * was always wrong? Running the identical specs on the engine the SDK is already
     * known to work on answers that in the same run: **both red is our bug, WebKit
     * alone is the finding.** It is also the only leg that can be executed on a
     * developer machine that cannot install WebKit's system libraries, which is how
     * these specs were written.
     */
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
