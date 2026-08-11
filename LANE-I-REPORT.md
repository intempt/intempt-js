# Lane I — sdkLoader.ts report

## Commits
1. `e7875ad` fix(loader): D-17 — shopify/magento now go through `readBooleanParam` instead of `!!searchParams.get()`.
2. `0e01ef6` fix(loader): D-27 — `apiHost` uses `||` instead of `?? undefined`, so `?api_host=` (empty) falls back to the default.
3. `1c9e788` fix(loader): D-12 — constructor call wrapped in try/catch; logs via `log.error` and returns instead of throwing into the host page.

## Gates
1. `npm run build` — pass, typechecks clean.
2. `npm run test:unit` — 920/920 passed, 26 files.
3. `npm run test` (Cypress) — 122/122 passed.
4. `dist/intempt.min.js` = 92666 bytes (was 92548, +118). Attributable to the try/catch + doc comments added; no behavioral bloat.
5. `npx eslint src/loaders/sdkLoader.ts tests/unit/sdkLoader.test.ts tests/unit/sdkLoaderConfigParams.test.ts` — 13 warnings, 0 errors, **same 13 pre-existing `any`/`console` warnings as baseline** (verified via `git stash` diff) — none introduced.

## Assertions inverted (deliberate — these named the bugs)
- `sdkLoader.test.ts` shopify=false/shopify=0/magento=false: `toBe(true)` → `toBe(false)`.
- bare `shopify=` case: `toBe(false)` → `toBe(true)` (readBooleanParam's opt-in-on-empty semantics now applies uniformly).
- `api_host=""` case: `toBe('')` → `toBeUndefined()`.
- Three D-12 throw tests (no-script-found, missing required field, empty required field): `.toThrow(...)` → `.not.toThrow()`, plus `window.intempt` asserted unset.

## Found but not fixed
- `sdkLoaderConfigParams.test.ts:38` comment still references the old `!!get()` idiom by name for shopify — comment only, no assertion affected, left as-is (file is in scope but no code change needed there).
