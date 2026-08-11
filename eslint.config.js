// ESLint flat config. This is the first lint config this repo has ever had, so
// its guiding constraint is that it must be GREEN on arrival: a gate that is red
// the day it lands gets `continue-on-error`'d and then deleted. See the note at
// the foot of .github/workflows/ci.yml for the same reasoning applied to the
// jobs there.
//
// Consequence: the two rules that would actually fail today —
// `@typescript-eslint/no-explicit-any` (61 occurrences) and `no-console` (54) —
// are configured as WARNINGS. They are real findings and they are already
// scheduled work: FRONTEND.md #6 (code health) kills the `any`s and #2
// (structured logging) replaces the `console.*` calls with a levelled logger.
// When each of those lands, flip the corresponding rule to 'error' here — that
// flip is the ratchet that stops them coming back.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Generated, vendored or non-source output. dist/ in particular is minified
    // bundle output — linting it produces thousands of meaningless findings.
    ignores: [
      'dist/**',
      'coverage/**',
      'reports/**',
      '.stryker-tmp/**',
      'node_modules/**',
      'standalone/**',
      // Agent worktrees are full checkouts of this repo (including their own
      // dist/), so without this eslint lints the project several times over and
      // reports thousands of duplicate problems from generated output.
      '.claude/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    // Type-aware linting is deliberately NOT enabled (no `projectService` /
    // `recommendedTypeChecked`). This repo imports with explicit `.ts`
    // extensions, which the type-aware rules' program resolution handles
    // poorly, and `tsc` in `npm run build` is already the typecheck gate — so
    // the type-aware tier would cost minutes of CI to duplicate a check that
    // already exists.
    files: ['**/*.ts', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
    },
    rules: {
      // ---- Scheduled to become errors; warnings today. See header. ----
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'warn',

      // ---- Real errors: these are bugs, not style, and the repo is clean. ----
      // Verified green on arrival: `npx eslint .` reports 0 errors for each of
      // these today, so they are a true ratchet rather than a backlog.
      'no-debugger': 'error',
      'no-alert': 'error',
      // `catch {}` is a deliberate, frequent idiom in this SDK (storage quota
      // failures must never throw into a host page), so an empty block in a
      // catch is allowed and only other empty blocks are flagged.
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',

      // ---- Pre-existing findings, demoted to warn so the gate lands green. ----
      // Counts measured 2026-08-11 on this branch. Every one of these lives in
      // src/, which this lane may not edit; they are FRONTEND.md #6 (code
      // health) work. Promote each to 'error' as its count reaches zero.
      '@typescript-eslint/no-unused-expressions': 'warn', // 47 — almost all `a?.b()` optional-call statements, which this rule flags but which are intentional
      'no-extra-boolean-cast': 'warn', // 15 — `!!x` in boolean returns
      'no-useless-escape': 'warn', // 9 — redundant backslashes in the bot-detection and reserved-word regexes; changing a regex is a behaviour change, so not a drive-by fix
      'prefer-const': 'warn', // 7
      'no-prototype-builtins': 'warn', // 2
      'no-async-promise-executor': 'warn', // 1 — choices.service.ts:164, a real latent bug (a throw inside is swallowed rather than rejecting); flagged for #6, not fixed here
      '@typescript-eslint/no-unsafe-function-type': 'warn', // 1 — shared.utils.ts:65 bare `Function`
      'no-useless-catch': 'warn', // 1

      // ---- Turned off, with reasons. ----
      // The codebase uses `_unused` parameters and leading-underscore private
      // fields extensively; tsconfig already sets noUnusedLocals/Parameters
      // false as a deliberate choice.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // envConfig.ts needs @ts-ignore to touch `import.meta` from a config that
      // targets a bundler; banning it would require editing src/, which is a
      // different lane's file.
      '@typescript-eslint/ban-ts-comment': 'warn',
      // `!` is used at DOM boundaries where a null check is genuinely redundant.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // TypeScript itself resolves identifiers, and it does so knowing the
      // `lib`/`types` from tsconfig. ESLint's core rule does not, so on a TS
      // file it only produces false positives (this is typescript-eslint's own
      // documented guidance). The .js scripts below get explicit globals
      // instead, so nothing loses the check.
      'no-undef': 'off',
    },
  },

  {
    // Test files legitimately use `any` to poke at internals and `console` to
    // report, and they never ship. No point warning about either here.
    files: ['tests/**/*.ts', '__tests__/**/*.ts', 'cypress/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  {
    // Build/config scripts run in Node, not the browser.
    files: ['*.config.ts', '*.config.js', 'scripts/**/*.js', 'config/**/*.js'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Must stay LAST: switches off every stylistic rule that would fight
  // prettier, so the two tools cannot disagree.
  prettierConfig,
);
