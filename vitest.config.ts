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
      // without the other.
      // Phase 2 scope: the shared/queue/storage core — the code that decides
      // whether an event survives, which is what this tier is for.
      //
      // NOT yet included, deliberately: `src/guard/**` and
      // `src/intemptJs/guards/**` already have 91 Cypress assertions, and
      // duplicating them here to make a number go up would buy nothing. They
      // move into this tier when they are ported, and the thresholds move with
      // them — never one without the other.
      include: ['src/shared/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/**/types/**'],
      thresholds: {
        lines: 85,
        branches: 75,
        functions: 85,
        statements: 85,
      },
    },
  },
});
