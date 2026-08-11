import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

/**
 * Tier 1 of the two-tier test split (Phase 2 of the hardening programme).
 *
 * Tier 1 (this file): fast jsdom unit tests, `tests/unit/**`, run on every
 *   change and in CI. Owns logic, edge cases, and anything needing deterministic
 *   timer control.
 * Tier 2: the existing Cypress specs in `__tests__/**.cy.ts`, kept as a real-browser
 *   smoke tier (`npm test`). They are deliberately NOT run by vitest — the two
 *   tiers use different assertion globals and different runners.
 *
 * vitest rather than Mixpanel's mocha + babel-6 + browserify: the repo is
 * already on vite, so this adds no new toolchain (DECISIONS D2).
 */
export default defineConfig({
  define: {
    // Mirrors vite.config.ts so SDK_VERSION resolves the same way under test.
    __SDK_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['./tests/unit/setup.ts'],
    // Each file gets a fresh jsdom global, so localStorage/cookie state from one
    // suite cannot leak into another. Storage-heavy suites make this necessary.
    isolate: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Scoped to the modules Phase 2 targets. Widening this is a deliberate
      // act — raise the include list and the thresholds together, never one
      // without the other (D20).
      //
      // 1. `src/shared/**` — the queue/storage core, the code that decides
      //    whether an event survives.
      // 2. `src/guard/**` + `src/intemptJs/guards/**` — added when the Cypress
      //    guard specs were ported into this tier (`trackingGuard.cy.ts` and
      //    `botGuard.cy.ts` were deleted, not duplicated). These decide whether
      //    the SDK initialises at all and whether a public call is accepted, so
      //    a gap here is silent and total.
      include: [
        'src/shared/**/*.ts',
        'src/guard/**/*.ts',
        'src/intemptJs/guards/**/*.ts',
      ],
      exclude: ['src/**/*.d.ts', 'src/**/types/**'],
      // Raised with the include-list widening above, per D20 — never widen scope
      // without also moving these, or the effective bar silently drops.
      //
      // Measured at the commit that ported the guard suites: statements/lines
      // 92.57%, branches 89.64%, functions 88.88%. Thresholds sit ~2 points
      // under, which is tight enough to catch a real regression and loose enough
      // that a small refactor does not fail CI on noise.
      //
      // Previous values, when the scope was `src/shared/**` alone: 85/75/85/85.
      thresholds: {
        lines: 90,
        branches: 87,
        functions: 87,
        statements: 90,
      },
    },
  },
});
