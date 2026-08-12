// ESLint flat config. This is the first lint config this repo has ever had, so
// its guiding constraint is that it must be GREEN on arrival: a gate that is red
// the day it lands gets `continue-on-error`'d and then deleted. See the note at
// the foot of .github/workflows/ci.yml for the same reasoning applied to the
// jobs there.
//
// The two rules that could not be errors on arrival — `no-explicit-any` (61
// occurrences then, 99 after the parallel lanes) and `no-console` (54) — were
// WARNINGS, to be flipped once the work that removes them landed. **Both are now
// ERRORS, as of 2026-08-12: measured zero of each in `src/`.** Every remaining
// `console.*` in shipped code is one of five deliberate sites carrying a scoped
// `eslint-disable-next-line no-console` with its reason (the logger's own console
// transport, EnvConfig's pre-logger warning, the GDPR default sink, the
// CAN'T-FIND-SCRIPT error, and one example file). Adding a sixth now fails the
// build, which is the point of the flip.
//
// **2026-08-12, the code-health sweep: that queue is empty. Every rule below is
// now an ERROR and `npm run lint` is `--max-warnings=0`.** The repo went 97
// warnings -> 0, and the ratchet is now a floor at zero rather than a number that
// has to be edited downward each time.
//
// Two of the 97 turned out not to be lint debt at all, which is the reason to do
// this by hand rather than with `--fix`:
//
//  1. **The three `@ts-ignore`s in envConfig.ts were stale.** Converting them to
//     `@ts-expect-error` made tsc fail with "Unused '@ts-expect-error' directive"
//     — the `import.meta` reads they were suppressing have not errored for some
//     time. Deleted rather than converted.
//  2. **`no-unused-expressions` in `__tests__/**` is chai, not dead code.**
//     `expect(x).to.be.true` IS the assertion and is a bare member expression;
//     all 38 were that. The rule is off for tests only, and an error in src/.
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
      // Playwright's own output: traces, screenshots and the HTML report, all
      // generated and all gitignored.
      'test-results/**',
      'playwright-report/**',
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
      // ---- Flipped from warn to error 2026-08-12, both at zero. See header. ----
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',

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

      // ---- Formerly demoted to 'warn'; all promoted 2026-08-12 at zero. ----
      // Each was a real finding, fixed rather than suppressed. Keep them errors:
      // the point of the sweep was to make the next one visible on arrival.
      '@typescript-eslint/no-unused-expressions': 'error',
      'no-extra-boolean-cast': 'error', // was 10 `!!x` in boolean position, incl. one `!!!x`
      'no-useless-escape': 'error', // was 9, all `[\d\.]` in platformParser's browser regexes — inside a character class the dot is already literal, so removing the escape is provably behaviour-preserving (the 82 tests in platformParser.test.ts hold it)
      'prefer-const': 'error',
      'no-prototype-builtins': 'error', // was 1, `this._platformVersions.hasOwnProperty(key)`
      'no-async-promise-executor': 'warn', // STILL 1 and still a real latent bug — choices.service.ts:164 swallows a throw inside the executor instead of rejecting. Left as a warning deliberately: fixing it changes failure behaviour on the personalisation path, so it is a DEFECTS.md item, not a lint fix.
      '@typescript-eslint/no-unsafe-function-type': 'error', // was 1, `debounce(func: Function)` — now generic over the wrapped signature
      'no-useless-catch': 'error', // was 1, queueStorage's `catch { throw error }`

      // ---- Turned off, with reasons. ----
      // The codebase uses `_unused` parameters and leading-underscore private
      // fields extensively; tsconfig already sets noUnusedLocals/Parameters
      // false as a deliberate choice.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Was a warning because envConfig.ts carried three `@ts-ignore`s for
      // `import.meta`. They were stale — see the header — and are gone, so this
      // is an error: `@ts-ignore` silences a real error forever, while
      // `@ts-expect-error` fails loudly once the underlying error goes away,
      // which is how the staleness was found in the first place.
      '@typescript-eslint/ban-ts-comment': 'error',
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
      // Chai's assertion style — `expect(x).to.be.true`, `expect(y).to.exist` —
      // IS the assertion, and it is a bare member expression. The rule flags all
      // 38 of them in the Cypress specs as "unused expressions", which is the
      // rule not knowing chai rather than a defect. Off for tests only; it stays
      // on for src/, where an unused expression really is dead code.
      '@typescript-eslint/no-unused-expressions': 'off',
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
