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
| **Next action** | **§3 item 1 — golden-file contract tests on the outbound payload shape.** Mutation testing is in place and measured (§3f, §3f-i); the recommendation there is to treat 71.42% as a ratchet floor rather than grind it upward, so contract tests are the top item again. Nothing is blocked. |
| **Phase** | Phase 0 ✅. Phase 1 ⏸ **backlogged by the user** (packaging). §4 defects ✅. Phase 2 tier-1 ✅ + **CI gate ✅** + **guard suites ported ✅** + **mutation testing ✅**. **Phase 3 in progress** — `psl` ✅, unload ✅, **IndexedDB tier ✅**, **per-event records ✅**, **jitter ✅**, **circuit breaker ✅**, **bounded queue ✅**. |
| **Code changed so far** | `package.json` metadata; version single-sourced; **all three live defects in §4 fixed**; **`psl` dropped — bundle 225.86 kB → 72.43 kB, zero runtime deps**; **vitest unit tier added, which found three further data-loss defects (§6a)**. **IndexedDB tier + per-event queue records**. **Jitter on retry backoff + flush interval (§3a)**. **Circuit breaker (§3b)**. **Bounded queue + drop policy (§3c)**. **`.github/workflows/ci.yml` — the tests now gate merges (§3d)**. **Guard suites ported to the unit tier + coverage scope and thresholds raised (§3e)**. **StrykerJS mutation testing, 73.76% and climbing to a user-set 85% floor (§3f)**. **`maxQueuedEvents` threaded through `RequestBatcher` — the §3c cap was not actually overridable (§3f-i)**. Unit **387** / Cypress **122**, all passing. Bundle 81.78 kB / 23.09 kB gzip. |

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
3. Cross-subdomain consent cookie (the D15 limitation).
4. Phase 4 client-side leftovers — structured logger, killing `any`.

## 3a. Load shedding 1 of 3 — jitter ✅ (retry backoff + flush interval)

Landed 2026-08-11 in `src/shared/queue/requestBatcher.ts`. **Decisions the user
made — do not re-litigate:**

- **Full jitter**, not equal jitter: `sleep = random(0, ceiling)`. The usual
  objection (a client may retry almost immediately) does not apply, because
  `flush()` cannot start while `requestInProgress` is true.
- **Steady-state flush interval jittered too**, in a follow-up commit: `±10%`
  around the configured value via `jitterAroundBase()` in `resetFlush()`, which
  is the single choke point for the normal schedule. A *narrow band*, not full
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
scheduled delay itself. Feeding it a *jittered* delay would make the next ceiling
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
sends it, so that branch may be dead code. If it *is* live, honouring it verbatim
means every client told "come back in 30s" returns in the same 30th second — the
same herd, server-scheduled — and it should become a floor jittered upward
(`retryAfter + random(0, retryAfter * 0.2)`).

**Note for benchmarking against Mixpanel: Mixpanel does not jitter at all.**
`request-batcher.js:274` is `var retryMS = this.flushInterval * 2;`, identical to
what this SDK shipped (ours is a port). They jitter their shared-lock poll
(`shared-lock.js:68`) but never the backoff. So this item is *ahead* of the
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
The cross-tab test therefore asserts the cap holds, not *which* event went.

6 tests added (147 unit total).

## 3d. Phase 2/5 — `ci.yml`, the merge gate ✅

Landed 2026-08-11 as `.github/workflows/ci.yml`. Everything built in this
programme was previously guarded by tests that ran **only when someone
remembered to run them**; this converts them into a gate.

**The two real gaps it closes.** `build.yaml`'s `Build-and-Test` job runs on
*push* only, skips `main`/`staging` refs, and runs only Cypress + build. So
(a) the 147-test vitest tier and its coverage gate ran **nowhere** in CI, and
(b) a **pull request** into `staging` or `main` was gated by **nothing at all**
— the autopr-created staging→main PR included.

Three jobs, each running a script that already exists and already passes:

| Job | Command | Node |
|---|---|---|
| `unit` | `npm run test:coverage` (thresholds enforced in `vitest.config.ts`) | matrix 20.x, 21.x |
| `build` | `npm run build` + `node scripts/checkReservedWords.js` | 21.x |
| `e2e` | `npm run test:e2e` | 21.x |

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
  config in this repo. The job would fail on *command not found*.
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
*that* commit; §3e supersedes them); `npm run build`
clean at 81.74 kB / 23.08 kB gzip; `checkReservedWords.js` clean;
`npm run test:e2e` 213 passing / 4 pending. The YAML was parsed to confirm the
three jobs and both triggers resolve.

**Still not verified, and cannot be from here:** that the workflow is green *on
GitHub*. The branch has not been pushed. First push must be
`git push -u origin beso/sdk-enterprise-hardening` (Invariants §6.1) — and note
that push will trigger both `build.yaml` and this new file. Watch the first run.

## 3e. Phase 2 — guard suites ported, coverage scope widened ✅

Landed 2026-08-11. `__tests__/trackingGuard.cy.ts` and `__tests__/botGuard.cy.ts`
were **migrated and deleted**, not duplicated — do not go looking for them. Four
new unit files, **210 new tests** (unit 147 → **357**, Cypress 213 → **122**).

| New file | Covers |
|---|---|
| `tests/unit/guardConditions.test.ts` | all 10 condition factories |
| `tests/unit/botDetection.test.ts` | `isLegitimateBrowser`, `isLikelyBot`, the crawler guard |
| `tests/unit/trackingGuardManager.test.ts` | manager lifecycle + `checker.ts` |
| `tests/unit/intemptJsGuard.test.ts` | `IntemptJsGuard` — **had no test anywhere** |

**Coverage went up, not down**, despite the scope widening — `src/shared/**` plus
`src/guard/**` plus `src/intemptJs/guards/**`:

| | Before (shared only) | After (all three) |
|---|---|---|
| Statements / lines | 90.34% | **92.57%** |
| Branches | 86.37% | **89.64%** |
| Functions | 86.71% | **88.88%** |

Thresholds moved in the same commit per **D20**: 85/75/85/85 → **90/87/87/90**,
about two points under measured. Widening `coverage.include` without raising them
would have silently *lowered* the effective bar, which is the whole point of D20.

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
   `/compatible;\s*[a-z]+bot/i`, so the UA is *not* a browser — and the guard
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

**Why, in one sentence:** line coverage says a line *ran*; mutation score says a
test would *notice* if that line were wrong — and the three data-loss defects the
property tests found (§6a) were all in code that was already "covered".

**Baseline, measured twice and identical both times** (2,123 mutants over
`src/shared/**` + `src/guard/**` + `src/intemptJs/guards/**`, 3m 0s / 3m 14s):

| Area | Mutation score | Line coverage |
|---|---|---|
| **All files** | **70.66%** | 92.57% |
| `src/intemptJs/guards` | 97.51% | — |
| `src/guard` | 85.48% | — |
| `src/shared` | 59.71% | — |
| → `src/shared/queue` | **54.93%** | — |
| → `src/shared/storage` | 64.09% | — |

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

| | Before | After |
|---|---|---|
| Overall score | 70.66% | **71.42%** |
| `requestBatcher.ts` | 54.92% | **58.74%** |
| Survived | 398 | 397 |
| No coverage | 141 | 128 |

**6 tests killed 14 mutants — about 2.3 each, and +0.76 points overall.** The
prior estimate in this document was "15–25 tests gets us to the low 80s". That
was wrong by roughly 4×: at the measured rate, +10 points needs on the order of
**80–100 tests**. Do not plan on the old number.

**Why the survivor count barely moved (398 → 397) while 14 mutants died.** Almost
all the kills came out of the *no-coverage* column, not the survived column —
those six tests reached code nothing had executed before. The 397 remaining
survivors are different in kind: they are in code that **does** run and is simply
not asserted, so each needs its own targeted assertion. There is no bulk win left
in this file.

**User decision, 2026-08-11: the floor is to be 85%.** The recommendation below
was overruled — go to 85, in file order, ratcheting `break` upward as each file
lands rather than setting 85 up front (setting it now would fail every PR for the
duration). Progress:

| Step | Tests added | Overall | File |
|---|---|---|---|
| baseline | — | 70.66% | — |
| `requestBatcher.ts` first pass | 6 | 71.42% | 54.92 → 58.74% |
| `requestQueue.ts` | 30 | **73.76%** | 54.96 → **72.73%** |

Kill rate so far: 36 tests, +89 detections, +3.1 points. The rate *fell* on the
second pass (2.3 → 1.4 mutants per test) because the remaining survivors are
deeper paths needing their own setup, not shallow accessors. Extrapolating from
the second number, 85% needs roughly another **100–130 tests**.

**A second real defect came out of it, in the legacy migration.** The fallback
deadline (`entry.flushAfter || Date.now()`) went into the record's *key* but not
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
no-coverage mutants in `src/shared/**` are a *worklist*, not noise. Killing the
queue-core survivors is higher value than any remaining Phase 2 item, because the
tests that kill them are the ones that would have caught §6a's three defects
without needing a property test to stumble into them. Open
`reports/mutation/index.html` after a run — it is gitignored, and it lists every
survivor with its diff.

## 3. Next concrete action — pick one, nothing is blocked

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
2. Cross-subdomain consent cookie (D15), structured logger + killing `any`
   (Phase 4). The logger has a concrete consumer now: the drop counter from §3c.
3. **Credential hygiene (Phase 4)** — but note this is now known to be **mostly
   blocked on the backend**, not client-side work: five call sites across four
   endpoints carry the `btoa`'d write key, and the fix is `BACKEND.md` item 1.
   What is ours alone is small (the unguarded `console.error` at
   `choices.service.ts:94`, and SRI/CSP guidance in the customer docs).
4. Close the bot-detection false negative documented in §3e, if it is judged
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

## 4. Three live defects — ✅ all three fixed

Real bugs found during the audit, fixed out of phase order because all three were
customer-visible today. Covered by `tests/unit/requestBatcher.test.ts` — the
original `__tests__/batcherDedupeLifecycle.cy.ts` was **migrated into the unit
tier and deleted**, so do not go looking for it.

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

## 6a. Phase 2 — unit test tier ✅

**`vitest` + jsdom, `tests/unit/**`, **357 tests**, run with `npm run test:unit`.**
(105 when this tier first landed; §3a–§3c took it to 147, and the guard port in
§3e added 210.)
Config in `vitest.config.ts`; shared jsdom/storage/timer setup in
`tests/unit/setup.ts` (adapted from Mixpanel's `jsdom-setup.js`, Apache-2.0).

| Script | What it runs |
|---|---|
| `npm run test:unit` | tier 1 — vitest, jsdom, fast |
| `npm run test:coverage` | tier 1 + coverage gate |
| `npm run test:mutation` | StrykerJS over the same scope — see §3f |
| `npm run test:e2e` | tier 2 — the remaining 12 Cypress specs, real browser |
| `npm test` | alias of `test:e2e` (unchanged, so nothing that called it breaks) |

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
   *success*.** The retryable check required `httpStatusCode <= 0 && !navigator.onLine`,
   so any transport failure where the browser still believed it had a link — a
   captive portal, a dead VPN, an unreachable API — fell through every branch and
   the batch was dequeued **having never been delivered**. This is the most
   serious defect found in the programme so far: silent, total loss of a batch,
   in the exact conditions a flaky network produces.
2. **Pre-send marks were never rolled back on failure.** Event ids are marked
   sent *before* the request (so a page dying mid-flight cannot duplicate), but a
   failed send left the mark, so the events were filtered as "already sent" on
   every later flush and then evicted — silently lost. Now rolled back on any
   definite failure; the mark stands only when the outcome is genuinely unknown
   (page unloading with no response), which is the case it was designed for.
3. **`generateId` collided within a millisecond.** Eight of its ten random
   characters were a *shuffle of the timestamp's own base-36 digits*, so ids
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
every write pay the failed-open cost); if a write fails *after* a successful
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
storage key scan for items queued by *another tab*, which are not in this page's
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
| 2 | Test foundation (vitest unit tier, port Mixpanel suites, coverage gate) | +12 | 59 | 🟡 tier 1 ✅ (**363 tests**, gate enforced at 90/87/87/90), **`ci.yml` gates merges ✅**, **guard suites ported ✅**, **mutation testing ✅ (71.42%)**; killing queue-core survivors, contract tests and WDIO tier 2 remain |
| 3 | Reliability & perf core (IndexedDB tier, unload fix, transports, drop `psl`, code-split, load shedding) | +14 | 73 | 🟡 `psl` ✅, unload ✅, **IndexedDB ✅**, **per-event records ✅**; transports ⏸ (BE), code-split ⏸ (user), load shedding ✅ **jitter, circuit breaker, bounded queue** (4th ⏸ BE) |
| 4 | Security, privacy, observability (credential hygiene, `gdpr-utils` port, logger, supply chain, kill `any`) | +11 | 84 | ⬜ |
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

| What | Where |
|---|---|
| Full audit + 5-phase plan + proposed CI/CD harness | `docs/sdk-hardening/AUDIT.md` |
| Settled decisions + rationale | `docs/sdk-hardening/DECISIONS.md` |
| Mixpanel comparator checkout | `/home/beso/mixpanel-js` (v2.81.0) |
| Proposed CI/CD files (not applied) | `AUDIT.md` §3b — 7 files, with rollout order |
| Mixpanel files to port | `AUDIT.md` §3 — file-by-file table with effort estimates |
| Audit as a shareable web page | https://claude.ai/code/artifact/0976f36f-3570-499b-876f-7bca41f5854a |
| `BACKEND.md` as a shareable web page (for the backend team) | https://claude.ai/code/artifact/82bd5a93-23fe-49e5-b371-ae3fae3acd56 |
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
