# CHECKPOINT — SDK enterprise-hardening programme

> **This file is written to be read cold.** Assume the reader has zero prior
> conversation context. Everything needed to resume is here or linked from here.
>
> **Keep it current: update this file in the same commit as the work it
> describes.** The next session will trust it.

|                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Branch**             | `beso/sdk-enterprise-hardening` — pushed; **PR #191 into `staging`**, all checks green                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Forked from**        | `origin/staging` @ `8484bca` ("Merge pull request #185 from intempt/beso-fix-vars")                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Last updated**       | 2026-08-12 (PR #191 open, every CI job green — §3s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Next action**        | **§3s is the current state — start there.** PR **#191** into `staging` is open, and **every job in `ci.yml` has now passed at least once**, including the two that had never run: `e2e` 126/126 and `mutation` 86.68% in 24m36s. All of §3p's code work is done (§3q defects, §3r prettier + `any` + splits) and the full-scope mutation score is now measured — **58.83%**, worklist in §3s. **Next: review and merge #191, then hand over `BACKEND.md`.** Four defects (D-14/18/19/20) and three release-note lines need a product decision. |
| **Score**              | **71 / 100** — re-scored 2026-08-12 against `AUDIT.md`'s ten dimensions; see **`AUDIT.md` §0a**, which supersedes every other figure in these docs (the ~78 in this row, the 62 in §0 and the ~81-83 in §3p were all extrapolations). Baseline 40, Mixpanel comparator 85. **Front-end-only ceiling ~81** with packaging parked. The remaining 14 points are itemised in §0a.                                                                                                                                                                  |
| **Tests**              | Unit **938** (32 files) · Cypress **126** · mutation **86.68%** core (floor **85**) and **58.83%** all-src (floor 57 — §3s) · coverage all src **76.89 / 70.70 / 77.23 / 77.38** (gates 75/68/75/75) · bundle **94,580 B / 27.57 kB gzip** · ESLint **0 errors / 97 warnings** (ratchet 97; `no-explicit-any` and `no-console` are **errors** at zero) · audit **2 moderate, 0 high**                                                                                                                                                          |
| **Phase**              | 0 ✅ · 1 ⏸ parked (packaging) · 2 ✅ tier-1 + CI gate + guard port + mutation · 3 ✅ except transports ⏸ (BE) and code-split (⬜, now cheap — see D-23) · 4 🟡 privacy ✅ §3h, client-side security ✅ §3g-ii, observability ✅ §3i, credential ⏸ (BE), `any` ✅ §3r · 5 🟡 CI breadth ✅ §3g, release/changesets ⬜                                                                                                                                                                                                                           |
| **Landed, by section** | §3a jitter · §3b circuit breaker · §3c bounded queue · §3d `ci.yml` · §3e guard-suite port · §3f mutation testing · §3g CI breadth + supply chain · §3h privacy & consent · §3i logger & metrics · §3j docs & DX · §3k public-API / payload-contract / choices tests · §4 three live defects · §5 `psl` dropped · §6a unit tier · §6b IndexedDB · §6c per-event records                                                                                                                                                                        |
| **Known defects**      | **7 remain open of 27 — `DEFECTS.md`.** 20 fixed. **None is unblocked code work:** D-1/D-3/D-15 need ingest, D-14/D-18/D-19/D-20 need one user decision (§3q). Severity-1 remaining: no event carries a timestamp; session events share one `eventId`.                                                                                                                                                                                                                                                                                         |

---

## 0. The two roadmaps

Work is split by who can do it, and each half has its own document:

|                       | Doc                                                           | Reaches       |
| --------------------- | ------------------------------------------------------------- | ------------- |
| Needs nobody else     | **`FRONTEND.md`** — 10 tasks, ranked by rubric points per day | 62 → **~85**  |
| Needs the ingest team | **`BACKEND.md`** — 5 items, handover spec                     | ~85 → **~91** |

**Current score: 62/100** (audit baseline 40, Mixpanel comparator 85). Dimension 4
(security) cannot exceed ~62 and dimension 2 ~86 without `BACKEND.md` item 1, so
**91 is not reachable front-end-only** — see `FRONTEND.md`, "The ceiling".

## 0a. The five-lane parallel merge — 2026-08-11

Five independent lanes were built concurrently in separate worktrees and merged
here. **Measured on the merged tree, not reported by the lanes:**

| Gate                         | Result                                                      |
| ---------------------------- | ----------------------------------------------------------- |
| Unit                         | **794 passed** (from 444)                                   |
| Coverage                     | 93.12 / 89.92 / 95.33 / 93.90 vs gate 90/87/87/90 ✅        |
| Mutation                     | **77.58%** (from 75.94), floor ratcheted 73 → **75** ✅     |
| Cypress                      | 122/122 ✅                                                  |
| Build + tsc                  | clean; bundle **91.25 kB / 26.64 kB gzip**                  |
| ESLint                       | 0 errors, 323 warnings (at the `--max-warnings` ratchet) ✅ |
| Secret scan / reserved words | clean ✅                                                    |

Lanes: **A** CI breadth + client-side security (§3g), **B** privacy & consent
(§3h), **C** structured logging & metrics (§3i), **D** docs & DX, **E** public-API
/ payload-contract / choices tests.

### Six things the merge itself surfaced — none were visible to any single lane

1. **`tsc` rejected lane E's tests while vitest accepted them.** `shopify` and
   `magento` are _required_ on `IntemptConfig`, and the new config literals omitted
   them. The unit tier does not typecheck, so a test can pass locally and still
   break `npm run build`. Fixed in the literals; the general lesson is that
   `npm run test:unit` is not a sufficient pre-merge check — `npm run build` is.
2. **Three of lane E's tests asserted on `console.*` that lane C had replaced**
   with the logger. Rewritten to assert through the logger's diagnostic sink,
   which is the behaviour; the console was only ever the transport.
3. **A logger-config leak between test files.** The logger is module-level state,
   so the suite that reconfigured it had to `resetLogger()` in `afterEach` — one
   payload-contract test failed only in a full run, never in isolation.
4. **ESLint reported 4048 problems instead of 323**, because `.claude/worktrees/`
   holds full checkouts (including their `dist/`). No lane could see this from
   inside one. `.claude/**` is now ignored.
5. **The size budget had to be re-baselined**: 83.5 → 93 kB raw, 23.6 → 27.2 kB
   gzip. Lanes B (+6.0 kB) and C (+3.45 kB) both landed real features. **This is
   the strongest argument yet for the parked code-splitting item** — the privacy
   scrubber's pattern tables and the logger are module-level, so every customer
   pays for them whether or not they are switched on.
6. **`§3g` was claimed by two lanes at once.** Renumbered A=§3g, B=§3h, C=§3i.
   Concurrent lanes cannot allocate section numbers; whoever merges has to.

**Not verified and still unverifiable from here:** anything requiring GitHub.
`release.yml`, the Sonar gate, and every job in `ci.yml` have never run — the
branch remains unpushed. **HISTORICAL, as of the date of this section only.**
Superseded by §0c (first push, `ci.yml` green) and §3s (PR #191: every job in
`ci.yml` has now passed at least once). `release.yml` and the Sonar gate are still
unexercised.

## 0b. TODO — the live worklist, ordered · 2026-08-11

**Read this section first if you are resuming.** Everything below is actionable
without asking anyone, unless marked ⏸.

### Needs a human decision, not code — these block real work

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | What it gates                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ~~**Deploy Node version.**~~ ✅ **resolved 2026-08-12 — the user approved the bump.** `build.yaml`'s three `node-version` matrices are now **22.x** (were 21.x). Invariant §6.2 is therefore _amended, not broken_: the deploy path may be edited with the user's explicit approval, and this is the record of it. **Not pushed** — the user wants the SDK tested first. Two follow-ons are NOT done and are still parked: `npm install` → `npm ci` in the same file (it currently resolves a fresh tree per run, which is what caused CI failures #1–2), and the `branches: ['*']` → `['**']` trigger fix (`BACKLOG.md` 4.3). Un-parking the vite advisory (`BACKLOG.md` 4.2) is now possible. | Was: the vite advisory, the meaning of the CI signal, and any future toolchain bump                                                       |
| 2   | ~~**DNT/GPC honoured by default.**~~ ✅ **resolved 2026-08-12 — the user approved a release note.** Wording is drafted in `RELEASE-NOTES-DRAFT.md`; it needs a home (`CHANGELOG.md`) once packaging is un-parked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Nothing now                                                                                                                               |
| 3   | **Hand `BACKEND.md` to the ingest team — ⏸ backlogged by the user 2026-08-12** (`BACKLOG.md` 1.3). Spec is written and ready. Shareable page: https://claude.ai/code/artifact/82bd5a93-23fe-49e5-b371-ae3fae3acd56                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **The tallest blocker in the programme:** all six `BACKEND.md` items, dimension 4's ~62 ceiling, and the wire-format defects D-1/D-3/D-15 |
| 4   | **Check live host sites for the `/v1`-less CDN URL** (D-12). The docs shipped a snippet that produces a silently dead integration. **User is checking 2026-08-13.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Any customer who copied the old docs                                                                                                      |

### Code work, in order

1. **Mutation testing to the user-set 85% floor.** At **80.31%**, floor ratcheted
   to 80. `storage/**` is done (§3f-ii). Needs **+112 detections**; at the measured
   2.4/test on no-coverage pools and 1.4/test on survived-only pools, that is
   ~50–80 tests. Next: `requestBatcher.ts` (110 undetected), `requestQueue.ts` (66),
   `consentCookie.ts` (45), `shared.utils.ts` (24, and the lowest-scoring file in
   the repo at 47.83%). Worklist and rate history: §3f-i, §3f-ii.
2. ~~**Re-baseline the coverage thresholds** in `vitest.config.ts` (D20).~~ ✅ done.
   Measured **95.55 / 90.83 / 96.88 / 96.35** over 821 tests (the storage batch
   lifted it from 93.12 / 89.92 / 95.33 / 93.90); gates moved 90/87/87/90 →
   **93 / 88 / 94 / 94** per D20's ~2-under rule. Branches is deliberately the
   loosest — it moves most on an unrelated refactor. History now lives in the
   comment above the `thresholds` block; **re-measure rather than interpolate,
   because vitest 4 counts statements differently from vitest 2.**
3. ⏸ **`FRONTEND.md` #1 packaging** (+3.6) — **backlogged by the user 2026-08-12**,
   to move together with the backend work. Was already parked once (§2a) and
   un-parked into this list; it is parked again. **The consequence is a score
   ceiling, and it is the largest single item on the list: without packaging,
   dimension 5 stays at 52 and the front-end-only ceiling drops from ~85 to ~81.**
4. **`FRONTEND.md` #6 code health** (+1.7) — 61 `any`, split `autoTracker.module.ts`,
   dedupe the id triplet. Then lower `--max-warnings` (**now 279**, was 323) and
   flip `no-explicit-any` / `no-console` to `error`. **Do not add the
   `optIn`/`optOut` guard this item once listed — DEFECTS D-24 shows its premise
   was wrong and the branch is unreachable.**
5. ⏸ **`FRONTEND.md` #9 code-splitting** (+1.2) — **backlogged by the user
   2026-08-12.** D-23's `ModificationHandler.ts` has been deleted already, under
   item 4 (§3l). **That deletion also refuted this item's premise: it saved zero
   bytes**, because vite never bundled an unimported module. Re-measure before
   planning the rest — see `BACKLOG.md` 1.2.
6. **`FRONTEND.md` #10 transport chain** (+0.6) — `fetch(keepalive)` → XHR now;
   the `sendBeacon` leg is ⏸ on `BACKEND.md` item 1.
7. **The repo-wide `prettier --write`.** 98 of 107 files fail `format:check`, which
   is why the Prettier step is `continue-on-error`. **It must land alone**, with no
   other branch open, and then that flag comes off.
8. **`DEFECTS.md`** — ~30 pre-existing defects found by the lanes, with a suggested
   order at the foot of that file. Do not batch them.

### Deliberately parked

**Moved out of this file — see `BACKLOG.md`**, which now carries every parked item
with its blocker and the cost of leaving it parked. Summary only: packaging (1.1),
code-splitting (1.2), the `BACKEND.md` handover (1.3), the six ingest items (§2),
the cross-browser device-cloud tier and `browser-tests.yml` (§3), changesets
automation and the two `build.yaml`-blocked CI items (§4).

## 0c. CI is live and green — first push 2026-08-11

The branch is **pushed** (`origin/beso/sdk-enterprise-hardening`, upstream set)
and **`ci.yml` is green**: lint, typecheck+build, audit, unit on Node 22 and 24.
`mutation` and `e2e` are `pull_request`-only and have therefore **still never
run** — the first PR into `staging` is where they get exercised.

It took **five** red runs, and each cause is worth keeping — four were
environment differences the local machine could not have shown, and the fifth was
a genuinely nondeterministic test:

| #   | Failure                                                               | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2 | every job at `npm ci`, EUSAGE                                         | The lock was generated by **npm 11**; the runner had **npm 10.5** (Node 21) and resolved the tree differently — `Missing: esbuild@0.28.2 from lock file`. `npm ci` was clean on every local npm, so this was only findable by pushing. Fixed by pinning `npm i -g npm@11` before every `npm ci`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | unit on Node 20                                                       | `webidl.util.markAsUncloneable is not a function` — an undici API jsdom 30 needs and Node 20 lacks. Every jsdom test file failed to start its worker. Matrix moved off 20.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4   | unit on Node 22, one test                                             | Test-harness race, not src: `flushAndCapture`'s 5 ms settle was not enough for the IndexedDB enqueue writes on that runner, so no request was issued and the caller dereferenced `undefined`. Now 20 ms + a 60×2 ms poll, and it throws with the URLs it did see.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5   | three goldens on Node 24, while 22 passed — **on a docs-only commit** | The goldens were nondeterministic. Every test in `payloadContract.test.ts` shares one SDK instance (deliberately — a second one duplicates every event, D-2), so earlier tests' events and the auto-tracked bootstrap could still be queued and ride along in a later flush. Each golden was recording "my event **plus whatever else was in this batch**", and which else varied with scheduling. Fixed with `trackBodyFor(call, ...names)`, narrowing each golden to the entries its own test generated; re-recorded, and the diff was **198 pure deletions** of shared `Session start` entries — no field, nesting or ordering within a kept entry changed. Each golden now describes exactly one event type, which is what makes it usable as an ingest contract. |

**The pattern across all five is worth internalising before the next push:** four
of the five were invisible locally and only one was a code defect. A different npm
minor, a different Node, and a differently-scheduled event loop each produced a
failure that no amount of local verification would have found. "Verified locally"
and "verified in CI" are genuinely different claims, and this programme spent most
of its life able to make only the first.

**A pre-existing finding from the same exercise: `build.yaml` never ran on this
branch at all.** Its trigger is `branches: ['*']`, and a single `*` does not match
a ref containing `/` — so **every feature branch with a slash in its name has been
completely ungated**, for as long as that file has existed. `ci.yml` uses `['**']`,
which is why it fires. Fixing `build.yaml` means touching the deploy path, so it
is a deliberate decision, not a drive-by.

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
almost entirely _commercial shippability_ (tests, semver/publishing, CI breadth,
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
3. ⬜ Hand-author `src/index.d.ts` as the _public_ contract (mirror
   `/home/beso/mixpanel-js/src/index.d.ts`), so internal refactors don't break
   consumers.
4. ⬜ `CHANGELOG.md` + adopt changesets.
5. ⬜ Split the init contract: keep the self-initializing IIFE for the CDN/snippet
   build, but add a module build exporting a pure `createIntempt(config)` with
   **no import-time side effects** — then add `main`/`module`/`exports`/
   `sideEffects: false` from task 1.

## 2a-i. Scope decisions from the user — 2026-08-12

- **`FRONTEND.md` #1 packaging is backlogged**, to move with the backend work.
  Largest single item on the list; parking it caps the front-end-only score at ~81
  rather than ~85. See §0b item 3.
- **`FRONTEND.md` #9 code-splitting is backlogged.** See §0b item 5 for the
  D-23 deletion that goes with it.
- **Everything else in §0b is to be worked.** Explicitly confirmed: mutation to 85
  (§0b 1), the coverage re-baseline (§0b 2, done), code health (§0b 4), the
  transport chain (§0b 6), the prettier sweep (§0b 7), and `DEFECTS.md` (§0b 8).
- **Decisions #3 and #4 of §0b are the user's to carry out** — hand `BACKEND.md`
  to the ingest team, and check live host sites for the `/v1`-less CDN URL.
  **#1 (deploy Node version) and #2 (DNT/GPC customer comms) are still open.**

## 2a. Scope decisions from the user — 2026-08-11

Recorded so they are not re-litigated:

- **npm packaging is backlogged.** Phase 1 tasks 3–5 (`index.d.ts`, changesets,
  module build) are parked. Tasks 1–2 already landed and stay.
- **Anything requiring backend work is backlogged.** That parks: the transport
  fallback chain (`sendBeacon` needs the credential off the `Authorization`
  header — D7), `$lib_version` stamping (D12), ingest idempotency on `eventId`,
  and the server-controlled load-shedding brake. **`docs/sdk-hardening/BACKEND.md`
  is the handover spec for all of it** — hand that to the backend team.
- **Code-splitting: not now.**
- **IndexedDB: approved**, and done — see §6b.

Remaining work that needs nothing from anyone else:

1. **Load shedding, client-side three of four — ✅ complete.** Jitter (§3a),
   circuit breaker (§3b), bounded queue (§3c). The fourth needs the backend.
2. Rest of Phase 2 — `ci.yml` so the tiers gate merges ✅ (§3d), guard suites
   ported into the unit tier ✅ (§3e); still open: golden-file contract tests on
   the payload shape.
3. ~~Cross-subdomain consent cookie (the D15 limitation).~~ ✅ done — §3g.
4. Phase 4 client-side leftovers — structured logger, killing `any`.

## 3a. Load shedding 1 of 3 — jitter ✅ (retry backoff + flush interval)

Landed 2026-08-11 in `src/shared/queue/requestBatcher.ts`. **Decisions the user
made — do not re-litigate:**

- **Full jitter**, not equal jitter: `sleep = random(0, ceiling)`. The usual
  objection (a client may retry almost immediately) does not apply, because
  `flush()` cannot start while `requestInProgress` is true.
- **Steady-state flush interval jittered too**, in a follow-up commit: `±10%`
  around the configured value via `jitterAroundBase()` in `resetFlush()`, which
  is the single choke point for the normal schedule. A _narrow band_, not full
  jitter — this path is not a failure response, and the configured interval is a
  batching-latency contract the customer set; full jitter here would halve
  effective throughput on average and make batch sizes erratic. That band is
  asserted by a test, so it cannot drift.
  One consequence: the retry ceiling now bases off `libConfig.batchFlushIntervalMs`
  rather than `flushInterval`, since the latter carries the steady-state draw and
  the backoff schedule should not inherit an unrelated random number.
- **`Retry-After` is honoured exactly, unjittered**, pending a backend answer —
  see the open question below.

**The one non-obvious implementation point.** `scheduleFlush()` assigns
`this.flushInterval = flushMS`, so the exponential doubling used to ride on the
scheduled delay itself. Feeding it a _jittered_ delay would make the next ceiling
double from a random draw — a low draw collapses the backoff and the fleet creeps
back toward hammering, i.e. the change would silently undo itself. So a separate
`retryCeilingMS` field doubles deterministically and only the sleep is jittered.
`resetFlush()` clears it, so a later unrelated failure starts from the base
interval rather than resuming the last incident's ceiling. There is a test for
each of those three properties.

**Tests:** 6 added, taking the unit tier to 135 at that point (147 now, after §3b–§3c). The fleet-spread test runs 100 independent
batchers through one failure each and asserts >50 distinct delays — under
deterministic backoff that collapses to 1, so the test states the thundering herd
as an assertion. `schedules a backoff instead of hammering ingest on a 500` had to
pin `Math.random`; it was flaky by construction otherwise, since a low draw
legitimately retries inside its 500 ms window.

**Open question for the backend team — carried into `BACKEND.md`:** does
`…/sources/<id>/track` ever emit a `Retry-After` header, and on which statuses?
The SDK parses it at `autoTracker.module.ts:205` but nobody has confirmed ingest
sends it, so that branch may be dead code. If it _is_ live, honouring it verbatim
means every client told "come back in 30s" returns in the same 30th second — the
same herd, server-scheduled — and it should become a floor jittered upward
(`retryAfter + random(0, retryAfter * 0.2)`).

**Note for benchmarking against Mixpanel: Mixpanel does not jitter at all.**
`request-batcher.js:274` is `var retryMS = this.flushInterval * 2;`, identical to
what this SDK shipped (ours is a port). They jitter their shared-lock poll
(`shared-lock.js:68`) but never the backoff. So this item is _ahead_ of the
comparator, not catching up to it — do not "correct" it back toward Mixpanel.

## 3b. Load shedding 2 of 3 — circuit breaker ✅

Landed 2026-08-11 in `src/shared/queue/requestBatcher.ts`. **Parameters the user
chose — do not re-litigate:** trip at **5** consecutive delivery failures, open
window **60s jittered**, **per-tab and in memory**.

Jitter spread retries across the fleet but did not reduce how many a client
makes: against an ingest tier that is genuinely down, every client kept knocking
forever, and the moment of recovery — when every client's backlog is deepest — is
exactly when that traffic is most damaging. The breaker adds the missing step:
conclude the service is down, stop, and test recovery with a **single probe**
instead of the whole queue.

State is two fields, `consecutiveSendFailures` and `breakerOpenUntilMS`
(`0` = closed). Open means the guard at the top of `flush()` returns without
sending; the first flush after the window passes is the half-open probe, which a
success closes and a failure re-opens.

**Four decisions embedded in the code, each with a test:**

- **Guarded in `flush()`, not only at the scheduler.** `flush()` has several
  other callers (enqueue-triggered, the post-success continuation, the timeout
  path) that would otherwise walk straight past an open breaker.
- **An unload flush bypasses the breaker.** That is the last chance those events
  ever get, and one keepalive request from a dying page is not the load the
  breaker exists to shed.
- **Open stops sending, never collecting.** Events keep queueing, or an ingest
  outage would become permanent client-side loss. (This is what makes item 3 of 3
  below load-bearing: the queue now grows during exactly the window the breaker
  holds open.)
- **400/413 do not touch the counter in either direction.** Ingest is up and
  rejecting a specific payload — neither evidence of an outage nor of recovery.
  Only a confirmed delivery closes the breaker.

**Per-tab was chosen over shared-via-storage** because a shared breaker needs
persisted state, a staleness policy and cross-tab race handling — real complexity
immediately after per-event records got `SharedLock` off the hot path (§6c). A
multi-tab user sends a few extra probes; that is nothing against the fleet-wide
reduction.

**Test note:** `caps the jittered backoff ceiling at ten minutes` now holds the
breaker closed by hand. The breaker legitimately trips at 5 failures, long before
the ceiling reaches its cap, so the two mechanisms are tested in isolation.
6 breaker tests added, taking the unit tier to 141 at that point (147 now, after §3c).

## 3c. Load shedding 3 of 3 — bounded queue + drop policy ✅

Landed 2026-08-11 in `src/shared/queue/requestQueue.ts`. **Parameters the user
chose — do not re-litigate:** cap by **event count** (10,000, overridable via
`maxQueuedEvents`), **drop oldest**, surfaced as a **counter + the existing
`errorReporter`**.

Previously the queue grew until the storage tier's quota failed, and a quota
failure is **silent**: the write throws, the event falls back to memory, nothing
counts what was lost. §3b made that load-bearing rather than theoretical — the
circuit breaker deliberately stops sending for 60s at a time while events keep
arriving.

A cap does not avoid data loss. It converts unbounded, silent, quota-driven loss
into bounded loss with a number attached — `getDroppedEventCount()` on both
`RequestQueue` and `RequestBatcher`, plus a report through `errorReporter` at each
drop. The number is the deliverable.

**The performance trap, and how it is avoided.** An exact count means listing
every key — the O(N)-per-enqueue cost that per-event records (§6c) exist to
remove. Paying it on every enqueue to enforce a limit almost never reached would
undo that work. So `approxQueuedCount` tracks locally and the real scan runs
**only when the estimate reaches the cap**, where it doubles as a resync. The
estimate can only drift low (by missing another tab's writes), and the scan at
the boundary is what actually enforces the cap, so drift is harmless.

Cap enforcement failures are caught and reported but never reject the event — it
is already written by then, and failing there would turn housekeeping into loss.
Memory-only mode is capped too, same drop-oldest policy.

**Ordering caveat, found by a test and accepted.** "Oldest" means key order, and
`makeItemKey`'s tiebreak sequence is **per-instance**, so two tabs writing inside
the same millisecond interleave arbitrarily — eviction can drop an event a
fraction of a millisecond newer than another. The ordering limitation is
pre-existing; the cap only makes it observable. Not worth a cross-tab counter:
the cost is a few misordered events at the boundary of an already-overflowing
queue, and the fix would put shared state back on the hot path §6c just cleared.
The cross-tab test therefore asserts the cap holds, not _which_ event went.

6 tests added (147 unit total).

## 3d. Phase 2/5 — `ci.yml`, the merge gate ✅

Landed 2026-08-11 as `.github/workflows/ci.yml`. Everything built in this
programme was previously guarded by tests that ran **only when someone
remembered to run them**; this converts them into a gate.

**The two real gaps it closes.** `build.yaml`'s `Build-and-Test` job runs on
_push_ only, skips `main`/`staging` refs, and runs only Cypress + build. So
(a) the 147-test vitest tier and its coverage gate ran **nowhere** in CI, and
(b) a **pull request** into `staging` or `main` was gated by **nothing at all**
— the autopr-created staging→main PR included.

Three jobs, each running a script that already exists and already passes:

| Job     | Command                                                             | Node              |
| ------- | ------------------------------------------------------------------- | ----------------- |
| `unit`  | `npm run test:coverage` (thresholds enforced in `vitest.config.ts`) | matrix 20.x, 21.x |
| `build` | `npm run build` + `node scripts/checkReservedWords.js`              | 21.x              |
| `e2e`   | `npm run test:e2e`                                                  | 21.x              |

**Decisions worth not re-deriving:**

- **`build.yaml` is untouched** — it is the live deploy path to the mutable
  `/v1` CDN URL (Invariants §6.2). The new file sits beside it.
- **`e2e` is `pull_request`-only.** `build.yaml` already runs the Cypress suite
  on every branch push, so running it on push here too would pay for the same
  assertions twice (213 at the time; 122 after the §3e migration). The PR into `staging`/`main` is the gap, and that is
  what this job covers.
- **Node 21.x is in the matrix because `build.yaml` deploys on 21.x.** If CI ran
  only a different major, CI-green would not imply deploy-green. 20.x is the
  second leg, to catch accidental use of newer Node built-ins.
- **`npm ci`, not `npm install`** (`build.yaml` uses `install`, which mutates the
  lockfile and makes the run non-reproducible). Verified `npm ci` succeeds on
  the committed `package-lock.json` (lockfileVersion 2).
- **The Cypress binary is cached separately** at `~/.cache/Cypress`;
  `cache: npm` only covers `~/.npm`, and the binary download is the slow part.

**Four jobs from the `AUDIT.md` §3b draft were deliberately dropped**, because a
gate that is red on arrival gets disabled. The reasons are also written into the
workflow file itself so they are not lost:

- **Lint / prettier** — there is no `lint` script and no ESLint or prettier
  config in this repo. The job would fail on _command not found_.
- **Size budget** — needs `.size-limit.json` pinned at the current 81.74 kB /
  23.08 kB gzip first, then it can ratchet.
- **`npm audit --audit-level=high`** — **measured 2026-08-11: 19 advisories
  (8 high, 4 critical), all of them in devDependencies** (cypress, vite, vitest,
  rollup, `@rollup/plugin-terser`). The SDK has zero runtime dependencies, so
  none reach a customer bundle, and every available fix is a breaking major
  bump. This is Phase 4 supply-chain work with the dependency upgrades, not a
  merge gate today.
- **Cross-browser WDIO/Sauce tier** — `AUDIT.md` §3b File 2, needs an account.

**Verified before commit**, each command run locally on this branch, not
inferred: `npm ci` exit 0; `npm run test:coverage` 147/147 with the gate passing
(statements/lines 90.34%, branches 86.37%, functions 86.71% — the numbers as of
_that_ commit; §3e supersedes them); `npm run build`
clean at 81.74 kB / 23.08 kB gzip; `checkReservedWords.js` clean;
`npm run test:e2e` 213 passing / 4 pending. The YAML was parsed to confirm the
three jobs and both triggers resolve.

**Still not verified, and cannot be from here:** that the workflow is green _on
GitHub_. **HISTORICAL — superseded by §0c and §3s; every job in this file is now
green on PR #191.** At the time of writing the branch was unpushed. First push must be
`git push -u origin beso/sdk-enterprise-hardening` (Invariants §6.1) — and note
that push will trigger both `build.yaml` and this new file. Watch the first run.

## 3e. Phase 2 — guard suites ported, coverage scope widened ✅

Landed 2026-08-11. `__tests__/trackingGuard.cy.ts` and `__tests__/botGuard.cy.ts`
were **migrated and deleted**, not duplicated — do not go looking for them. Four
new unit files, **210 new tests** (unit 147 → **357**, Cypress 213 → **122**).

| New file                                  | Covers                                                  |
| ----------------------------------------- | ------------------------------------------------------- |
| `tests/unit/guardConditions.test.ts`      | all 10 condition factories                              |
| `tests/unit/botDetection.test.ts`         | `isLegitimateBrowser`, `isLikelyBot`, the crawler guard |
| `tests/unit/trackingGuardManager.test.ts` | manager lifecycle + `checker.ts`                        |
| `tests/unit/intemptJsGuard.test.ts`       | `IntemptJsGuard` — **had no test anywhere**             |

**Coverage went up, not down**, despite the scope widening — `src/shared/**` plus
`src/guard/**` plus `src/intemptJs/guards/**`:

|                    | Before (shared only) | After (all three) |
| ------------------ | -------------------- | ----------------- |
| Statements / lines | 90.34%               | **92.57%**        |
| Branches           | 86.37%               | **89.64%**        |
| Functions          | 86.71%               | **88.88%**        |

Thresholds moved in the same commit per **D20**: 85/75/85/85 → **90/87/87/90**,
about two points under measured. Widening `coverage.include` without raising them
would have silently _lowered_ the effective bar, which is the whole point of D20.

**Two things the port found that the Cypress specs had hidden.**

1. **`src/intemptJs/guards/**` had no test in either tier.** The earlier note in
   this checkpoint that "the guards already have 91 Cypress assertions" was true
   only of `src/guard/**` (tracking guards). `IntemptJsGuard` — the validation
   every public method calls first, for `track`/`identify`/`group`/`alias`/
   `record`/`consent` — was completely uncovered. It now has 80 tests, and they
   pin the **exact throw messages**, because those surface in the customer's own
   call stack and are therefore public contract.
2. **`botGuard.cy.ts` contradicted itself, and three `it.skip`s were hiding a
   real gap.** The spec skipped `SuspiciousBot`/`FakeBot` with a comment saying
   the guard does not catch them, while its `Multiple Bot Patterns` table
   asserted `false` for the same input. The table was right. Those skips are now
   assertions in a `known false negatives` block, so the gap is written down where
   someone will read it and closing it shows up as a failing test.

   **The mechanism is worth knowing before anyone "fixes" it**, because it is
   counter-intuitive: `isLegitimateBrowser` rejects `compatible; XxxBot` via
   `/compatible;\s*[a-z]+bot/i`, so the UA is _not_ a browser — and the guard
   therefore never runs its browser branch, which is the only place that blocks an
   unrecognised identifier after `compatible;`. **The pre-check that correctly
   identifies these as non-browsers is what routes them around the check that
   would have blocked them.** A denylist entry will not fix it; the
   compatible;-inspection has to move out of the browser branch.

**Also newly pinned as asserted behaviour** (found while writing the tests, all
pre-existing, none fixed here): `createPathBlockGuard` is prefix-based so
`/admin` blocks `/administrator`; a `/g` regex passed to
`createUrlPatternBlockGuard` makes the guard alternate true/false on identical
input; `createTimeBlockGuard(n, n)` blocks nothing rather than everything;
`isValidConfig` checks `=== ''` so a **missing** field passes entirely; and
`isGroupValid` accepts `accountId: 0`/`''` while `isIdentifyValid` rejects the
same shapes for `userId`. Each has a test naming it, so none is load-bearing on
memory.

**Timer control was the concrete win from moving tier.** `createTimeBlockGuard`'s
overnight-wrap branch is unreachable in a real browser — you cannot assert a
22:00–06:00 window at 14:00 — so Cypress never tested it. `vi.setSystemTime` pins
the hour and every branch is now covered.

## 3f. Phase 2 — mutation testing ✅ (baseline 70.66%)

Landed 2026-08-11: **StrykerJS + the vitest runner**, `stryker.conf.json`,
`npm run test:mutation`, wired into `ci.yml` as a `pull_request`-only job.

**Why, in one sentence:** line coverage says a line _ran_; mutation score says a
test would _notice_ if that line were wrong — and the three data-loss defects the
property tests found (§6a) were all in code that was already "covered".

**Baseline, measured twice and identical both times** (2,123 mutants over
`src/shared/**` + `src/guard/**` + `src/intemptJs/guards/**`, 3m 0s / 3m 14s):

| Area                   | Mutation score | Line coverage |
| ---------------------- | -------------- | ------------- |
| **All files**          | **70.66%**     | 92.57%        |
| `src/intemptJs/guards` | 97.51%         | —             |
| `src/guard`            | 85.48%         | —             |
| `src/shared`           | 59.71%         | —             |
| → `src/shared/queue`   | **54.93%**     | —             |
| → `src/shared/storage` | 64.09%         | —             |

1,285 killed · 13 timeout · 398 survived · **141 with no coverage at all**.

**The result is the finding, and it is not flattering to the work this programme
has been doing.** The queue core — `requestBatcher.ts` 54.92%, `requestQueue.ts`
54.96% — is the most heavily tested code in the repo, the code §3a–§3c added six
tests each to, and it scores **worst**. The guards, ported in an afternoon, score
85–98%. Line coverage of 92.57% was hiding a roughly 30-point gap between "ran"
and "asserted".

Concrete survivors, all from code this programme wrote or hardened:

- `getDroppedEventCount()` emptied to return nothing — **the §3c drop counter,
  whose entire deliverable is "the number"**, and no test would notice it
  returning `undefined`.
- `start()` emptied entirely, and `this.stopped = false` flipped to `true`.
- `clear()` emptied to a no-op.
- `breakerOpenUntilMS > Date.now()` → `>=`, i.e. the breaker's boundary condition
  is unasserted (§3b).
- `/compatible;\s*[a-z]+bot/i` → `\s` and `\S*`: the bot pre-check regex from
  §3e can be weakened without a single test failing.

**Threshold policy: `break: 65`, deliberately below the 70.66% baseline.** This
gate is a **ratchet, not a bar** — it catches a regression while leaving headroom
for the 13 timeout-classified mutants, which are the one non-deterministic part
of the score. Raise it as the score climbs; never lower it. `high: 85` / `low: 65`
only colour the report.

**Two configuration points that are load-bearing, not tuning:**

- **`vitest.related: false` is required.** Stryker's default asks vitest which
  test files are "related" to a mutated source file; that graph comes up empty
  here because this repo imports with explicit `.ts` extensions (a repo
  convention), so the dry run aborts with `No tests were executed`. Running the
  whole tier per mutant is affordable — it is ~1.3s.
- **`ignoreStatic: true`** keeps module-level constant initialisers out of scope.
  Without it the bot denylist array alone contributes ~100 meaningless mutants.

**CI placement:** `pull_request` only, like `e2e`. ~3.5 min is too slow for every
push and exactly right before a merge.

### 3f-i. First batch of mutant-killing tests, and what it measured — 2026-08-11

Six tests were added to `tests/unit/requestBatcher.test.ts` aimed at the named
survivors above, explicitly **to measure the kill rate rather than to chase the
score**. The measurement is the deliverable, and it contradicted the estimate:

|                     | Before | After      |
| ------------------- | ------ | ---------- |
| Overall score       | 70.66% | **71.42%** |
| `requestBatcher.ts` | 54.92% | **58.74%** |
| Survived            | 398    | 397        |
| No coverage         | 141    | 128        |

**6 tests killed 14 mutants — about 2.3 each, and +0.76 points overall.** The
prior estimate in this document was "15–25 tests gets us to the low 80s". That
was wrong by roughly 4×: at the measured rate, +10 points needs on the order of
**80–100 tests**. Do not plan on the old number.

**Why the survivor count barely moved (398 → 397) while 14 mutants died.** Almost
all the kills came out of the _no-coverage_ column, not the survived column —
those six tests reached code nothing had executed before. The 397 remaining
survivors are different in kind: they are in code that **does** run and is simply
not asserted, so each needs its own targeted assertion. There is no bulk win left
in this file.

**User decision, 2026-08-11: the floor is to be 85%.** The recommendation below
was overruled — go to 85, in file order, ratcheting `break` upward as each file
lands rather than setting 85 up front (setting it now would fail every PR for the
duration). Progress:

| Step                                                  | Tests added | Overall    | File                             |
| ----------------------------------------------------- | ----------- | ---------- | -------------------------------- |
| baseline                                              | —           | 70.66%     | —                                |
| `requestBatcher.ts` first pass                        | 6           | 71.42%     | 54.92 → 58.74%                   |
| `requestQueue.ts`                                     | 30          | 73.76%     | 54.96 → **72.73%**               |
| `requestBatcher.ts` response classification           | 34          | 75.12%     | 58.74 → 65.57%                   |
| `requestBatcher.ts` dedupe/scheduling internals       | 23          | **75.94%** | 65.57 → **69.67%**               |
| five-lane merge (logger + privacy arrived with tests) | —           | 77.54%     | —                                |
| `storage/**` — see §3f-ii                             | 27          | **80.31%** | 64.09 → **84.52%**               |
| `consentCookie.ts` — see §3f-iii                      | 18          | **80.90%** | 61.54 → not re-split (see below) |

`break` is now **80** (was 75). Raise it with each batch; never ahead of the work.

**Remaining to 85%** (as of 80.31%): 381 survived + 88 no-coverage = 469 undetected
of 2382 mutants. Detected 1913; 85% needs 2025, i.e. **+112**. Next pools, largest
first: `requestBatcher.ts` 110 (95 survived + 15 no-cov — the enqueue/flush body),
`requestQueue.ts` 66, `consentCookie.ts` 45, `indexedDbStore.ts` 33,
`trackingGuard.conditions.ts` 32, `shared.utils.ts` 24 (**47.83%, the lowest file
in the repo**), `browserDetection.ts` 19, `consentState.ts` 18,
`storageHandler.ts` 14.

### 3f-ii. The storage batch — 27 tests, +2.77 points, 2.4 kills per test

**The rate beat the §3f-i projection (1.4–1.9/test) because this batch went at the
no-coverage column, not the survived column.** §3f-i's own note said the cheap
bulk wins were gone _in `requestBatcher.ts`_; that did not generalise —
`storage/**` still had 53 of its 116 undetected mutants with no coverage at all.
**Pick the next file by its no-cov count, not its total.**

| File                 | Before | After      |
| -------------------- | ------ | ---------- |
| `persistentStore.ts` | 48.68% | **94.74%** |
| `indexedDbStore.ts`  | 56.59% | 74.42%     |
| `queueStorage.ts`    | 76.27% | 89.83%     |
| `storage/**`         | 64.09% | **84.52%** |

`queueStorage.ts` rose without a single test naming it — the `PersistentStore`
fallback-tier tests exercise it as the delegate, which is how it should be tested
anyway.

What was actually missing: `PersistentStore`'s `entries`/`keys`/`removeItems`/
`removeItem` had **no test at any level**, so all four catch-and-demote branches
were dead to the suite (one parameterised case per method now, asserting the
distinct report string — the fallback is written out per method, not shared, so a
shared test would not have caught a wrong one). On `IndexedDbStore`: the cursor
prefix range, the `>= limit` boundary at limit 0, `close()`, `onversionchange`,
the open-failure reject, and the synchronous-throw path in `request()`.

**One finding, now asserted in two tests.** `indexedDbStore.ts:79` says the next
call re-opens after another tab's `onversionchange`. It does not: the store is
pinned to `DB_VERSION = 1`, so once a newer bundle raises the version, **every
later open from this bundle fails with `VersionError` and the IndexedDB tier is
gone for the life of the page.** Contained, not data loss — `PersistentStore`
demotes to localStorage and events keep flowing, which the companion test asserts
end-to-end — but the source comment overstates recovery. Do not "fix" the comment
by making the store re-open at whatever version it finds; that would silently
adopt a schema this bundle does not know.

### 3f-iii. The consent-cookie batch — 18 tests, +0.59 points. Read this before picking the next file.

**This batch was low-yield and the reason generalises.** 18 tests moved the overall
score 80.31 → **80.90**, roughly **0.8 detections per test** — worse than the
1.4/test §3f-i measured on survived-only pools, and a third of the storage batch's
2.4. `consentCookie.ts` entered at 61.54% with 45 undetected (13 of them no-cov),
which by the §3f-ii heuristic looked cheap. It was not.

**Why, so the heuristic can be corrected:** the no-cov mutants in this file are
concentrated in _guards against missing globals_ (`typeof document === 'undefined'`,
the `window.location` catch) and in **string literals inside `onFailure` reports**.
A test can execute those branches — mine do — without killing many mutants,
because the observable behaviour of most mutations there is identical (still
returns `null`, still returns `false`, still does not throw). **Refine the rule to:
prefer no-cov mutants in code that computes a value, not in code that guards or
reports.** A file full of defensive early-returns has a low ceiling per test.

The tests are still worth having — they pin rule 1 of that module, _nothing here
may ever throw_, across SSR and sandboxed-iframe conditions, and that is a real
compliance property, not a score chase. But do not budget the remaining ~100
detections against files shaped like this one.

The domain-scoped assertions had to go in `consentState.test.ts`, not
`consentCookie.test.ts`: jsdom fixes the document URL per file, and the `domain=`
and `Secure` attribute paths only execute on the `https://shop.example.com` file.
Both files now share a `captureCookieWrites()` helper shape, because jsdom does not
expose cookie attributes through the getter — intercepting the setter is the only
way to assert on them.

**Per-file scores for this run were lost to a truncated log** (the command was
piped through `tail`). `reports/mutation/index.html` has the full split; it is
gitignored, so re-run `npm run test:mutation` if you need it.

**Also in this commit: `--max-warnings` 323 → 279.** Measured 279 with 0 warnings
from the new file, i.e. the ratchet had drifted 44 points loose since §3g pinned
it. Per §3g's own rule, lower it to the measurement whenever it has slack.

Earlier figure, kept for the rate history: 338 survived + 119 no-coverage = 457 undetected. Detected is
1380 of 1837; 85% needs 1561, i.e. **+181 detections**. At the observed rate
(1.4–1.9 per test) that is **~100–130 more tests**. Where they are, in order:
`requestBatcher.ts` 107 survivors + 19 uncovered (flush/enqueue/scheduling paths,
lines 175–560 — the response-classification block at 585–743 is now done),
`indexedDbStore.ts` 56, `persistentStore.ts` 39, `shared.utils.ts` 24,
`storageHandler.ts` 23, `browserDetection.ts` 19, `requestQueue.ts` 58 (the
harder half: enqueue/cap internals, lines 114–236), tail elsewhere.

Kill rate so far: 36 tests, +89 detections, +3.1 points. The rate _fell_ on the
second pass (2.3 → 1.4 mutants per test) because the remaining survivors are
deeper paths needing their own setup, not shallow accessors. Extrapolating from
the second number, 85% needs roughly another **100–130 tests**.

**A second real defect came out of it, in the legacy migration.** The fallback
deadline (`entry.flushAfter || Date.now()`) went into the record's _key_ but not
into the record, so an imported legacy entry with no `flushAfter` kept
`undefined` — and every later comparison is `now > item.flushAfter`, which is
false against `undefined`. Such an event could therefore **never be adopted as an
orphan by another tab**; it only sent from the tab that imported it. That is two
genuine defects now found by writing these tests (the other: `maxQueuedEvents`,
§3f-i), which is the argument for continuing regardless of where the score lands.

**Recommendation, therefore: treat 71.42% as a ratchet floor and stop chasing the
number.** Mutation score has already paid for itself twice (see the defect below,
and §3f's list); grinding to 85% would cost ~80 tests, many of them asserting
implementation detail, on code that a property-test suite already covers
behaviourally (§6a). Spend the next effort on the payload contract tests instead,
and kill individual survivors opportunistically when touching that code.

**A real defect fell out of writing test #1 — the more valuable result.**
`maxQueuedEvents` was a `RequestQueue` option that `RequestBatcher` never passed
through, so the "cap by event count, overridable via `maxQueuedEvents`" recorded
in §3c **was not overridable from the SDK's only entry point** — every customer
was pinned to the 10,000 default with no way to lower it, and the option looked
configurable in the docs. Now on `BatcherConfig` and threaded into the queue.
This is the pattern to notice: the value was not in the score moving, it was in
being forced to call the public API the way a customer would.

Bundle after the fix: 81.78 kB / 23.09 kB gzip (from 81.74 / 23.08). Unit tier
**363 tests**; coverage 93.51% / 89.90% / 90.74%, all above the gate.

**Not done, and this is the real backlog item now:** the 398 survivors and 141
no-coverage mutants in `src/shared/**` are a _worklist_, not noise. Killing the
queue-core survivors is higher value than any remaining Phase 2 item, because the
tests that kill them are the ones that would have caught §6a's three defects
without needing a property test to stumble into them. Open
`reports/mutation/index.html` after a run — it is gitignored, and it lists every
survivor with its diff.

## 3g. FRONTEND #3 + #4 — CI breadth and client-side security ✅

Landed 2026-08-11 on `lane/a-ci-tooling`. Delivers **FRONTEND.md item #3 in
full** and **item #4 except the credential itself** (which is `BACKEND.md` 1).

**New tooling, all green on arrival — that was the binding constraint, not an
afterthought.** ci.yml's old bottom-of-file note explained that lint/size/audit
were omitted precisely because a gate that is red on day one gets disabled, so
each one here was calibrated against a measurement first.

| File                            | What it pins                                                                |
| ------------------------------- | --------------------------------------------------------------------------- |
| `eslint.config.js`              | flat config, **0 errors / 323 warnings**                                    |
| `.prettierignore`               | + generated dirs (coverage, reports, `.stryker-tmp`)                        |
| `.size-limit.json`              | gzip **23.06 kB**, brotli **20.12 kB**, raw **81.83 kB**, each ~2% headroom |
| `scripts/scanBundleSecrets.js`  | bundle credential scan                                                      |
| `.github/workflows/release.yml` | npm publish + provenance                                                    |

New scripts: `lint`, `lint:fix`, `format`, `format:check`, `size`,
`scan:secrets`. New ci.yml jobs: **`static`** (eslint blocking, prettier
advisory) and **`audit`**; size + secret scan joined `build` because both need
the artifact and building twice would double the slowest step. Every action in
`ci.yml`, `release.yml` and `analyze.yaml` is now **SHA-pinned with a `# vX.Y.Z`
comment** — `@v4` is mutable, and whoever owns the tag owns what runs with this
repo's `GITHUB_TOKEN`. The Sonar quality gate is un-commented.

**Decisions worth not re-deriving:**

- **`no-explicit-any` and `no-console` are WARNINGS, and `npm run lint` is
  `eslint . --max-warnings=323`.** 323 is the exact measured count, so it is a
  **ratchet**: the 61 `any` and 54 `console.*` cannot grow, but they do not block
  today. FRONTEND #2/#6 remove them — lower the number as they do and flip both
  rules to `error` at zero. **Never raise it.**
- **8 more rules were demoted to `warn` with their counts recorded in the
  config**, because the recommended presets produced **92 errors**, all in `src/`.
  Biggest: `no-unused-expressions` 47 (mostly `a?.b()` statements),
  `no-extra-boolean-cast` 15, `no-useless-escape` 9 (bot-detection and
  reserved-word regexes — changing a regex is a behaviour change, not a drive-by).
  Rules that _are_ errors each measured zero first.
- **Prettier is advisory (`continue-on-error`), deliberately.** **98 of 107 files
  fail `prettier --check`** — `.prettierrc` was committed long ago and never
  enforced. The fix is one repo-wide `npm run format`, but it touches nearly all
  of `src/` and `tests/` and would conflict with every in-flight branch, so it
  must land alone. Delete the `continue-on-error` when it does.
- **Type-aware ESLint is off.** `tsc` in `npm run build` is already the typecheck
  gate, and the `.ts`-extension import convention confuses the type-aware rules'
  program resolution — the same convention that forced `vitest.related: false`
  in §3f.
- **`release.yml` never triggers on a branch push** — `v*` tags or
  `workflow_dispatch` only, and a manual run defaults to `dry-run: true`. npm
  versions cannot be withdrawn. `id-token: write` is required or the provenance
  publish _fails_ rather than shipping unattested.

**One latent bug found by the linter and left for #6 with a pointer:**
`choices.service.ts:164` passes an `async` function as a Promise executor, so a
throw inside it is swallowed instead of rejecting.

### 3g-i. Supply chain: 19 advisories → 4, and why vite is genuinely stuck

**Measured before: 19 (8 high, 4 critical). After: 4 (1 high, 3 moderate).** All
were devDependencies — the SDK has had zero runtime deps since `psl` went (§5) —
so none ever reached a customer bundle.

Majors, each verified before the next: **cypress 13→15** (122/122 e2e),
**vitest 2→4** (444/444 unit, coverage gate holds, **stryker still 75.94 vs
break 73**), **@vitest/coverage-v8 2→4**, **@rollup/plugin-terser 0.4→1.0**
(bundle output byte-identical).

**Cypress 15 forced one real fix, not just a type error.** `cy.exec()` renamed
`code` → `exitCode`, so the old read was `undefined`, `undefined !== 0` was
always true, and `bundleReservedWords.cy.ts`'s `before()` hook threw _"Build
failed with exit code undefined"_ on a good build. `tsc` caught it.

**`vite` is BLOCKED, and this is the one thing here not to re-litigate.** The
remaining high needs vite ≥ 6.4.3, and **every vite from 6 onward declares
`engines: node ^20.19.0 || >=22.12.0` — which excludes Node 21.x, the version
`build.yaml` deploys on.** Upgrading vite therefore requires moving the deploy
off Node 21 first, and `build.yaml` is invariant §6.2. All three vite advisories
are `vite dev` server issues (path traversal, `server.fs.deny` bypass,
launch-editor NTLM on Windows) and this repo ships `vite build` output, so none
is reachable in CI or in a customer bundle. The other three moderates (esbuild,
qs, typed-rest-client) are transitive under vite/cypress/stryker with no fix
that does not also cross the Node 21 line.

Hence the **`audit` job has two halves**: blocking `npm audit --omit=dev
--audit-level=low` (**currently 0** — it defends the zero-runtime-dep property
and fails the day a runtime dep arrives with an advisory), and an advisory
dev-dep audit at `--audit-level=high`. Make the second blocking once the Node
bump lands. **Do not work around `build.yaml` to close it.**

### 3g-ii. Client-side security

- **Bundle secret scan** (`scripts/scanBundleSecrets.js`, in `build` and
  `release`). Matters here more than most repos: `build.yaml` overwrites **one
  mutable CDN path** every customer loads, with nothing to roll back to.
  Calibrated for low false positives against the real bundle — the two things in
  it that look like secrets are the `Authorization` **header name** (5
  occurrences, ignored; only a scheme + literal _value_ is a finding) and the
  62-char base62 alphabet in the id generator (excluded by an ordering +
  Shannon-entropy check, not by hardcoding the string, so a real 62-char key
  there is still caught). **Verified in both directions:** real bundle exits 0; a
  copy with five planted secrets is caught 5/5 and exits 1. A scanner tested only
  against clean input is indistinguishable from `exit 0`.
- **`console.error('credentials not found')` guarded** (`choices.service.ts:94`)
  — the last unguarded diagnostic; the other 14 sites already gate on
  `EnvConfig.isProduction()`. Bundle 81.80 → **81.82 kB** (gzip 23.09 unchanged).
- **SRI + CSP guidance in `USAGE.md`** (§1a, §1b). CSP directives are derived
  from `.env.production` and the code, and note two real traps: blocking
  `ipapi.co` is supported (events lose geo fields rather than failing), and the
  queue stub is an **inline script** a strict CSP silently blocks, losing every
  pre-load call.
  **SRI ships as a warning, not a recommendation** — `/v1/intempt.min.js` is
  _mutable_, so a correct hash stops matching at the next release and the browser
  then refuses to run the SDK at all. Documenting SRI without that would document
  a future outage. Customers needing SRI are pointed at support for a versioned
  URL. **The real fix is an immutable versioned CDN path** — same root cause as
  invariant §6.2 and the `af1a16b` incident.

**Not verified, and cannot be from here: that any of this is green on GitHub.**
**HISTORICAL — superseded by §3s: every `ci.yml` job has now passed on PR #191.**
At the time of writing the branch was unpushed and every command each job runs had
been run locally and passed. `release.yml` is entirely unexercised — it needs
`NPM_TOKEN`, an `npm-publish` environment, and a tag.

## 3h. Phase 4 — privacy & consent ✅ (`FRONTEND.md` item 5)

Landed 2026-08-11 on `lane/b-privacy`. Five deliverables; four complete, one
deliberately reduced in scope. New code lives in **`src/shared/privacy/`**
(`consentCookie.ts`, `doNotTrackSignals.ts`, `gdpr.ts`, `piiScrubber.ts`,
`dataResidency.ts`) with `src/shared/consentState.ts` rewritten. Decisions are
**D23–D26**; do not re-litigate them from this summary.

**167 unit tests added** (444 → **611**), 6 new test files. Coverage rose to
94.08 / 91.35 / 92.51 against gates of 90 / 87 / 87 — see the raise noted in the
header table. Cypress 122/122 unaffected.

### The one thing to read if you read nothing else

**DNT and GPC are now honoured by default, and that reduces event volume for some
customers.** It is the only customer-visible data change in this lane. Rationale
and expected magnitude are in **D24**; it was chosen knowingly, because GPC is
legally binding under CCPA/CPRA and Mixpanel makes the same call. Everything else
in this section is additive or opt-in.

### What landed

| Deliverable                                     | State                                               |
| ----------------------------------------------- | --------------------------------------------------- |
| Cross-subdomain consent cookie at the eTLD+1    | ✅ **D15 closed** — D23                             |
| `gdpr-utils.js` port (301 LOC) with attribution | ✅ `src/shared/privacy/gdpr.ts`, `NOTICE` updated   |
| DNT + GPC, with `ignore_dnt`                    | ✅ D24                                              |
| PII masking/scrubbing, opt-in-safe              | ✅ off by default — D25                             |
| Data-residency switch                           | 🟡 **reduced to `apiHost`; no `region` enum** — D26 |

### Cross-subdomain consent — how the fallback actually behaves

Cookie at `.example.com` **plus** localStorage, both written on every change,
cookie authoritative on read. The subtle part is the **upgrade path**: a
localStorage-only opt-out (i.e. every visitor who opted out before this bundle) is
promoted to a cookie _on read_, which is what closes D15 for the existing
population rather than only for future opt-outs. An opt-**in** is never promoted —
the mechanism may only widen an opt-out, so its failure direction is "more private
than asked". There is a test asserting exactly that asymmetry.

Host-only hosts (`localhost`, IP literals) get a cookie with no `domain`
attribute, via `isHostOnlyTarget` from `publicSuffix.ts`. **`publicSuffix.ts` was
not modified** — §5's parity warning respected.

### Three traps found while building this, worth not re-discovering

1. **Lookbehind would have killed the whole bundle on Safari < 16.4.** The card and
   phone patterns originally used `(?<!…)`. A regex literal is parsed when the
   bundle _loads_, so an unsupported construct is a SyntaxError that takes the
   entire SDK down rather than degrading one feature. Leading boundaries are
   capture groups now (`PiiPattern.sensitiveGroup`). **Any future pattern must
   obey this.**
2. **The new config options were unreachable until the loader was taught to read
   them.** There is no constructor in the supported embed — `sdkLoader.ts` builds
   `IntemptConfig` entirely from the script URL's query string, so an option that
   exists only on the type is an option no customer can set. Now
   `&ignore_dnt=1`, `&pii_scrubbing=1`, `&api_host=…`. Note the deliberate
   divergence: those use a real boolean parse, not the neighbouring
   `!!searchParams.get()` idiom under which **`?shopify=false` is true**. That
   pre-existing footgun was left alone; `?ignore_dnt=false` silently disabling DNT
   was not acceptable.
3. **`setup.ts`'s cookie teardown does not clear domain-scoped cookies.** It
   expires at `path=/` with no domain, which does not match `domain=.example.com`.
   Consent suites call `clearStoredConsent()` in `beforeEach` themselves rather
   than changing shared setup. If a future suite writes domain cookies and goes
   flaky, this is why.

### Test-file geography, because jsdom fixes the URL per file

The document URL cannot change within a file, and both cases matter:
`tests/unit/consentState.test.ts` runs on `https://shop.example.com` (the
eTLD+1 case, via a `@vitest-environment-options` docblock) and
`tests/unit/consentCookie.test.ts` on the default `http://localhost` (the
host-only case). Do not merge them.

### Deliberately not done

- **`region: 'us' | 'eu'` enum** — there are no regional ingest hosts to map it to,
  and an enum that accepts `'eu'` and falls back to the US host tells a customer
  they are compliant while they are not. Full reasoning in **D26**; handover added
  as **`BACKEND.md` item 6**.
- **`addOptOutCheckMixpanelLib/People/Group`** from the ported file. Every public
  method in `intemptJs.ts` already opens with `if (!this.isUserOptIn()) return;`,
  so the decorator would add indirection with no new behaviour — and two competing
  consent mechanisms is worse than one.
- **The `optIn()`/`optOut()` null-guard** noted in §4's caveats. Still open, still a
  one-liner; it belongs to `FRONTEND.md` item 6 (code health) and was left there
  rather than smuggled into a privacy commit.
- **Region-routing the choices/experience API.** `choices.service.ts` still uses
  `EnvConfig.getApi()`; it needs the same non-existent endpoints.

### Cost

Bundle 81.78 → **87.80 kB** (gzip 23.09 → **25.45 kB**), +6.0 kB / +2.4 kB gzip.
Most of it is the scrubber's pattern and key-name constants, which are module-level
and therefore present **even when scrubbing is disabled** — i.e. every customer
pays for a feature most will not enable. The clean fix is code-splitting
(`FRONTEND.md` item 9), which the user parked. Flagging it rather than
micro-optimising: if the size gate from `FRONTEND.md` item 3 lands first, pin it
_after_ this.

## 3i. Phase 4 — structured logging & metrics ✅ (`FRONTEND.md` item 2)

Dimension 6 (observability) was the **worst-scoring dimension in the audit**: 25
at the audit, 40 before this change, against Mixpanel's 85. It was also entirely
client-side work — nothing here was blocked on the backend.

**What was wrong.** 55 raw `console.*` calls, gated — where they were gated at all
— on `EnvConfig.isProduction()`. Three consequences, all of them support
problems:

- **Production printed nothing, and there was no way to change that.** The only
  build where a diagnostic has any value is the one on a customer's live site,
  and that build was silent by construction. The remedy in use was to ship a
  customer a staging bundle.
- **No severity.** `console.log` for a swallowed exception and `console.log` for
  "editor mounted" are indistinguishable, so nobody read either.
- **Nothing could be forwarded.** A customer running Sentry or Datadog could not
  see SDK failures at all.

**What landed.**

- `src/shared/logger/logger.ts` — four levels (error/warn/info/debug), a
  `[Scope] message` prefix keeping the existing `[RequestBatcher]`-style
  convention, and **two independent thresholds**. The console default reproduces
  the old policy exactly (silent in production, verbose otherwise) so no customer
  page gets noisier; `debug: true` in the SDK config lifts it **in production**,
  which is the whole point of the option.
- **A sink hook** — `onDiagnostic` on `IntemptConfig`, receiving a structured
  record (`level`, `scope`, `message`, `detail`, `timestamp`), gated at `warn` and
  above **independently of the console**. Gating a sink on the console threshold
  would make it useless in the only environment it exists for. It complements
  rather than replaces `errorReporter`: that hook is a narrower, per-instance
  queue channel its owner wires and the batcher's tests drive, so
  `RequestBatcher.reportError` now writes to both. The sink copies
  `reportError`'s most important property — **a throw from the customer's
  callback is swallowed**, because an analytics SDK that can break the page it
  measures is worse than no analytics SDK.
- `src/shared/logger/metrics.ts` — queue depth, flush latency (last + mean),
  drop count, breaker state and **transition count**, readable as a snapshot via
  `intempt.getDiagnostics()` and emitted through the logger on each transition.
  **This is the consumer §3c's drop counter was waiting for.** Depth and drops are
  _sampled_ through provider callbacks at snapshot time rather than pushed on
  every enqueue — pushing would put per-event work back on the hot path that §6c
  exists to keep clear. Latency is a running total, not a sample array, for the
  same reason the two dedupe structures are capped: unbounded growth on a
  long-lived tab.

**Queue and batcher changes are wiring only.** `requestQueue.ts` gained one
read-only accessor (`getQueueDepth()`); `requestBatcher.ts` gained a logger, a
metrics instance, `getMetrics()`, and calls that _observe_ the breaker at the
three points where its state already changed. No queueing, retry, breaker or
dedupe logic was touched, and all 100 existing batcher tests plus the 50 queue
tests pass unmodified.

**Two `console.*` calls survive on purpose**, both documented in place:

- `sdkLoader.ts` — `CAN'T FIND SCRIPT`. This branch means the bundle could not
  find its own `<script>` tag, so there is no config, no write key, and the
  logger cannot have been configured (`debug: true` arrives _with_ the config
  that just failed to load). It is also the known signature of the mutable `/v1`
  CDN path coupling, and support tells customers to look for this exact string.
- `envConfig.ts` — the logger gates itself on `EnvConfig.isProduction()`, so
  routing this one would make the logger and its own configuration source
  mutually dependent, and it fires _during_ the initialisation it would consult.

**Bundle: 81.80 kB / 23.09 kB gzip → 85.25 kB / 24.26 kB gzip** (+3.45 kB raw,
+1.17 kB gzip). Measured split: logger 0.80 kB, metrics 1.10 kB, call sites
~1.55 kB. The call-site share is mostly **message strings that now ship**:
`vite.config.ts` sets `esbuild.pure: ['console.log']`, which deleted every
`console.log` call _and its string literals_ from the production bundle
outright — verified directly against esbuild. In other words part of the old
bundle's smallness **was** the missing production diagnostics, and a switchable
debug channel necessarily keeps those strings at runtime. `log.debug` is
deliberately not added to `pure` for exactly that reason. The remaining lever, if
the size gate from `FRONTEND.md` item 3 ever makes this hurt, is trimming
individual `debug`/`info` breadcrumbs — not the logger itself.

`recordFlush` deliberately does **not** log: it runs on every send, so it would be
the SDK's highest-frequency log call, in exchange for information `snapshot()`
already reports better as a mean.

**Tests:** 40 added (`tests/unit/logger.test.ts` 22, `tests/unit/metrics.test.ts`
18), taking the unit tier to **484**. They cover level filtering, the `debug`
switch, the production-silent default, console output shape, the sink including a
**throwing** sink (asserting no propagation, no recursion, and that the console
channel survives), each metric, and the batcher wiring end to end — drop count
reaching the snapshot, and a full closed → open → half-open → closed breaker
recovery.

## 3j. FRONTEND #7 — docs & DX ✅

Landed 2026-08-11 (lane D, documentation only — nothing under `src/` or `tests/`).

**Added:** `docs/API.md`, `docs/TYPESCRIPT.md`, `docs/MIGRATION.md`,
`docs/integrations/{REACT,NEXTJS,VUE}.md`, `examples/` (basic-html,
consent-banner, spa, ecommerce, typescript). **Rewrote** `README.md` as an entry
point; corrected six inaccuracies in `USAGE.md`.

**TypeDoc was deliberately NOT used.** Three reasons: there is no published
`.d.ts` yet (`FRONTEND.md` #1), so it would have to run on `src/` and would
document ~55 internal modules — `RequestBatcher`, `SharedLock`, the choices engine
— as if they were the customer surface; the real contract is not in a type
signature but in the guard's throw strings and the _order_ its checks run in,
which TypeDoc does not emit; and `typedoc` was not a devDependency. The reference
is hand-written against `intemptJs.guard.ts`, covering the 15 methods on
`window.intempt`. **Revisit after #1 lands.**

**Verified:** `npx tsc -p examples/typescript` clean under `strict` +
`noUnusedLocals` — and the three `@ts-expect-error` lines in
`examples/typescript/reservedTitles.ts` are part of the check: if the conditional
type stops rejecting reserved titles, tsc fails on the now-unused suppressions.
All 60+ internal markdown links resolve (scripted).

**Not verified, and listed so nobody assumes otherwise:** the `/v1/` CDN URL
against the live CDN (see D-12 — this is the important one); `next/script`
`beforeInteractive` ordering; React's dev warning on camelCase `doNotCapture`
(the docs use the lowercase `donotcapture` form, whose runtime match _is_ certain
per the DOM spec); the `next-auth` / `react-router` / `vue-router` snippets, whose
Intempt calls are checked but which were not compiled; Nuxt `app.head.script`
ordering. No HTML example was opened in a browser against a real source, so no
event was observed end-to-end.

This lane found **12 of the defects in `DEFECTS.md`**, including D-12.

## 3k. Phase 2 — public API, payload contract, choices engine ✅

Landed 2026-08-11 (lane E). **143 tests** across three files, closing the largest
remaining test gap: the enforced coverage scope was ~3,160 of 7,973 lines of
`src/`, and the public API class and experiences engine were outside it.

| File                                 | Tests                       | Covers                                                  |
| ------------------------------------ | --------------------------- | ------------------------------------------------------- |
| `tests/unit/intemptJs.test.ts`       | 47                          | the public API class (335 LOC)                          |
| `tests/unit/payloadContract.test.ts` | 17 + **10 golden fixtures** | the outbound wire format                                |
| `tests/unit/choicesEngine.test.ts`   | 79                          | the 7 DOM mutation types, stylesheet injection, cloning |

**The golden fixtures are the load-bearing part.** `tests/unit/__golden__/payload/`
records the exact JSON posted to `…/sources/<id>/track`. That is what unblocks
`BACKEND.md` item 4 (`$lib_version`): the reason it was blocked is that nobody
could state the current wire format with confidence. Now it is pinned, and any
change to it fails a test with a readable diff.

**`vitest.config.ts` was NOT widened to include `src/intemptJs/**` or
`choices/**`** — lane E did not own that file. So these 143 tests improve real
coverage without yet being _enforced_. Widening the include list and raising the
thresholds together (D20) is item 2 of §0b.

The web-editor postMessage handshake (`src/loaders/webEditorLoader.ts`) was the
designated drop: the mutation types run for every visitor, the handshake only for
an internal user with the editor open.

This lane found **15 of the defects in `DEFECTS.md`**, including all three
severity-1 wire-format items and the D-24 correction to §4 of this file.

## 3. Next concrete action — **superseded by §0b**

> The ordered, current worklist is **§0b** at the top of this file. What follows is
> the older per-item detail, kept because it explains _why_ each item is ranked
> where it is. If the two disagree, §0b wins — it is maintained.

Client-side load shedding is **complete** (jitter §3a, breaker §3b, bounded queue
§3c). The fourth item, a server-controlled brake, is backlogged on the backend.
The CI gate is **complete** (§3d).

The guard port and the threshold raise are **complete** (§3e), and mutation
testing is in place (§3f).

Highest value now, in the author's order:

1. **Golden-file contract tests** on the outbound payload shape. The last named
   Phase 2 item; after it, tier-1 is done and only the WDIO cross-browser tier 2
   remains (blocked on a Sauce account).
2. Kill individual mutation survivors **opportunistically, while touching the
   code** — not as a campaign. §3f-i measured the rate at ~2.3 mutants per test
   and recommends against grinding the score; the remaining 397 survivors each
   need their own assertion.
3. Structured logger + killing `any` (Phase 4). The logger has a concrete consumer
   now: the drop counter from §3c, plus the consent notices and scrubber failures
   from §3g, which currently route through optional callbacks. Cross-subdomain
   consent (D15) is **done** — §3g.
4. **Credential hygiene (Phase 4)** — but note this is now known to be **mostly
   blocked on the backend**, not client-side work: five call sites across four
   endpoints carry the `btoa`'d write key, and the fix is `BACKEND.md` item 1.
   The part that was ours alone is **done — §3g-ii**: the `choices.service.ts:94`
   diagnostic is guarded, SRI/CSP guidance is in `USAGE.md`, and a bundle secret
   scan gates `build` and `release`. Only the credential itself remains, and it
   is the backend's.
5. Cross-subdomain consent cookie (D15) and killing `any` (Phase 4). The
   **structured logger is done — §3i**, and the drop counter from §3c now has its
   consumer. What remains of dimension 6 is breadth, not plumbing: route the
   quota-failure telemetry from `FRONTEND.md` item 10 through the sink.
6. **Credential hygiene (Phase 4)** — but note this is now known to be **mostly
   blocked on the backend**, not client-side work: five call sites across four
   endpoints carry the `btoa`'d write key, and the fix is `BACKEND.md` item 1.
   What is ours alone is small (SRI/CSP guidance in the customer docs; the
   unguarded `console.error` at `choices.service.ts:94` was fixed by §3i's
   sweep).
7. Close the bot-detection false negative documented in §3e, if it is judged
   worth the risk — it needs the compatible;-inspection moved out of the browser
   branch, which changes behaviour for real traffic, so it wants a parity check
   against live UA logs rather than reasoning.

Open items carried forward:

- **`BACKEND.md` has not been handed to the backend team yet** — five items are
  blocked behind it and nothing moves until that starts. It now includes §2a, the
  new question about whether ingest emits `Retry-After` at all (see §3a).
- Get ingest-team confirmation before stamping `$lib_version` on payloads (D12).
- The deferred `package.json` entry fields land with Phase 1 task 5 (D11).
- Everything else in `BACKEND.md` is blocked on the backend team, by user
  decision.

## 3l. `FRONTEND.md` #6 code health, part 1 — the dead handler is deleted, and the bundle argument for it was false

Landed 2026-08-12. `src/intemptJs/modules/choices/models/ModificationHandler.ts`
(**459 LOC**, 7 mutation types) is gone, along with the ~517 lines of tests that
pinned it. D-23 is now `fixed`.

**The deletion was safe and remains right.** Nothing in `src/` imported it; the live
engine is `WebEditorModificationHandler` (4 types), and the two used incompatible
element-addressing conventions, so it was never one import away from working. It
also held **18 of the repo's ~89 `any` hits**, which is why this belongs to code
health.

### The measurement that matters more than the deletion

**It saved zero bytes.** `dist/intempt.min.js` is **91,248 bytes with the file
present and 91,248 bytes with it deleted**, and `typography` — a type name unique to
the dead class — appears **0 times** in either bundle. Vite's IIFE build only
includes reachable modules, so an unimported file costs nothing at all.

**Three documents asserted otherwise and have been corrected** (D-23 itself, the
`choicesEngine.test.ts` header, and `BACKLOG.md` 1.2, the last of which was written
earlier the same day). The claim had propagated as "~459 LOC ship to every customer"
and as a reason `FRONTEND.md` #9 was "cheaper than it looks". Both were wrong.

**The general lesson, worth more than this item:** _verify a bundle claim against the
bundle._ "It is in `src/`" does not mean "customers download it", and every claim in
this programme about payload should be checked with `stat` and `grep` on
`dist/intempt.min.js` rather than reasoned from the source tree. This one survived an
audit, a defect register, a test comment and a fresh backlog entry without anyone
running the two commands that refute it.

**Consequence for `FRONTEND.md` #9 (parked):** its "1,644 LOC they never execute"
figure is not payload either. The honest saving there is whatever is _imported but
unused at runtime_ — a smaller and harder number. Measure before budgeting 2.5 days.

### Also in this commit

A replacement assertion in the live handler's suite: it exposes exactly
`insert`/`remove`/`style`/`update` as **own properties**. `_applyChanges` routes with
`changesHandler.hasOwnProperty(change.type)`, so that set _is_ the set of change
types the SDK can apply — which is what made the 7-type class dead rather than merely
unused. The old test asserted this by comparing the two classes; now it guards the
dispatch contract on its own.

Unit **839 → 808** (net −31: ~517 lines of dead-code tests removed, one added).
ESLint warnings **279 → 245**; the ratchet moves to **245**. Coverage unchanged —
`choices/**` is outside `coverage.include`. Cypress 122/122 unaffected.

## 3m. Coverage scope widened to all of `src/` — and what it exposed

Landed 2026-08-12. `coverage.include` was the three areas Phase 2 targeted; it is now
`src/**/*.ts`. **The reported number therefore described the best-tested third of the
SDK and said nothing about the rest.** Measured across everything:

| Area                         | Statements                       |
| ---------------------------- | -------------------------------- |
| `src/guard/**`               | 98.49%                           |
| `src/shared/**`              | ~96%                             |
| `autoTracker/**`             | 58.52%                           |
| `choices/**`                 | 50.37%                           |
| `HtmlEventData.component.ts` | **0%**                           |
| `shopifyTracker`             | **2.56%**                        |
| `src/main.ts`                | **0%**                           |
| `src/loaders`                | **4.54%** (`sdkLoader.ts` 9.67%) |
| **All of `src/`**            | **72.5 / 66.05 / 74.4 / 73.77**  |

**`sdkLoader.ts` is the finding.** It builds the entire `IntemptConfig` from the
script URL's query string — it _is_ the public configuration surface of the supported
embed — and it is at **9.67%**. §3h already hit the consequence: three new privacy
options existed on the type and were unreachable by any customer because the loader
had never been taught to read them. That is exactly what 9% hides, and it is a higher
priority than any remaining mutation-score work.

**Per-glob thresholds are what make the widening safe.** D20's trap is that widening
`include` without moving thresholds silently lowers the bar — but a single global
number must be set low enough for the _worst_ area, which dilutes the good ones. So
the gate is now three-tiered: a whole-repo floor of 70/64/72/71, `src/shared/**` at
93/88/94/94, and `src/guard/**` at 96/91/98/96. Well-covered code keeps its own high
floor and cannot regress behind the global average.

**Verified in both directions**, per the §3g-ii rule that a gate tested only against
passing input is indistinguishable from no gate: with `src/shared/**` lines raised to
99 the run fails with `ERROR: Coverage for lines (96.48%) does not meet
"src/shared/**/*.ts" threshold (99%)`. The per-glob gate fires and names the glob.

**Do not read the drop from 96% to 72.5% as a regression.** Nothing got worse; the
measurement got honest. The old figure is not comparable — different denominator.

## 3n. The five-lane parallel run — 2026-08-12. READ THIS BEFORE RESUMING.

Five lanes ran concurrently in separate worktrees and **all five are merged into
this branch with ZERO conflicts** (commit `bdd294e` is the last merge). File
territories were assigned as prohibitions per lane, which is why nothing collided.

| Lane  | Delivered                                                                     | Verified by the orchestrator                                                  |
| ----- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **A** | `sdkLoader.ts` **9.67% → ~71%**, 33 tests, new `tests/unit/sdkLoader.test.ts` | base sha, diff scope, 841 unit, 0 lint warnings                               |
| **B** | mutation **80.90% → 86.57%**, 78 tests over 4 files                           | score read from its own report, 886 unit, 0 warnings, bundle unchanged        |
| **C** | **vite 5.4.21 → 6.4.3**, audit 4 (1 high, 3 mod) → **2 moderate**             | `npm ci`, build, 808 unit, Cypress 0 failing, mutation 80.90 unchanged        |
| **D** | `autoTracker.transport.ts` extracted, **D-2 fixed**, 8 `any` removed          | 809 unit, lint 26→18 on its paths, bundle +1,504 B attributed by commit       |
| **E** | **D-4 and D-5 fixed**, `_ids()` dedupe                                        | 808 unit, bundle −240 B, and **one lint warning it wrongly reported as zero** |

**Merged-tree numbers, measured here and not reported by any lane:** unit
**920/920** (26 files), build+tsc clean, coverage **75.64 / 70.09 / 76.09 / 76.75**,
ESLint **0 errors / 236 warnings**, bundle **92,548 B**. The bundle is exactly
additive: 91,248 + 1,504 (D) − 240 (E) + 36 (C).

**STILL PENDING and it is the first thing to do on resume: mutation and Cypress on
the MERGED tree.** Both were green per-lane; neither has been run on the
combination. The `npm run test:mutation` run was in flight when this was written.

### The mutation floor of 85 is reached — 86.57%

That is the user-set target from §3f, hit for the first time. B's targets were
`requestBatcher.ts` 71.13 → **88.19**, `requestQueue.ts` 72.84 → **87.65**,
`shared.utils.ts` 47.83 → **95.65**, `storageHandler.ts` 70.83 → **95.83**.
**The §3f-iii heuristic held**: value-computing code yielded **1.9 detections per
test** against 0.8 for the guards-and-reporters of `consentCookie.ts` — the
difference between ~40 and ~140 tests for the same gain.

### Three defects closed

- **D-2** — `AutoTrackerModule` now has `dispose()` plus a static `_activeInstance`:
  constructing a second instance **disposes the first** ("last instance wins").
  Right for the documented triggers (two snippet copies, SPA re-init), but **it
  silently stops a first instance**, so anyone deliberately running two instances on
  one page loses the first. Needs a release-note line. `payloadContract.test.ts` no
  longer documents the bug as a workaround; it asserts the fix — one consent POST
  from a second instance, not fourteen.
- **D-4** — `recommendation()` is gated on opt-out; it was the only public method
  letting an identifier leave the page after `optOut()`.
- **D-5** — `consent()` is no longer gated on the opt-out flag. The reasoning is in
  the code: recording a decision is an **audit record a regulator can demand**, not
  tracking, so it must survive `optOut()`. Only `isConsentValid` can stop it.

### Two process failures worth more than the code

1. **`isolation: "worktree"` does not branch from current HEAD.** Three of five
   worktrees came up on `40bdb24`, an old staging merge that is not an ancestor of
   this branch. It recurred on relaunch, so it is systematic. **Every lane prompt
   opened with a baseline assertion of exact VALUES** — HEAD sha, `wc -l` of the
   target file, test count, bundle bytes — and all three bad lanes stopped without
   writing a file. Without that, Lane E would have "fixed" defects in a 452-line
   `autoTracker.module.ts` that is 546 lines here, and the merge would have silently
   reverted real work. **Fix: build the worktree by hand, verify HEAD yourself, hand
   a non-isolated agent an absolute path.** Full writeup in
   `~/.claude/agent-routing/LEDGER.md`.
2. **A delegated lane must never be told to wait for anything.** Lane B twice
   returned mid-task to await a notification about its own background mutation run —
   which a subagent cannot receive, since returning ends its turn. It burned **251k
   tokens** and never committed; the orchestrator committed its (sound) work.

**And the reason the orchestrator re-runs every gate:** Lane E reported "zero lint
warnings" on the strength of `eslint`'s exit code. **`eslint` exits 0 on warnings**,
so it had in fact added one, which would have failed the `--max-warnings` ratchet in
CI. Fixed here (`intemptJs.ts:413`, a named-but-unused `catch` binding became a bare
`catch`). Lane-local green means nothing; the merged tree is the only truth.

### New defect found by Lane A, not yet in `DEFECTS.md`

`src/loaders/sdkLoader.ts:72-89` — `apiHost` uses `?? undefined` while the four
required fields use `?? ''`. So `?api_host=` with an empty value arrives as `''`,
and `resolveIngestBaseUrl` receives an empty string instead of falling through to
the build-time default. A data-residency option that misbehaves when set empty.
Asserted as current behaviour in A's tests. **Add it to the register as D-27.**

Lane A also reconfirmed **D-12** is worse than documented: when the script tag
cannot be found, the all-empty config fallback makes `isValidConfig` throw inside
`new IntemptJs(...)`, and **nothing in `sdkLoader.ts` or `main.ts` catches it** —
`SDK.init()` throws into the customer's page.

### Threshold moves owed, once the merged-tree mutation number is in

None are done yet, deliberately — measure the merged tree first.

1. `stryker.conf.json` `break` **80 → 85** (measured 86.57 lane-local).
2. `package.json` `--max-warnings` **245 → 236** (measured 236 after the fix above).
3. `vitest.config.ts` per-glob coverage floors up ~2 points under the new measures.
4. **`.size-limit.json` must be RAISED**: the bundle is 92,548 B against a 93 kB
   budget — ~450 bytes of headroom, too tight to survive any addition. This is a
   loosening, so it needs the user's eye: the growth is real code, mostly D's
   refactor. **The extraction commit alone was byte-identical**; all +1,504 came
   from wiring it up plus D-2.
5. `BACKLOG.md` **4.2 can close** — with the high advisory gone, `ci.yml`'s dev-dep
   audit half can become blocking instead of advisory.

## 3o. Second wave — four code lanes IN FLIGHT as of 2026-08-12 02:20. HOW TO FINISH THEM.

**Merged-tree gates from wave 1 all passed** before these launched, so `e71a356` is a
good base: unit **920/920**, mutation **86.57%** (merged, not lane-local), Cypress
**0 failing**, size limits all pass (gzip 26.93/27.2, brotli 23.38/23.6, raw
92.55/93 — passing but tight), ESLint 0 errors / 236 warnings, bundle 92,548 B.

Four lanes are running against `e71a356` in **hand-built, HEAD-verified worktrees**
(the `isolation: "worktree"` flag is unreliable — see §3n failure 1):

| Lane  | Branch                | Worktree                                | Task                                                                                                                      |
| ----- | --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **F** | `lane-f-pagestracker` | `.claude/worktrees/lane-f-pagestracker` | **D-9, D-10, D-11** — popstate double-exit, replaceState orphan exit, missing `hashchange` — plus 3 `any`                 |
| **G** | `lane-g-choices`      | `.claude/worktrees/lane-g-choices`      | **D-6, D-7, D-8, D-22** — the all-or-nothing experiences engine — plus 5 `any`                                            |
| **H** | `lane-h-transport`    | `.claude/worktrees/lane-h-transport`    | `FRONTEND.md` **#10**: `fetch(keepalive)` → XHR fallback. **`sendBeacon` explicitly OUT of scope** (needs `BACKEND.md` 1) |
| **I** | `lane-i-loader`       | `.claude/worktrees/lane-i-loader`       | **D-17** (`?shopify=false` enables), **D-27** (empty `api_host` becomes `''` not default), **D-12**'s uncaught throw      |

**To finish, in this order:**

1. For each lane: `git -C <worktree> log --oneline e71a356..HEAD` to see what it did,
   then verify by RUNNING — never from its summary. `npm run build` (the typecheck
   gate), `npm run test:unit`, `npm run test` (Cypress), `stat -c%s dist/intempt.min.js`,
   and `npx eslint <its files>` **reading the printed count, because eslint exits 0
   on warnings** — that is exactly how a wave-1 lane reported zero when it had one.
2. `git merge --no-edit <branch>` each, from the primary checkout. Wave 1 merged
   four branches with zero conflicts because territories were disjoint; these four
   are disjoint too (pagesTracker / choices / transport / loaders).
3. Re-run every gate ON THE MERGED TREE, including `npm run test:mutation`. Lane H
   edits code whose mutation score is 88%, so a drop there means its new code is
   untested.
4. THEN move the thresholds — never before measuring:
   - `stryker.conf.json` `break` **80 → 85** (86.57 measured on the merged wave-1 tree)
   - `package.json` `--max-warnings` **245 → 236**, lower again if the lanes' `any`
     removals drop it further
   - `vitest.config.ts` per-glob floors to ~2 under the new measures
   - `.size-limit.json` **only if a lane pushes past a limit** — raw has ~450 B of
     headroom, so H or G may force it. Raising it is a loosening: state the reason.
5. Register **D-27** in `DEFECTS.md` (Lane A found it; Lane I fixes it), and mark
   **D-6/7/8/9/10/11/12/17/22** fixed as the lanes land.
6. `BACKLOG.md` **4.2 can close** — vite 6 landed, so `ci.yml`'s dev-dep audit half
   can go from advisory to blocking at `--audit-level=high`.

### Wave-2 results as they landed (F and G were still running at handoff)

- **Lane I ✅ verified and committed** — 3 fix commits: **D-17** (`shopify`/`magento`
  now use the real boolean parser, so `?shopify=false` disables), **D-27** (empty
  `?api_host=` falls back to the default), **D-12** (a misconfigured SDK reports
  through the logger instead of throwing into the host page). Lint 13 before and 13
  after on its files — nothing added. Bundle +118 B. Branch `lane-i-loader`.
- **Lane H ✅ committed (`1f4c93b`) but IT BREAKS THE SIZE GATE.** The
  `fetch(keepalive)` → XHR fallback costs **+697 B**, taking the bundle to
  **93,245 B against the 93 kB raw limit** — `npm run size` says _"Package size limit
  has exceeded by 245 B"_. gzip 27.14/27.2 and brotli 23.58/23.6 still pass, but only
  barely. **Merging H therefore REQUIRES raising `.size-limit.json`, which is a
  loosening and needs the user's decision.** Unit 924/924 (27 files), lint 0,
  `sendBeacon` correctly left out of scope, `requestBatcher.ts` untouched.
- **Lane H also parked mid-task on its own mutation run, as Lane B did** — two of nine
  lanes, both on `npm run test:mutation`, the only gate slow enough to tempt
  backgrounding. **Next time: forbid backgrounding outright, or do not ask a lane to
  run mutation and measure it yourself at merge.**

- **Lane G ✅ verified and committed** — the cleanest lane of the nine. Five commits:
  **D-6** (a malformed choice is isolated instead of discarding all of them), **D-7**
  (same isolation in the pointer-marking pass), **D-8** (async handlers are awaited so
  failures reach the try/catch), **D-22** (the `async` Promise executor no longer
  swallows throws), then the `any` removal. **Lint 15 → 1 on its files** — it removed
  14 warnings, so the repo ratchet can drop further. Unit 922/926 files unchanged in
  count but ~254 lines of tests rewritten, because per-item isolation changes what the
  existing assertions mean. Bundle +312 B. Branch `lane-g-choices`.

- **Lane F ✅ verified and committed** — **D-9** (popstate no longer fires the exit
  twice), **D-10** (no orphan exit for a no-op `replaceState`), **D-11** (a
  `hashchange` listener, so hash-routed SPAs are tracked at all), each its own commit,
  plus an `any`/lint cleanup. **0 lint warnings** on its files. Four new test files,
  one per defect — the split looks odd but is almost certainly right: jsdom fixes the
  document URL per file, the same constraint that separates `consentCookie.test.ts`
  from `consentState.test.ts` (§3h). 924 unit tests across 30 files, Cypress 126.
  Bundle +139 B. Branch `lane-f-pagestracker`.

### ALL FOUR WAVE-2 LANES ARE VERIFIED AND COMMITTED — NONE ARE MERGED

`git merge` each of `lane-f-pagestracker`, `lane-g-choices`, `lane-h-transport`,
`lane-i-loader` from the primary checkout. Territories are disjoint (pagesTracker /
choices / transport / loaders), so expect zero conflicts as in wave 1 — but **the
merged bundle will be roughly 92,548 + 139 + 312 + 697 + 118 ≈ 93,814 B, which is
~814 B OVER the 93 kB raw limit.** `.size-limit.json` must be raised in the same
commit as the merge or the build gate fails. That is a loosening: **it needs the
user's approval, and the reason is real code** — the XHR fallback leg (+697) is the
bulk of it.

**Thirteen defects were fixed today**: D-2, D-4, D-5, D-6, D-7, D-8, D-9, D-10, D-11,
D-12, D-17, D-22, D-23, plus the newly-registered D-27. `DEFECTS.md` still lists them
as open — **update it as part of the merge.** What remains open there is mostly the
wire-format group (D-1, D-3, D-15) which is blocked on ingest, plus D-13/14/16/18/
19/20/21/24/25/26.

### A scope gap found while checking H's claim — worth acting on

H offered "mutation unchanged at 86.57%" as evidence its new code is tested. **It is
not evidence.** `stryker.conf.json` mutates only `src/shared/**`, `src/guard/**` and
`src/intemptJs/guards/**`, so **`autoTracker.transport.ts` is not mutated at all** —
and neither is any of `src/intemptJs/modules/**` or `src/loaders/**`. An unchanged
score across a change to unmutated code is a tautology, not a result.

Consider widening `stryker.conf.json`'s `mutate` the way `coverage.include` was
widened in §3m — measure first, then set `break` just under. Expect the headline score
to fall, exactly as coverage fell 96% → 72.5% when it stopped describing only the
best-tested third of the SDK. That drop would be honest.

**Nothing is pushed. There are ~13 local commits and CI has never seen any of it.**
The user's own open items: check live host sites for the `/v1`-less URL, approve
`npm install` → `npm ci` and the `branches: ['*']` fix in `build.yaml`, push and open
the PR into `staging`, and hand over `BACKEND.md`.

## 3p. STATE AS OF THE 2026-08-12 HANDOFF — read this first

**Everything from nine parallel lanes is merged, verified on the merged tree, and
PUSHED.** `origin/beso/sdk-enterprise-hardening` is at **`3c5823e`**. This was the
first push of ~24 commits, so **`ci.yml` is running on all of it for the first time —
check that run before trusting anything below.** §0c records that four of five past CI
failures were invisible locally.

| Gate          | Session start | Now                                           |
| ------------- | ------------- | --------------------------------------------- |
| Unit          | 794           | **930** (31 files)                            |
| Cypress       | 122           | **126**                                       |
| Mutation      | 77.54%        | **86.57%** — the user's 85% floor, reached    |
| Coverage      | 3 dirs, ~96%  | **all `src/`**, 76.82 / 70.63 / 77.31 / 77.77 |
| ESLint        | 323 warnings  | **205**, 0 errors                             |
| Advisories    | 4 (1 high)    | **2 moderate, 0 high**                        |
| Bundle        | 91,248 B      | **93,814 B**                                  |
| Defects fixed | 0             | **13**, plus D-27 found and fixed             |

**Thresholds were all moved to just under measurement** — stryker `break` 85,
`--max-warnings` 205, coverage 75/68/75/75. `.size-limit.json` was **raised**
(gzip 27.9, brotli 24.2, raw 95.8 kB) because the merge exceeded all three; that is a
loosening, and the bytes are real fixes: +697 XHR fallback, +312 choices isolation,
+139 hashchange, +118 loader try/catch.

### Remaining code work — no one else needed

1. ~~**~60 `any`** left, then flip `no-explicit-any` and `no-console` to `error` and drop
   `--max-warnings` to 0.~~ ✅ **done — §3r.** Was 99, not ~60. Both rules are errors.
2. ~~**Two more `autoTracker` splits** — consent and event pool.~~ ✅ **done — §3r.**
   The wiring cost +510 B, as predicted.
3. ~~**The repo-wide prettier sweep.**~~ ✅ **done — §3r.** 140 files; bundle came out
   byte-identical; `continue-on-error` removed.
4. ~~**~10 defects**: D-13/14/16/18/19/20/21/24/25/26.~~ **✅ done as far as code can take
   it — see §3q.** D-13/16/21/24/25/26 are fixed; **D-14/18/19/20 need a user decision**
   (each turns silence into a throw, or changes a value ingest already receives), and
   D-1/D-3/D-15 stay blocked on ingest.
5. **Widen `stryker.conf.json`'s `mutate`.** It covers only `src/shared`, `src/guard`
   and `src/intemptJs/guards`, so **none of what the nine lanes changed is mutated** —
   86.57% says nothing about transport, choices, pagesTracker or loader code. Measure
   first, then set `break` just under; expect the headline to fall, honestly, as
   coverage did in §3m.

**None of items 1–5 moves the rubric score much.** Score is ~81-83 vs Mixpanel's 85 and
is now capped by **packaging** (parked, +3.6, the single biggest item) and the
**`BACKEND.md` handover** (parked). A re-score against `AUDIT.md`'s ten dimensions is
overdue — three figures in these docs disagree (~78, 62, and this estimate).

### Still needs the user

1. **Check live host sites** for the `/v1`-less CDN URL (D-12's original cause).
2. **`build.yaml`**: `npm install` → `npm ci`, and `branches: ['*']` → `['**']`. Both
   one-liners on the deploy path, deliberately not bundled with the Node bump.
3. ~~**Open the PR into `staging`**~~ ✅ **done — PR #191, and both jobs passed. See §3s.**
4. **Hand over `BACKEND.md`** — the tallest blocker: 6 ingest items, dimension 4's ~62
   ceiling, and the three wire-format defects.
5. **Release-note line for D-2's "last instance wins"** — it silently stops a first
   instance, so a page deliberately running two loses one.

### Lane worktrees

The nine lane branches are merged and their worktrees removed. Branches kept for
traceability: `lane-a-sdkloader-tests`, `lane-d-autotracker`, `lane-f-pagestracker`,
`lane-g-choices`, `lane-h-transport`, `lane-i-loader`, and three `worktree-agent-*`.
Delete them once the PR merges. **Process lessons are in §3n and §3o and in
`~/.claude/agent-routing/LEDGER.md` — read them before running lanes again.**

## 3q. Six more defects fixed — 2026-08-12

Worked in the order the user set: **defects → prettier sweep → `any` → autoTracker
splits.** This is the defects step, and it is done as far as it can go without a
decision. One commit each, per `DEFECTS.md`'s no-batching rule.

| Defect   | Fix                                                                     | Customer-visible?                                 |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| **D-13** | `RecordModel._name`/`ProductModel._name` returned `''`; now `this.name` | Yes — CustomEvent detail only, **never the wire** |
| **D-16** | `consent()` no longer reads a `pageId` the model discards               | Yes, as an improvement — see below                |
| **D-21** | `__intemptGuardManager` documented as internal, not a config hook       | No                                                |
| **D-24** | the unreachable `if (!isValidConfig(config)) return;` deleted           | No — behaviour identical                          |
| **D-25** | a **missing** required config field now fails like an empty one         | Yes, for direct constructors only                 |
| **D-26** | shared cookie teardown now expires domain-scoped cookies                | Test-only                                         |

**The one non-obvious finding, in D-16.** The discarded `getPageId()` read was not
merely dead work: `PageTrackerModule.getId()` **mints the page-session cookie** when
none exists, and `consent()` is deliberately ungated by opt-out (D-5). So an
opted-out visitor calling `consent({action:'reject'})` had a tracking cookie written
for them **by the very call that refused tracking**. Deleting a dead read fixed a
small privacy defect nobody had noticed.

**D-25 was the only fix that broke asserted tests** — exactly two, which is the
register working as designed. Note it deliberately does **not** validate
`shopify`/`magento`: they are booleans with meaningful defaults and requiring them
would break every existing caller.

**Two things deliberately left, with the reasoning, so they are not re-derived:**

- **The dead `if (!this.isXValid(params)) return;` shape survives at the five public
  method call sites.** Every guard throws or returns literal `true`, so all five are
  as unreachable as D-24's was. Removing them wants the guards' return type changed
  to `void` — otherwise a future author reintroduces the assumption — and that
  rewrite belongs with the `any` sweep, which touches those signatures anyway.
- **D-21's real fix is still open.** Documenting the global as internal is the
  cheaper of the two options D-21 offered; making it a genuine hook means the
  bootstrap awaits something, which delays every page's first event. Product call.

**Verified on the working tree, not inferred:** build clean (`tsc` + vite,
93,890 B / 27.35 kB gzip), unit **936/32 files**, coverage 76.86 / 70.62 / 77.36 /
77.79 against 75/68/75/75, ESLint **0 errors / 205 warnings** (unchanged, still at
the ratchet), size-limit under all three budgets, `checkReservedWords` clean,
Cypress **126/126**. The D-26 guard was additionally verified to **fail** against the
old teardown before being kept — an order-dependent test that passes vacuously is
worse than none.

### The four remaining defects all need one decision, not code

Each converts silence into a throw, or changes a value ingest already receives. All
four are one-liners once the call is made; none should be shipped on my judgement.

| Defect   | The decision                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D-14** | An untitled `group()` is named `'Identify'` at ingest, indistinguishable from an identify. Fixing it **changes a value already in customer reports** (e.g. to `'Group'`), so it needs ingest sign-off and a release note — not just a code change.                       |
| **D-18** | `productAdd`/`productView`/`productOrdered` call no guard at all: `productAdd(undefined)` builds an event with `data: undefined`. Adding a guard means the SDK **throws inside a customer's page** where it used to send junk. Breaking, and worth a deprecation window. |
| **D-19** | `identify` rejects a falsy `userId`; `group` accepts `accountId: 0` and `''`. Same shape as D-18 — tightening `group` throws for callers that work today.                                                                                                                |
| **D-20** | `consent.validUntil` is typed required and never validated. Same again: validating it throws in a consent banner's click handler, which is the one place a throw is most damaging.                                                                                       |

**My recommendation if asked:** do D-20 and D-19 as _warn-and-proceed_ through the
logger rather than throws (no breakage, the problem becomes visible), hold D-18
behind a deprecation note, and hold D-14 until the ingest conversation
(`BACKEND.md`) is happening anyway, since it is a wire-value change.

## 3r. Prettier, the `any` sweep, and the last two splits — 2026-08-12

The user's order for §3p's remaining work was **defects → prettier → `any` → autoTracker
splits**. §3q is the defects step; this is the other three. Each landed as its own
commit with every gate green.

|                         | Before                                   | After                                                                   |
| ----------------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| `prettier --check`      | 98 of 107 files failing, gate advisory   | **clean, gate blocking**                                                |
| `any` in `src/`         | 99 (docs said ~60; the lanes added more) | **0**                                                                   |
| ESLint                  | 205 warnings, 2 rules deferred           | **97 warnings, 0 errors**; `no-explicit-any` + `no-console` = **error** |
| `autoTracker.module.ts` | 526 lines                                | **400**                                                                 |
| Unit                    | 936                                      | **938**                                                                 |
| Bundle                  | 93,814 B                                 | 94,580 B                                                                |

### The prettier sweep

140 files, +6824/-4527, landed alone as the plan required. **`printWidth` stayed at the
committed 80** rather than being widened to the de-facto ~90 (p95 of line lengths is 82;
1500 lines exceed 80 against 162 that exceed 100). Widening would have produced a far
smaller diff, but the point of the sweep is to enforce the config that exists, not to
ratify the drift — a `printWidth` change is a separate preference decision.

**The proof it changed no behaviour is that `dist/intempt.min.js` came out
byte-identical**; the minifier does not care where the newlines were.

`continue-on-error` is off ci.yml's prettier step, and **`.claude` is now in
`.prettierignore`** — worktrees hold full checkouts including their own `dist/`, which
is what made ESLint report 4048 problems instead of 323 in §0a, and with a blocking gate
that would now fail the build on files that are not even this branch's.

### The `any` sweep found three real defects

Which is the argument for doing it rather than suppressing the rule:

1. **Two response classifiers disagreed about the same input.** A _delivered_ response
   with no `httpStatusCode`, or a non-numeric one, fell past every retryable branch —
   `undefined >= 500`, `undefined === 429` and `undefined <= 0` are all false — so the
   batch was **dequeued unconfirmed**. Yet `isDefiniteSuccess` classified that identical
   response as inconclusive, and had a test saying so. Same silent-loss family as §6a's
   three. Both now agree: a status that is not a number is no status, and no status
   means retry. Two cases added to the retryable table.
2. **`RequestQueue` declared a storage type the SDK never passes.**
   `queueStorage?: QueueStorage` (the concrete localStorage class) while the SDK passes a
   `PersistentStore`; they are not structurally assignable, each having private fields
   the other lacks. It compiled only because `RequestBatcher.queueStorage` was `any`,
   which laundered the mismatch on the way down. Now a named `QueueStorageLike` that
   both classes `implement` — which is also what lets a test pass a stub.
3. **`choices.service.ts` trusted localStorage.** `localStorageCache.get` returned `any`,
   so `storedData.changes` was assumed on whatever any page script had written under that
   key. Now narrowed, with a non-array treated as "no changes" rather than throwing
   inside the render path.

**Type decisions not to re-derive:**

- **`AttributeBag = { [key: string]: unknown }`** for customer-supplied bags (event data,
  user/account traits). **Not a `JsonValue` union** — that would be _stricter_ than the
  `any` it replaced and would reject the `Date` and `undefined` values customers really
  pass. `unknown` accepts everything on the way in and constrains only _reading_, which
  the SDK never does: these go straight to `JSON.stringify`.
- **`QueueEntry.payload` and `StoredEntry.value` are `unknown`** — the queue stores event
  bodies without ever reading a field. Test sites that legitimately know the shape say so
  once through a `pl()` helper instead of casting inline.
- **`BatchSendOptions`/`BatchSendResult` moved into `requestBatcher.ts`**, where the
  contract belongs; the transport is one implementation of it and the tests are another.
- **`BaseModel.payload: unknown[]`** — `any[]` additionally made the _narrowed_ members
  assignable in both directions, so a track payload could be handed to something
  expecting identify entries.

**One lint trap worth knowing:** a `-- reason` suffix on `eslint-disable-next-line`
attaches to the **following comment line**, not to the code. Three directives were
silently doing nothing. Put reasons on the same line, or use a block disable — which is
what `logger.ts` does, since a per-line disable inside a ternary cannot work.

The five surviving `console.*` sites in shipped code each carry a scoped disable naming
why: the logger's own console transport, EnvConfig's warning that fires _during_ the
initialisation of the logger's own config source, the GDPR default sink, the
CAN'T-FIND-SCRIPT error, and one example file. A sixth now fails the build.

### The splits

`autoTracker.consent.ts` (consent state, the browser signal, the `/consents/data` POST)
and `autoTracker.eventPool.ts` (the legacy unbatched path). The four consent members stay
on `AutoTrackerModule` as delegating accessors, so the split is invisible to `IntemptJs`.

**+510 B of bundle for the wiring, not the extraction** — as §3p predicted: two
constructors, two field initialisers, six delegating members.

Isolating the pool made visible what inline code hid: **that path has no persistence, no
retry, no circuit breaker and no bound.** It runs only when the batcher failed to
initialise (a storage tier that will not open), and keeping it is still right because the
alternative is no tracking at all. Also now documented rather than silently carried:
**the pool's `debounce` does not debounce** — a fresh one is created per call, so no timer
is shared and each event schedules its own flush. Preserved deliberately, because the
flush drains the whole pool, so the effect is extra no-op flushes rather than lost or
duplicated events. **Do not "fix" it without a test pinning the resulting request count.**

## 3s. The PR is open, both never-run jobs passed, and the real mutation score is 58.83%

### PR #191 into `staging` — 121 commits, 176 files

**One flake surfaced on the second push and is fixed — read this before touching
`payloadContract.test.ts`.** `Unit tests + coverage (node 24.x)` failed with _"No entry
named Identify in the captured batch. Saw: Session start"_, on a docs-and-config
commit that changed no source. This is the **same defect as §0c failure #5, in the
helper rather than the goldens**: the §0c fix narrowed each golden to its own entries,
but `flushAndCapture` still stopped polling at the **first** matching request — and
because all tests share one SDK instance (D-2), the auto-tracked bootstrap can be
flushed on its own ahead of the test's event. The golden then looked for `Identify` in
a batch containing only `Session start`.

Fixed by making the wait **name-aware**: `flushAndCapture(path, ...names)` polls until
the events the test actually needs have landed, and orders matching requests so a
carrying one comes first. Nine call sites now pass their names, including the
multi-event `mixed-batch` golden, where a bare wait could be satisfied by a request
holding only the first of three events. **The fix removes a timing dependency rather
than widening a sleep** — which is the third time on this branch that a "raise the
timeout" instinct would have papered over a real ordering bug. Verified by running the
file six times and the whole tier three times.

**Both `pull_request`-only jobs ran for the first time in the programme's life, and
both passed:** `Cypress e2e` 126/126, and `Mutation score` **86.68% ≥ break 85** in
**24m36s**. With that, **every job in `ci.yml` has now executed at least once.** Given
§0c — four of five past CI failures were invisible locally — this was the largest
outstanding unknown, and it came back clean.

The one number worth keeping: **24m36s on a GitHub runner for the narrow mutation
scope, against 3.5–4 min locally on 8 cores.** That ~7x is the constraint behind the
decision below.

### The mutation scope, widened and then deliberately split in two

Measured for the first time over **all of `src/`**: **58.83%**, against the 86.57%
the narrow scope reported. Both numbers are real; they have different denominators,
and the gap is the finding — **the old headline said nothing about the code nine
parallel lanes had just changed.**

| Area                        | Score     | No-coverage mutants                    |
| --------------------------- | --------- | -------------------------------------- |
| `shared/**` (the old scope) | **85.27** | 46                                     |
| `intemptJs.ts`              | 84.67     | 7                                      |
| `_baseUrlParser.ts`         | 89.47     | 0                                      |
| `choices/**`                | 47.70     | 111                                    |
| `autoTracker.module.ts`     | 27.42     | 42                                     |
| `autoTracker.transport.ts`  | 30.08     | 30                                     |
| `autoTracker.eventPool.ts`  | **0.00**  | 31                                     |
| `loaders/**`                | 22.87     | 229 (`webEditorLoader` **0.00** / 169) |
| `platformParser.ts`         | **7.36**  | 288                                    |
| `main.ts`                   | **0.00**  | 47                                     |

**Two configs, not one.** `stryker.conf.json` keeps the narrow scope and the **85**
floor and stays the CI gate; **`stryker.full.conf.json`** mutates everything, gates at
**57** (~2 under measurement, per the usual ratchet rule) and runs on demand via
`npm run test:mutation:full`.

Two rejected alternatives, so they are not revisited:

- **One wide gate at 57.** Rejected because `shared/**` is the majority of all mutants,
  so it could regress ten points and a 57 threshold would still pass. The core's
  ratchet is worth more than a single tidy number.
- **The wide scope in CI.** At ~1.7x the mutants of a run that already takes 24m36s,
  that is 40+ minutes on every PR. Not worth it for a number nobody acts on per-commit.

**The worklist, by no-coverage count** — where the cheap kills are, with §3f-iii's
correction applied (no-cov in _guard and report_ code is NOT cheap; prefer code that
computes a value): `platformParser` 288, `loaders` 229, `choices` 111, `main.ts` 47,
`autoTracker.module` 42, `eventPool` 31, `transport` 30.

**The full testing-gap audit is now `AUDIT.md` §1c** — every under-tested file, with unit
coverage and mutation score side by side, split into "do these first" and "deliberately
not now". Headline: **`platformParser.ts` is the worst risk in the SDK** (162 LOC, 27.8%
lines, **7.36% mutation, 288 uncovered mutants**) because it labels every event with
device/browser/geo attributes and fails _silently_ when wrong. Second is
`HtmlEventData.component.ts` at **0%**, which contains the password/`doNotCapture`
redaction — the only privacy control on auto-tracked DOM data, asserted by nothing.

**`webEditorLoader.ts` and `main.ts` have no test of any kind** — 0.00% with every
mutant uncovered. `main.ts` is the bootstrap and `webEditorLoader` is the visual-editor
entry point, so neither is on the customer event path, which is presumably why both
were skipped. That is a defensible priority, not an accident, but it should be a
recorded one.

## 4. Three live defects — ✅ all three fixed

Real bugs found during the audit, fixed out of phase order because all three were
customer-visible today. Covered by `tests/unit/requestBatcher.test.ts` — the
original `__tests__/batcherDedupeLifecycle.cy.ts` was **migrated into the unit
tier and deleted**, so do not go looking for it.

| #   | Defect                                                                                           | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `itemIdsSentSuccessfully` never pruned → memory leak on long-lived tabs                          | `recordDeliveryAttempts()` now **deletes** an item's counter when its queue removal succeeds — the counter only ever mattered for items still in the queue, i.e. whose removal _failed_, so retaining the rest was pure leak. Hard cap `MAX_TRACKED_ITEM_IDS = 1000` as a backstop. **Also fixed the same class of bug in `sentEventIds`**: persistence was capped at 1000 but the in-memory `Set` was not, so it grew without bound while only the tail was ever written. `markEventIdsSent()` caps it, and an over-sized persisted set is trimmed on load. |
| 2   | `handleResponse` returned before `removeItemsFromQueue` when `unloading: true` → duplicate sends | On unload, if `isDefiniteSuccess(response)` (an `ok`/2xx, never an error or 0/5xx), the batch is now dequeued. Inconclusive outcomes keep the old retain-for-next-load behaviour — losing events is worse than a possible duplicate. **Second, deeper cause fixed:** items skipped by the `alreadySent` check were only `continue`d, so they sat at the head of the queue forever, burning part of every future batch, and became re-sendable once their eventId aged out of the capped window. They are now **evicted**.                                    |
| 3   | `optIn`/`optOut` set an in-memory flag only → opt-out reset on reload                            | New `src/shared/consentState.ts` (`loadDoNotTrack` / `persistDoNotTrack`). `AutoTrackerModule._doNotTrack` initialises from storage; the setter persists. Opt-**in** writes too, so consent is not a one-way door. Storage errors are swallowed — `optOut()` must never throw back into a consent banner's click handler.                                                                                                                                                                                                                                    |

### Carried-forward caveats from these fixes

- ~~**Consent is origin-scoped.**~~ **✅ FIXED in §3g / D23.** Consent is now
  written to a cookie at the eTLD+1 as well as `localStorage`, so an opt-out on
  `www.example.com` does carry to `shop.example.com`. localStorage is retained as
  a fallback and a legacy localStorage-only opt-out is upgraded to a cookie on
  read, so no pre-existing opt-out was re-enrolled.
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

|                       | Before              | After        |
| --------------------- | ------------------- | ------------ |
| `dist/intempt.min.js` | 225.86 kB           | **72.43 kB** |
| gzip                  | 64.89 kB            | **20.86 kB** |
| Runtime dependencies  | `psl`, `@types/psl` | **none**     |

That is a **68% cut on every page load**, and the SDK now has a zero-dependency
runtime — which also removes the whole `psl` supply-chain surface ahead of
Phase 4.

**How it was verified — this matters if you touch the heuristic.** A parity
harness ran the old `psl`-backed `handleDomain` and the new one over 58
hostnames. It found and forced the fix for a real regression: private suffixes
(`github.io`, `vercel.app`, `herokuapp.com`, `appspot.com`, `blogspot.com`, and
**`myshopify.com`** — this SDK ships a Shopify tracker) resolve to a _public_
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

## 6a. Phase 2 — unit test tier ✅

**`vitest` + jsdom, `tests/unit/**`, **357 tests**, run with `npm run test:unit`.**
(105 when this tier first landed; §3a–§3c took it to 147, and the guard port in
§3e added 210.)
Config in `vitest.config.ts`; shared jsdom/storage/timer setup in
`tests/unit/setup.ts` (adapted from Mixpanel's `jsdom-setup.js`, Apache-2.0).

| Script                  | What it runs                                                      |
| ----------------------- | ----------------------------------------------------------------- |
| `npm run test:unit`     | tier 1 — vitest, jsdom, fast                                      |
| `npm run test:coverage` | tier 1 + coverage gate                                            |
| `npm run test:mutation` | StrykerJS over the same scope — see §3f                           |
| `npm run test:e2e`      | tier 2 — the remaining 12 Cypress specs, real browser             |
| `npm test`              | alias of `test:e2e` (unchanged, so nothing that called it breaks) |

**Coverage gate is enforced and passing** on `src/shared/**` + `src/guard/**` +
`src/intemptJs/guards/**` (widened in §3e): lines/statements **92.57%** (≥90),
branches **89.64%** (≥87), functions **88.88%** (≥87).

Four Cypress specs have now been **migrated** into the unit tier rather than
duplicated — `publicSuffix.cy.ts` and `batcherDedupeLifecycle.cy.ts` with this
tier, then `trackingGuard.cy.ts` and `botGuard.cy.ts` in §3e. All four were pure
logic and gained fake-timer control by moving. **12 Cypress specs remain.**

### The property tests earned their keep immediately

`tests/unit/queueInvariants.test.ts` runs random enqueue/flush/failure
interleavings against two invariants — **no event is ever delivered twice** and
**no accepted event is ever lost** — with a seeded PRNG so failures reproduce.

It failed on the first run, on every seed, and found **three real data-loss
defects that code review had missed**:

1. **A network error while `navigator.onLine` was true was treated as a
   _success_.** The retryable check required `httpStatusCode <= 0 && !navigator.onLine`,
   so any transport failure where the browser still believed it had a link — a
   captive portal, a dead VPN, an unreachable API — fell through every branch and
   the batch was dequeued **having never been delivered**. This is the most
   serious defect found in the programme so far: silent, total loss of a batch,
   in the exact conditions a flaky network produces.
2. **Pre-send marks were never rolled back on failure.** Event ids are marked
   sent _before_ the request (so a page dying mid-flight cannot duplicate), but a
   failed send left the mark, so the events were filtered as "already sent" on
   every later flush and then evicted — silently lost. Now rolled back on any
   definite failure; the mark stands only when the outcome is genuinely unknown
   (page unloading with no response), which is the case it was designed for.
3. **`generateId` collided within a millisecond.** Eight of its ten random
   characters were a _shuffle of the timestamp's own base-36 digits_, so ids
   minted in the same millisecond differed by a permutation of identical
   characters plus two random ones. A 5,000-iteration loop collides. These ids
   identify **profiles and sessions**, so a collision merges two visitors' data —
   and at the 1M events/sec target, same-millisecond generation across the fleet
   is continuous. Now uses `crypto.getRandomValues` (with a `Math.random`
   fallback), same id shape.

None of these three are in `AUDIT.md`. They are the argument for Phase 2 in
concrete form: the audit found what reading could find, and the tests found what
reading could not.

## 6b. Phase 3 — IndexedDB persistence tier ✅

`src/shared/storage/indexedDbStore.ts` + `src/shared/storage/persistentStore.ts`,
derived in shape from Mixpanel's `indexed-db.js` / `wrapper.js` (Apache-2.0).
18 unit tests, run against **real IndexedDB** via `fake-indexeddb`, not a double.

**Why:** `localStorage` is synchronous, so every queue write blocked the host
page's main thread, and it caps at ~5 MB shared with that page — a cap we do not
control and cannot detect until a write throws.

**How it landed without touching the queue:** `PersistentStore` implements the
same async interface as `QueueStorage` (`init`/`getItem`/`setItem`/`removeItem`),
so it drops into `RequestQueue` through the existing `queueStorage` option.
`RequestQueue` is unchanged. `AutoTrackerModule` now constructs it with
`dbName: intempt_<sourceId>`.

Fallback policy: IndexedDB first; on a failed open, localStorage **permanently
for that page** (the causes — private mode, sandboxed iframe, corrupt profile —
are not transient within a page's life, and retrying per-operation would make
every write pay the failed-open cost); if a write fails _after_ a successful
open, fall back mid-flight rather than dropping the batch; if neither tier comes
up, reject so `RequestQueue` degrades to its in-memory queue.

**Follow-up done — per-event records.** `RequestQueue` now stores one record per
event under `<storageKey>:i:<paddedTs>_<seq>_<id>`, replacing the single JSON
array. See §6c.

Two Cypress assertions in `autoTrackerBatcher.cy.ts` were rewritten as part of
this: they read `localStorage` directly, so they failed the moment the tier
landed. The behaviour was right and the test was asserting an implementation
detail — they now read through `PersistentStore`.

## 6c. Phase 3 — per-event queue records ✅

`RequestQueue` stores **one record per event**, key
`<storageKey>:i:<paddedTimestamp>_<seq>_<id>`, instead of one JSON array.

**Why:** the array layout made every enqueue and every removal a read-modify-write
of the whole pending queue — serialise N events to append the (N+1)th. O(N) CPU
per event on the customer's main thread, quadratic over a burst, and worst
exactly when the queue is deepest. Now an enqueue is one O(1) write and a batch
read costs one batch rather than one queue.

**Three properties fall out of the layout, and two matter more than the speed:**

- **Cross-tab writes stop conflicting.** Appends carry unique keys, removals
  target keys, so two tabs can no longer clobber each other by writing back a
  stale array. **`SharedLock` is therefore off the enqueue/remove hot path** —
  retained only for the one-time legacy migration, where a whole-array rewrite
  genuinely does race. That also removes the lock's 50 ms polling from every
  enqueue.
- **A corrupt record costs one event, not the queue.** Readers skip unparseable
  entries; under the array layout one bad write made the whole queue unreadable.
- Key order is FIFO order. The timestamp is zero-padded so string comparison is
  correct, and a per-instance sequence breaks ties inside one millisecond —
  without it a burst comes back in arbitrary order. There is a test for this.

**Migration — do not remove it casually.** Customers have events sitting in the
old array format right now, so `migrateLegacyQueue()` imports them on first read
and deletes the legacy key (so the import cannot run twice and duplicate). It
runs under the shared lock, tolerates malformed entries, and a failed migration
is reported but never blocks new events. Three tests cover it.

`removeItemsByID` resolves keys from memory when it can and falls back to a
storage key scan for items queued by _another tab_, which are not in this page's
`memQueue`.

**Test-suite note for the next session:** several Cypress and unit assertions
read the queue's storage layout directly and had to be rewritten twice now — once
for the IndexedDB tier, once for per-event records. They assert implementation,
not behaviour. If they break again, prefer rewriting them to go through
`PersistentStore`/`RequestQueue` rather than reaching into storage.

## 6. Invariants — do not violate without asking

1. **Never push to `staging` or `main`.** The branch's upstream tracking was
   deliberately unset (it was created from `origin/staging` and would otherwise
   have pushed there by default). When first pushing, use
   `git push -u origin beso/sdk-enterprise-hardening`.
2. **Production deploys only from `main`**, and the `/v1` CDN path is _mutable_ —
   overwriting it is live for all customers with no artifact to roll back to.
   One incident already: `af1a16b`, reverted in `3dc3a54`.
3. **After any deploy, verify the live bundle** and spot-check real host sites
   embedding the SDK. A green workflow is not evidence.
4. **Keep TypeScript.** Measured: zero downlevel helpers emitted
   (`target: ES2020`), so TS costs ~0 bundle bytes. It is not a footprint problem.
5. **Do not add features before the Phase 2 test tier exists.** Every feature
   added first makes the test tier more expensive to build.
6. Mixpanel is **Apache-2.0**. Direct code reuse is fine _with_ attribution —
   retain license headers and NOTICE the derivation. Confirm with counsel before
   shipping copied files.

## 7. Phase map & projected score

| Phase | Scope                                                                                                      | Δ   | Cumulative | Status                                                                                                                                                                                                                                                                                          |
| ----- | ---------------------------------------------------------------------------------------------------------- | --- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Audit & plan                                                                                               | —   | 40         | ✅ Complete                                                                                                                                                                                                                                                                                     |
| 1     | Make it a package (semver, `.d.ts`, exports, changelog)                                                    | +7  | 47         | 🟡 **In progress** (2/5 tasks)                                                                                                                                                                                                                                                                  |
| 2     | Test foundation (vitest unit tier, port Mixpanel suites, coverage gate)                                    | +12 | 59         | 🟡 tier 1 ✅ (**363 tests**, gate enforced at 90/87/87/90), **`ci.yml` gates merges ✅**, **guard suites ported ✅**, **mutation testing ✅ (71.42%)**; killing queue-core survivors, contract tests and WDIO tier 2 remain                                                                     |
| 3     | Reliability & perf core (IndexedDB tier, unload fix, transports, drop `psl`, code-split, load shedding)    | +14 | 73         | 🟡 `psl` ✅, unload ✅, **IndexedDB ✅**, **per-event records ✅**; transports ⏸ (BE), code-split ⏸ (user), load shedding ✅ **jitter, circuit breaker, bounded queue** (4th ⏸ BE)                                                                                                              |
| 4     | Security, privacy, observability (credential hygiene, `gdpr-utils` port, logger, supply chain, kill `any`) | +11 | 84         | 🟡 **client-side security ✅ (§3g-ii)** — secret scan, last diagnostic guarded, SRI/CSP docs; **supply chain ✅ (§3g-i)**, 19 advisories → 4 with `vite` blocked on Node 21. Credential itself ⏸ (BE). `gdpr-utils`, logger, killing `any` remain                                               |
| 5     | CI/CD, docs, release engineering                                                                           | +9  | **91**     | 🟡 the fast gate (`ci.yml`) landed early, out of phase order, because Phases 2–3 had built a lot with nothing gating it — §3d. **CI breadth ✅ (§3g)**: lint/format, size budget, audit gate, SHA pins, Sonar gate, **`release.yml` ✅**. `browser-tests.yml` (needs Sauce) / changesets remain |

| 4 | Security, privacy, observability (credential hygiene, `gdpr-utils` port, logger, supply chain, kill `any`) | +11 | 84 | 🟡 **privacy & consent ✅ (§3h)** — `gdpr-utils` ported, cross-subdomain consent (D15 closed), DNT/GPC, opt-in PII scrubbing, `apiHost`; credential hygiene ⏸ (mostly BE), logger ⬜, supply chain ⬜, kill `any` ⬜ |
| 4 | Security, privacy, observability (credential hygiene, `gdpr-utils` port, logger, supply chain, kill `any`) | +11 | 84 | 🟡 **observability ✅ — logger, sink hook, metrics (§3i)**; credential hygiene mostly ⏸ (BE); `gdpr-utils` port, supply chain, `any` remain |
| 5 | CI/CD, docs, release engineering | +9 | **91** | 🟡 the fast gate (`ci.yml`) landed early, out of phase order, because Phases 2–3 had built a lot with nothing gating it — §3d. `browser-tests.yml` / `release.yml` / changesets remain |

Phase deltas assume the earlier phases landed; they are not independent.

## 8. If you only do three things

The original three (test tier; IndexedDB + unload fix + drop `psl`; persisted
opt-out) are **all done** — §6a, §6b, §5, §4. Persisted opt-out landed as §4
defect 3. Credential hygiene (Phase 4) is the one item from that list still open.

`ci.yml` — item 1 of the previous list — is **done** (§3d). The current three:

1. **Golden-file contract tests on the outbound payload shape** — the last named
   Phase 2 item. (The guard port and threshold raise, previously item 1, are done
   — §3e.)
2. **Credential hygiene (Phase 4)** — the remaining finding that fails an
   enterprise security review outright.
3. **Hand `BACKEND.md` to the backend team.** Five items are blocked behind it
   and none of them move without that conversation starting.

## 9. Reference material

| What                                                        | Where                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| **The ordered TODO list**                                   | **this file, §0b**                                                   |
| **~30 defects found and not fixed, with a suggested order** | **`docs/sdk-hardening/DEFECTS.md`**                                  |
| Full audit + 5-phase plan + proposed CI/CD harness          | `docs/sdk-hardening/AUDIT.md`                                        |
| **Front-end roadmap to ~85, ranked by points/day**          | **`docs/sdk-hardening/FRONTEND.md`**                                 |
| What the SDK needs from ingest (handover spec)              | `docs/sdk-hardening/BACKEND.md`                                      |
| Settled decisions + rationale                               | `docs/sdk-hardening/DECISIONS.md`                                    |
| Mixpanel comparator checkout                                | `/home/beso/mixpanel-js` (v2.81.0)                                   |
| Proposed CI/CD files (not applied)                          | `AUDIT.md` §3b — 7 files, with rollout order                         |
| Mixpanel files to port                                      | `AUDIT.md` §3 — file-by-file table with effort estimates             |
| Audit as a shareable web page                               | https://claude.ai/code/artifact/0976f36f-3570-499b-876f-7bca41f5854a |
| `BACKEND.md` as a shareable web page (for the backend team) | https://claude.ai/code/artifact/82bd5a93-23fe-49e5-b371-ae3fae3acd56 |
| Originating session                                         | https://claude.ai/code/session_018wfQQGBNVphxBe7QsJVCYV              |

The artifact is a rendered copy of `AUDIT.md` for sharing with non-engineers.
**`AUDIT.md` in this repo is the authority** — if the two diverge, the repo wins.
To update the artifact, republish `AUDIT.md` passing that URL as `url`; publishing
without it creates a _second_ artifact instead of updating this one.

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
