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
| **Next action** | **§3 — jitter on retry backoff. The user has open design questions on it; ask before building.** |
| **Phase** | Phase 0 ✅. Phase 1 ⏸ **backlogged by the user** (packaging). §4 defects ✅. Phase 2 tier-1 ✅. **Phase 3 in progress** — `psl` ✅, unload ✅, **IndexedDB tier ✅**. |
| **Code changed so far** | `package.json` metadata; version single-sourced; **all three live defects in §4 fixed**; **`psl` dropped — bundle 225.86 kB → 72.43 kB, zero runtime deps**; **vitest unit tier added, which found three further data-loss defects (§6a)**. **IndexedDB tier + per-event queue records**. Unit 129 / Cypress 213, all passing. Bundle 79.46 kB / 22.53 kB gzip. |

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

1. **Load shedding, client-side three of four — this is the next action.**
   **Jitter on backoff** first: cheapest and highest value, because a million
   clients currently retry in lockstep and amplify any ingest incident. Then a
   circuit breaker, then a bounded queue with an explicit drop policy (today the
   queue grows until quota fails, and quota failure is silent).
2. Rest of Phase 2 — port the guard suites into the unit tier, golden-file
   contract tests on the payload shape, `ci.yml` so the tiers gate merges.
3. Cross-subdomain consent cookie (the D15 limitation).
4. Phase 4 client-side leftovers — structured logger, killing `any`.

## 3. Next concrete action — jitter on retry backoff

> **The user has open questions about this item (as of 2026-08-11) and wants to
> discuss the design before it is built. Do not start implementing it in a fresh
> session without checking in first — ask what they decided.** Everything needed
> to have that conversation is below.

### The problem

`RequestBatcher` backoff is currently **deterministic**:
`src/shared/queue/requestBatcher.ts`, the retryable branch of `handleResponse` —
`retryMS = this.flushInterval * 2`, capped at `MAX_RETRY_INTERVAL_MS` (10 min),
overridden by `Retry-After` when the server sends one.

Deterministic backoff means every client that failed at the same moment retries
at the same moment, and again at the same doubled moment after that. At 1–10M
concurrent sessions that is a synchronised retry wave: the SDK converts a brief
ingest wobble into a self-reinforcing thundering herd, and the herd stays in
phase because every client is running the same doubling schedule. **The SDK's job
during an incident is to not amplify it** — this is the cheapest item in the
whole programme that moves that needle.

### The proposed change (small — roughly 5 lines plus tests)

Apply **full jitter**: `sleep = random(0, min(cap, base * 2^attempt))`, the AWS
Architecture Blog formulation, rather than `sleep = backoff` or
`backoff/2 + random(0, backoff/2)` ("equal jitter"). Full jitter gives the widest
spread and the lowest expected contention; its only cost is that an individual
client sometimes retries sooner than a strict exponential would.

### Decisions to make — these are the user's questions to answer

1. **Full jitter vs equal jitter.** Full spreads best; equal guarantees a minimum
   wait so a client cannot hammer immediately after a failure. Recommendation:
   full jitter, because minimum-wait is already provided by the fact that a flush
   cannot start while `requestInProgress` is true.
2. **Does jitter apply to `Retry-After`?** The server named a specific time. My
   position: **honour `Retry-After` as a floor and jitter only *upward*** (e.g.
   `retryAfter + random(0, retryAfter * 0.2)`), because otherwise every client
   told "come back in 30s" returns in the same 30th second — the exact herd we
   are trying to break, just server-scheduled. This is the one genuinely
   debatable point.
3. **Jitter the normal flush interval too, or only retries?** Retries are the
   incident path and clearly need it. Jittering the steady-state 5s flush
   interval also de-syncs clients that loaded together (e.g. after a CDN purge),
   at the cost of slightly less predictable batching.
4. **Where does the randomness come from?** `Math.random` is fine here — this is
   load spreading, not security. Note `generateId` deliberately uses
   `crypto.getRandomValues` (D19) for a different reason; do not "make them
   consistent".

### Test plan

`tests/unit/requestBatcher.test.ts` already has `schedules a backoff instead of
hammering ingest on a 500`, `honours Retry-After over its own backoff`, and
`caps backoff at ten minutes` — **all three will need updating**, since they
currently assert exact `flushInterval` values that jitter makes non-deterministic.
Stub `Math.random` to pin it, and add a test asserting the spread is actually
wide (e.g. 100 samples do not collapse to one value).

### After jitter, in order

1. **Circuit breaker** — after N consecutive failures, stop for a long window
   rather than probing every interval.
2. **Bounded queue with an explicit drop policy** — today the queue grows until
   quota fails, and quota failure is **silent**. A cap plus a deliberate policy
   (drop oldest, count the drops, report the count) turns silent loss into a
   measurable number.
3. The fourth load-shedding item — a server-controlled brake — is **backlogged**,
   it needs backend work. See `BACKEND.md` §5.

### Other unblocked work, if the user redirects

- Port the guard suites into the unit tier. `src/guard/**` and
  `src/intemptJs/guards/**` are Cypress-only today and deliberately excluded from
  the coverage gate (`vitest.config.ts` says why). Move them, then widen
  `coverage.include` and raise the thresholds **in the same commit** (D20).
- Golden-file contract tests on the outbound payload shape.
- `ci.yml`, so both tiers actually gate merges — nothing runs automatically today,
  which is the weakest link in everything built so far.
- Cross-subdomain consent cookie (the D15 limitation).

Open items carried forward:

- Get ingest-team confirmation before stamping `$lib_version` on payloads (D12).
- The deferred `package.json` entry fields land with Phase 1 task 5 (D11).
- Everything in `BACKEND.md` is blocked on the backend team, by user decision.

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

**`vitest` + jsdom, `tests/unit/**`, 105 tests, run with `npm run test:unit`.**
Config in `vitest.config.ts`; shared jsdom/storage/timer setup in
`tests/unit/setup.ts` (adapted from Mixpanel's `jsdom-setup.js`, Apache-2.0).

| Script | What it runs |
|---|---|
| `npm run test:unit` | tier 1 — vitest, jsdom, fast |
| `npm run test:coverage` | tier 1 + coverage gate |
| `npm run test:e2e` | tier 2 — the 14 Cypress specs, real browser |
| `npm test` | alias of `test:e2e` (unchanged, so nothing that called it breaks) |

**Coverage gate is enforced and passing** on `src/shared/**`:
lines/statements **91.08%** (≥85), branches **85.55%** (≥75), functions
**91.25%** (≥85).

Two Cypress specs (`publicSuffix.cy.ts`, `batcherDedupeLifecycle.cy.ts`) were
**migrated** into the unit tier rather than duplicated — they were pure logic and
gained fake-timer control by moving. The 14 original Cypress specs are untouched.

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
| 2 | Test foundation (vitest unit tier, port Mixpanel suites, coverage gate) | +12 | 59 | 🟡 tier 1 ✅ (105 tests, gate enforced); guard-suite port, contract tests and WDIO tier 2 remain |
| 3 | Reliability & perf core (IndexedDB tier, unload fix, transports, drop `psl`, code-split, load shedding) | +14 | 73 | 🟡 `psl` ✅, unload ✅, **IndexedDB ✅**, **per-event records ✅**; transports ⏸ (BE), code-split ⏸ (user), load shedding ⬜ **next** |
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
