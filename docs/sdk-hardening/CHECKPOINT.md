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
| **Phase** | **Phase 0 complete** (audit). Phase 1 not started. |
| **Code changed so far** | **None.** Docs only. |

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

**Phase 1 — Make it a package. ⬜ Not started. This is the next phase.**

## 3. Next concrete action

Start Phase 1, task 1: fix `package.json` so the SDK is consumable as a package.

Today it has `"private": true` and `"version": "0.0.0"`, which means it cannot be
published or installed at all. Required: real `version`, `main`, `module`,
`types`, `exports`, `sideEffects: false`, `files`, `publishConfig`, `engines`,
plus `repository`/`license`/`homepage`.

Then, in order (full detail in `AUDIT.md` §2, Phase 1):

1. `package.json` publishable metadata. ← **start here**
2. Single-source the version. Delete the hardcoded `'v6.0'` literal at
   `src/main.ts:48`; inject via vite `define: { __SDK_VERSION__ }` from
   `package.json`; expose as `Intempt.VERSION`; stamp `$lib_version` on every
   outbound payload (needed for incident forensics).
3. Hand-author `src/index.d.ts` as the *public* contract (mirror
   `/home/beso/mixpanel-js/src/index.d.ts`), so internal refactors don't break
   consumers.
4. `CHANGELOG.md` + adopt changesets.
5. Split the init contract: keep the self-initializing IIFE for the CDN/snippet
   build, but the module build must export a pure `createIntempt(config)` with
   **no import-time side effects** — otherwise `sideEffects: false` is a lie.

## 4. Three live defects — fix regardless of phase order

These are real bugs found during the audit, not roadmap items. Each is small and
well-localised.

| # | Defect | Location | Symptom |
|---|---|---|---|
| 1 | `itemIdsSentSuccessfully` map is never pruned | `src/shared/queue/requestBatcher.ts` (declared ~line 42) | **Memory leak** on any long-lived tab; surfaces first in highest-volume customers |
| 2 | `handleResponse` returns before `removeItemsFromQueue` when `unloading: true` | `src/shared/queue/requestBatcher.ts` (~line 262) | **Duplicate event sends** on next page load |
| 3 | `optIn`/`optOut` set an in-memory flag only (`_autoTracker.doNotTrack`) | `src/intemptJs/intemptJs.ts` (~lines 55–75) | **Opt-out resets on reload** — a compliance defect, not a feature gap |

## 5. Highest effort-to-impact item in the whole plan

**Drop `psl`.** Measured: 152 KB raw, 9,353 public-suffix rule literals —
roughly **60% of the 252 KB bundle** — imported in exactly one place
(`src/shared/storageHandler.ts:3`) for exactly one function (`handleDomain`,
lines 48–63, cookie-domain derivation).

Mixpanel derives eTLD+1 heuristically in `src/utils.js` with no data table.
~15 lines changed saves ~150 KB raw / ~25 KB brotli on **every page load**.

If lazy-loading is preferred over removal, load it only on the cookie-write path.

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
| 1 | Make it a package (semver, `.d.ts`, exports, changelog) | +7 | 47 | ⬜ **Next** |
| 2 | Test foundation (vitest unit tier, port Mixpanel suites, coverage gate) | +12 | 59 | ⬜ |
| 3 | Reliability & perf core (IndexedDB tier, unload fix, transports, drop `psl`, code-split, load shedding) | +14 | 73 | ⬜ |
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
