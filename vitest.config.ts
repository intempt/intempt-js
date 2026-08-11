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
      // Thresholds sit ~2 points under the measured score: tight enough to catch a
      // real regression, loose enough that a small refactor does not fail CI on
      // noise. Re-measure and move them whenever the gap opens up — a gate 7
      // points below reality is not a gate.
      //
      // History (measure, then set; never interpolate):
      //   `src/shared/**` only ................ 85 / 75 / 85 / 85
      //   guard suites ported, scope widened .. 90 / 87 / 87 / 90
      //     measured then: 92.57 statements/lines, 89.64 branches, 88.88 functions
      //   storage mutation batch (§3f-ii) ..... 93 / 88 / 94 / 94
      //     measured now: 95.55 statements, 90.83 branches, 96.88 functions,
      //     96.35 lines, over 821 tests.
      //
      // Note vitest 4 counts statements differently from vitest 2, so figures
      // recorded before the supply-chain upgrade (§3g-i) are not comparable with
      // these. Branches is deliberately the loosest of the four — it is the metric
      // that moves most on an unrelated refactor.
      thresholds: {
        lines: 94,
        branches: 88,
        functions: 94,
        statements: 93,
      },
    },
  },
});
