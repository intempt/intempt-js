# CHECKPOINT — SDK enterprise-hardening programme

> **This file is written to be read cold.** Assume the reader has zero prior
> conversation context. Everything needed to resume is here or linked from here.
>
> **Keep it current: update this file in the same commit as the work it
> describes.** The next session will trust it.

| | |
|---|---|
| **Branch** | `beso/sdk-enterprise-hardening` |
| **Forked from** | `origin/staging` @ `8484bca` ("Merge pull request #185 from intempt/beso-fix-vars") |
| **Upstream tracking** | **deliberately unset** — see Invariants |
| **Last updated** | 2026-08-11 |
| **Phase** | Phase 0 ✅. Phase 1 🟡 (tasks 1–2 done, 3–5 paused by the user). §4 defects ✅. `psl` removal ✅ (a Phase 3 item, pulled forward). |
| **Code changed so far** | `package.json` metadata; version single-sourced; **all three live defects in §4 fixed**; **`psl` dropped — bundle 225.86 kB → 72.43 kB, zero runtime deps**. 16 specs / 235 tests, all passing. |

---

## 1. What this programme is

Bring the Intempt JS SDK from a measured **40/100** to **90+** on an enterprise
commercial-grade rubric, benchmarked against `mixpanel-browser` v2.81.0 (checked
out locally at `/home/beso/mixpanel-js`, Apache-2.0, so code reuse is permitted
with attribution).

Target operating point: enterprise-grade at **1M events/sec sustained ingest**
(≈1–10M concurrent sessions).

Full reasoning, per-dimension scores, and the 5-phase plan: **`AUDIT.md`** in
this directory. Settled decisions: **`DECISIONS.md`**.

## 2. Where we are

**Phase 0 — Audit. ✅ Complete.**

Delivered: `AUDIT.md` (score, 5-phase plan, proposed CI/CD harness, scale
engineering). No source files were modified — this was explicitly a report-only
phase at the user's instruction.

Headline: **Intempt 40 / Mixpanel 85.** The architecture scores ~70; the gap is
almost entirely *commercial shippability* (tests, semver/publishing, CI breadth,
observability, persisted consent, credential hygiene), which is additive work
rather than a rewrite.

**Phase 1 — Make it a package. 🟡 In progress.**

Task status (full detail in `AUDIT.md` §2, Phase 1):

1. ✅ **`package.json` publishable metadata.** Dropped `"private": true`, version
   `0.0.0` → **`6.0.0`** (continuing the `'v6.0'` literal the code shipped, so the
   package version does not contradict what customers already see). Added
   `description`, `keywords`, `homepage`, `bugs`, `repository`, `license` (MIT, per
   the existing `LICENSE`), `author`, `files`, `engines` (node ≥18),
   `publishConfig` (`access: public`, `provenance: true`), and
   `browser`/`unpkg`/`jsdelivr` → `dist/intempt.min.js`.
   **Deliberately NOT added yet, because they would be lies:**
   - `main` / `module` / `exports` — the only build output today is an **IIFE**
     (`vite.config.ts`, `format: 'iife'`). There is nothing importable to point
     at. These land with **task 5**, which adds the module build.
   - `sideEffects: false` — `src/main.ts` self-initializes at import time, so
     declaring this now would let a bundler tree-shake the whole SDK away. Lands
     with **task 5**.
   - `types` — lands with **task 3** (`src/index.d.ts`).
2. ✅ **Version single-sourced.** New `src/shared/version.ts` exports
   `SDK_VERSION`, resolved from a `__SDK_VERSION__` global that
   `vite.config.ts` `define`s by reading `package.json` at build time (with a
   `'0.0.0-dev'` fallback so tsc-only and direct-import cypress runs don't throw).
   The `'v6.0'` literal at `src/main.ts:48` is gone. Exposed as both
   `IntemptJs.VERSION` (static) and `window.intempt.VERSION` (instance).
   **Verified against the built bundle:** `6.0.0` and `VERSION` both present in
   `dist/intempt.min.js`, `v6.0` grep count 0.
   **Deferred deliberately — `$lib_version` on outbound payloads.** The natural
   place is `SessionEventModel` (`src/intemptJs/modules/autoTracker/models/session.model.ts`),
   but that changes the **wire payload** sent to
   `…/sources/<id>/track`. Ingest may reject or silently drop unknown fields.
   **Next session: confirm with the ingest team that a `$lib_version` field is
   accepted before stamping it.** Do not ship this blind — a rejected payload is
   dropped events.
3. ⬜ Hand-author `src/index.d.ts` as the *public* contract (mirror
   `/home/beso/mixpanel-js/src/index.d.ts`), so internal refactors don't break
   consumers.
4. ⬜ `CHANGELOG.md` + adopt changesets.
5. ⬜ Split the init contract: keep the self-initializing IIFE for the CDN/snippet
   build, but add a module build exporting a pure `createIntempt(config)` with
   **no import-time side effects** — then add `main`/`module`/`exports`/
   `sideEffects: false` from task 1.

## 3. Next concrete action

**Packaging is paused at the user's instruction (2026-08-11).** Phase 1 tasks 3–5
(`index.d.ts`, changelog/changesets, module build) are **deferred, not dropped**;
tasks 1–2 already landed and the test suite is green with them.

`psl` is dropped (§5) — that was the next item and it is done, along with all
three live defects in §4.

Next: **Phase 2, the test foundation** (vitest unit tier). It is the largest
single piece left and it gates everything after it — §8 has said so from the
start, and the last few commits leaned on the Cypress tier for cover that a real
unit tier should be carrying. `src/shared/publicSuffix.ts` also now supplies the
eTLD+1 helper that Phase 4's cross-subdomain consent cookie needs.

Open items carried forward:

- Get ingest-team confirmation before stamping `$lib_version` on payloads (D12).
- The deferred `package.json` entry fields land with Phase 1 task 5 (D11).

## 4. Three live defects — ✅ all three fixed

Real bugs found during the audit, fixed out of phase order because all three were
customer-visible today. Covered by `__tests__/batcherDedupeLifecycle.cy.ts`
(12 specs). Full suite now: **16 specs, 235 tests, all passing.**

| # | Defect | Fix |
|---|---|---|
| 1 | `itemIdsSentSuccessfully` never pruned → memory leak on long-lived tabs | `recordDeliveryAttempts()` now **deletes** an item's counter when its queue removal succeeds — the counter only ever mattered for items still in the queue, i.e. whose removal *failed*, so retaining the rest was pure leak. Hard cap `MAX_TRACKED_ITEM_IDS = 1000` as a backstop. **Also fixed the same class of bug in `sentEventIds`**: persistence was capped at 1000 but the in-memory `Set` was not, so it grew without bound while only the tail was ever written. `markEventIdsSent()` caps it, and an over-sized persisted set is trimmed on load. |
| 2 | `handleResponse` returned before `removeItemsFromQueue` when `unloading: true` → duplicate sends | On unload, if `isDefiniteSuccess(response)` (an `ok`/2xx, never an error or 0/5xx), the batch is now dequeued. Inconclusive outcomes keep the old retain-for-next-load behaviour — losing events is worse than a possible duplicate. **Second, deeper cause fixed:** items skipped by the `alreadySent` check were only `continue`d, so they sat at the head of the queue forever, burning part of every future batch, and became re-sendable once their eventId aged out of the capped window. They are now **evicted**. |
| 3 | `optIn`/`optOut` set an in-memory flag only → opt-out reset on reload | New `src/shared/consentState.ts` (`loadDoNotTrack` / `persistDoNotTrack`). `AutoTrackerModule._doNotTrack` initialises from storage; the setter persists. Opt-**in** writes too, so consent is not a one-way door. Storage errors are swallowed — `optOut()` must never throw back into a consent banner's click handler. |

### Carried-forward caveats from these fixes

- **Consent is origin-scoped.** `localStorage`, matching the rest of the SDK's
  client state, so an opt-out on `www.example.com` does **not** carry to
  `shop.example.com`. Cross-subdomain consent needs a cookie at the eTLD+1 —
  that lands with the `gdpr-utils` port (Phase 4), which will also want the
  `psl`-free eTLD+1 helper from Phase 3.
- **Newly observed, not fixed (out of scope):** `IntemptJs.optIn()`/`optOut()`
  dereference `this._autoTracker`, which is left `undefined` when the constructor
  bails on an invalid config (`intemptJs.ts:36`). Calling either on a
  misconfigured instance throws. One-line guard; deliberately not bundled into a
  consent-persistence commit.

## 5. Highest effort-to-impact item in the whole plan — ✅ done

**`psl` is gone.** Replaced by `src/shared/publicSuffix.ts`
(`extractEtldPlusOne` / `isHostOnlyTarget`), a heuristic with a small explicit
suffix set and no data table.

**Measured, before → after:**

| | Before | After |
|---|---|---|
| `dist/intempt.min.js` | 225.86 kB | **72.43 kB** |
| gzip | 64.89 kB | **20.86 kB** |
| Runtime dependencies | `psl`, `@types/psl` | **none** |

That is a **68% cut on every page load**, and the SDK now has a zero-dependency
runtime — which also removes the whole `psl` supply-chain surface ahead of
Phase 4.

**How it was verified — this matters if you touch the heuristic.** A parity
harness ran the old `psl`-backed `handleDomain` and the new one over 58
hostnames. It found and forced the fix for a real regression: private suffixes
(`github.io`, `vercel.app`, `herokuapp.com`, `appspot.com`, `blogspot.com`, and
**`myshopify.com`** — this SDK ships a Shopify tracker) resolve to a *public*
suffix under a naive last-two-labels rule, and a browser rejects such a cookie
outright rather than mis-scoping it. Those hosts now have their own entries.

Remaining intentional divergences from `psl`, both asserted in
`__tests__/publicSuffix.cy.ts`:

- IP literals and single-label hosts (`localhost`) now produce a **host-only**
  cookie. The old code emitted `domain=.0.1` / `domain=.localhost`, which
  browsers reject — so the cookie was silently dropped. **This is a fix.**
- Deep `.us` hierarchies (`example.pvt.k12.ma.us`) resolve one label too wide.
  Accepted: long tail, no known customer.

**Do not extend the heuristic by reasoning about it — re-run a parity check
against a current public-suffix list.**

## 6. Invariants — do not violate without asking

1. **Never push to `staging` or `main`.** The branch's upstream tracking was
   deliberately unset (it was created from `origin/staging` and would otherwise
   have pushed there by default). When first pushing, use
   `git push -u origin beso/sdk-enterprise-hardening`.
2. **Production deploys only from `main`**, and the `/v1` CDN path is *mutable* —
   overwriting it is live for all customers with no artifact to roll back to.
   One incident already: `af1a16b`, reverted in `3dc3a54`.
3. **After any deploy, verify the live bundle** and spot-check real host sites
   embedding the SDK. A green workflow is not evidence.
4. **Keep TypeScript.** Measured: zero downlevel helpers emitted
   (`target: ES2020`), so TS costs ~0 bundle bytes. It is not a footprint problem.
5. **Do not add features before the Phase 2 test tier exists.** Every feature
   added first makes the test tier more expensive to build.
6. Mixpanel is **Apache-2.0**. Direct code reuse is fine *with* attribution —
   retain license headers and NOTICE the derivation. Confirm with counsel before
   shipping copied files.

## 7. Phase map & projected score

| Phase | Scope | Δ | Cumulative | Status |
|---|---|---|---|---|
| 0 | Audit & plan | — | 40 | ✅ Complete |
| 1 | Make it a package (semver, `.d.ts`, exports, changelog) | +7 | 47 | 🟡 **In progress** (2/5 tasks) |
| 2 | Test foundation (vitest unit tier, port Mixpanel suites, coverage gate) | +12 | 59 | ⬜ |
| 3 | Reliability & perf core (IndexedDB tier, unload fix, transports, drop `psl`, code-split, load shedding) | +14 | 73 | 🟡 partial — **unload fix and `psl` removal landed early**; IndexedDB, transports, code-split, load shedding remain |
| 4 | Security, privacy, observability (credential hygiene, `gdpr-utils` port, logger, supply chain, kill `any`) | +11 | 84 | ⬜ |
| 5 | CI/CD, docs, release engineering | +9 | **91** | ⬜ |

Phase deltas assume the earlier phases landed; they are not independent.

## 8. If you only do three things

1. **Phase 2 (tests)** — unlocks safe change velocity for everything else.
2. **Phase 3 items 1, 2, 4** (IndexedDB, unload dequeue fix, drop `psl`) — the
   reliability bug and the bundle are both customer-visible today.
3. **Phase 4 items 1, 2** (credential hygiene, persisted opt-out) — the two
   findings that fail an enterprise security/privacy review outright.

## 9. Reference material

| What | Where |
|---|---|
| Full audit + 5-phase plan + proposed CI/CD harness | `docs/sdk-hardening/AUDIT.md` |
| Settled decisions + rationale | `docs/sdk-hardening/DECISIONS.md` |
| Mixpanel comparator checkout | `/home/beso/mixpanel-js` (v2.81.0) |
| Proposed CI/CD files (not applied) | `AUDIT.md` §3b — 7 files, with rollout order |
| Mixpanel files to port | `AUDIT.md` §3 — file-by-file table with effort estimates |
| Audit as a shareable web page | https://claude.ai/code/artifact/0976f36f-3570-499b-876f-7bca41f5854a |
| Originating session | https://claude.ai/code/session_018wfQQGBNVphxBe7QsJVCYV |

The artifact is a rendered copy of `AUDIT.md` for sharing with non-engineers.
**`AUDIT.md` in this repo is the authority** — if the two diverge, the repo wins.
To update the artifact, republish `AUDIT.md` passing that URL as `url`; publishing
without it creates a *second* artifact instead of updating this one.

## 10. How to resume from cold start

```bash
git checkout beso/sdk-enterprise-hardening
git log --oneline origin/staging..HEAD    # what this branch has added
```

Then read, in order: this file → `DECISIONS.md` → the relevant `AUDIT.md`
section for the current phase. Do **not** re-run the audit; it is done and its
numbers are recorded with the commit they were measured at.

If the phase table in §7 and the actual code disagree, **trust the code** and
correct this file.

### Known fragility of this recovery path

`CLAUDE.md` and these docs exist **only on branch
`beso/sdk-enterprise-hardening`** — they are not on `staging` or `main`. So a
session that starts on a different branch will not auto-load the pointer. Two
backstops cover that:

1. A project memory (`sdk-hardening-programme`) records the branch name and
   points here; it is not branch-scoped.
2. `git branch -a | grep hardening` finds the branch from anywhere in the repo.

If this programme gets merged to `staging`, move `CLAUDE.md` there too so the
pointer survives on the mainline.

**Not recoverable, and deliberately not relied upon:** the originating session's
conversation, and any scratch files under `/tmp/claude-*` (session-scoped). Every
durable output was copied into this repo before that mattered. If something is
only in a scratchpad, it does not exist.
