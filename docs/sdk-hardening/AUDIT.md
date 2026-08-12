# Intempt JS SDK — Enterprise Commercial-Grade Audit

> **Reference document — no source code was changed by this audit.** Every file
> in §3b is a _proposal_ to apply when you decide to proceed; none of it has been
> applied. Phase 0 committed documentation only (`CLAUDE.md`, `docs/sdk-hardening/**`).
>
> **Current programme state is not in this file** — it is in
> [`CHECKPOINT.md`](CHECKPOINT.md). Read that first. This document is the long
> reference behind it and is not updated as phases land.

Baseline comparator: `mixpanel-browser` v2.81.0 (`/home/beso/mixpanel-js`).
Audited commit: `ab9d3a6` (branch `beso-fix-vars`). Date: 2026-08-11.

---

## 0. Overall score — BASELINE, 2026-08-10

> **This section is the original audit baseline and is kept for the record.**
> **For the current number, read §0a immediately below: 71/100 as of 2026-08-12.**

```
Intempt JS SDK   →  40 / 100
Mixpanel JS SDK  →  85 / 100
                    ─────────
gap                 45 points
```

**The gap is not where the number suggests.** Split the rubric into the two
things it actually measures — _is the engineering sound_ versus _is this
shippable as a commercial product_ — and the 47 points land almost entirely on
one side:

| Cluster                        | Dimensions                                                                     | Weight | Intempt | Mixpanel | Gap |
| ------------------------------ | ------------------------------------------------------------------------------ | ------ | ------- | -------- | --- |
| **Architecture & engineering** | 2 Reliability, 10 Code health, 3 Performance                                   | 33%    | **~53** | 85       | −32 |
| **Commercial shippability**    | 1 Tests, 5 API/semver, 8 CI/CD, 6 Observability, 7 Privacy, 4 Security, 9 Docs | 67%    | **~33** | 85       | −52 |

Narrow it further to design-only (excluding footprint, which is a build-config
problem rather than a design one) and the **architecture reads ~70**: the
batching / queue / shared-lock core is a competent Mixpanel port, and the module
layout under `src/intemptJs/modules/**` is genuinely cleaner than Mixpanel's
2,623-line `mixpanel-core.js`.

What's absent is everything that turns working code into a product you can sell
to an enterprise buyer:

| Missing            | Evidence                                                 | Consequence                                         |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------- |
| Tests              | 0 unit tests vs Mixpanel's 22 suites / 8,644 LOC         | No safe change velocity; every refactor is a gamble |
| Publishing         | `"private": true`, `"version": "0.0.0"`                  | **Cannot be consumed as a package at all**          |
| Footprint          | `psl` ships 152 KB for one function; no code splitting   | Every page pays ~25 KB brotli for a table used once |
| CI breadth         | Node 21 (EOL) only, Chrome only, no lint/size/audit gate | Safari + iOS regressions ship undetected            |
| Credential hygiene | write key as client-side `Authorization: Basic`          | Fails an enterprise security review outright        |
| Persisted consent  | `optOut()` is an in-memory flag                          | Compliance defect, not a feature gap                |

**Why this matters for planning:** none of the above requires re-architecting.
It is additive — write tests, add an IndexedDB tier beside the localStorage one,
split the bundle, fix the `package.json`, add gates. That is why 40 → 91 is an
~8-week programme rather than a rewrite. The three items that _are_ code defects
(memory leak, duplicate sends, unpersisted opt-out) are each a small,
well-localised fix.

The corollary is the risk: because the foundation is sound, the temptation is to
keep adding features on top. Every feature added before the test tier exists
makes the test tier more expensive to build. Phase 2 should not be deferred.

---

## 0a. FINAL SCORE — re-scored 2026-08-12, after the programme

**The 40 in §0 is the _baseline_. This is the current number, measured on the merged
tree at PR #191 with every gate green.**

```
Intempt JS SDK   →  71 / 100     (baseline 40)
Mixpanel JS SDK  →  85 / 100
                    ─────────
gap                 14 points    (was 45)
```

**This supersedes every other figure in these docs.** `CHECKPOINT.md`'s header said
~78, its §0 said 62, and §3p estimated ~81-83 — all three were extrapolations, none
was a re-score. The number is lower than two of those guesses on purpose: it scores
the _whole_ SDK, including the periphery that has no tests, and it does not give credit
for work that is parked.

### Per-dimension, baseline → now

| #   | Dimension                         | Weight | Baseline | **Now** | Mixpanel | What moved it, and what is holding it back                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------- | ------ | -------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Correctness & test coverage       | 15%    | 22       | **72**  | 92       | +938 unit tests (from 0), 126 Cypress, mutation testing at 86.68% on the core, property tests over the delivery invariants, golden payload contracts, per-glob coverage gates. **Held back by:** the untested periphery in §1c, and no Safari/iOS tier at all.                                                                                                                                                                    |
| 2   | Reliability / delivery guarantees | 15%    | 58       | **82**  | 90       | IndexedDB tier with localStorage fallback, full jitter, circuit breaker, bounded queue with a reported drop count, per-event records off the shared lock, XHR fallback, and **four silent data-loss defects fixed**. **Held back by:** no `sendBeacon` (needs the credential off the header), no ingest idempotency, and events still carry no timestamp (D-1).                                                                   |
| 3   | Performance & footprint           | 12%    | 45       | **72**  | 85       | `psl` dropped: 225.86 → **94.58 kB** raw, 27.57 kB gzip, 23.89 kB brotli, and a size budget in CI that has ratcheted twice. **Held back by:** no code-splitting (parked), and no main-thread benchmark harness, so the init/per-track budgets are unmeasured.                                                                                                                                                                     |
| 4   | Security posture                  | 10%    | 45       | **58**  | 80       | SHA-pinned actions, a bundle secret scan, `npm audit` gating production deps, the Sonar gate un-commented, advisories 19 → 2 moderate / 0 high. **Held back by the one thing that matters most:** the `writeKey` is still a client-side `Authorization: Basic` header. **This dimension cannot exceed ~62 without ingest.**                                                                                                       |
| 5   | API surface & backward compat     | 10%    | 35       | **48**  | 90       | Real version (`6.0.0`), single-sourced from `package.json` at build time, exposed as `IntemptJs.VERSION`; publishable metadata. **Held back by packaging being parked:** no `main`/`module`/`exports`, no published `.d.ts`, no `CHANGELOG.md`, no changesets, and an IIFE that self-initialises on import.                                                                                                                       |
| 6   | Observability & diagnostics       | 8%     | 25       | **80**  | 75       | A levelled logger with a customer `onDiagnostic` sink replacing 55 raw `console.*` calls, real metrics (queue depth, flush latency, drop count, breaker state) surfaced as `intempt.getDiagnostics()`. **This is the one dimension where the SDK now beats Mixpanel.**                                                                                                                                                            |
| 7   | Privacy & compliance              | 8%     | 40       | **86**  | 88       | Persisted opt-out, consent at the eTLD+1 so it carries across subdomains, DNT and GPC honoured by default with an `ignore_dnt` escape for CMP users, optional PII scrubbing, an `api_host` override for data residency, and consent records that survive `optOut()` because an audit record is not tracking. Essentially at parity.                                                                                               |
| 8   | Build, release & CI/CD            | 10%    | 38       | **68**  | 88       | `ci.yml` with seven jobs — lint (blocking), prettier (blocking), typecheck+build, audit, unit on Node 22 and 24, e2e, mutation — plus size budget, secret scan, `npm ci`, SHA-pinned actions. **Held back by:** `release.yml` has never run, no changesets, no browser matrix, `build.yaml` still uses `npm install` and a branch trigger that matches no slash-named branch, and the deploy path is still the mutable `/v1` URL. |
| 9   | Docs & DX                         | 6%     | 45       | **62**  | 85       | `USAGE.md` rewritten, a TypeScript example, documented diagnostics, and a defect register a customer-facing team can actually read. **Held back by:** no generated API reference, no framework adapters, no migration guide.                                                                                                                                                                                                      |
| 10  | Code health & maintainability     | 6%     | 50       | **76**  | 78       | **Zero `any`** (was 61, then 99 after the lanes), `no-explicit-any` and `no-console` both promoted to **errors**, prettier enforced repo-wide, `autoTracker.module.ts` 526 → 400 lines split three ways. **Held back by:** 97 remaining lint warnings and the still-duplicated id triplet.                                                                                                                                        |

**Weighted:** `.15(72)+.15(82)+.12(72)+.10(58)+.10(48)+.08(80)+.08(86)+.10(68)+.06(62)+.06(76)` = **70.7 → 71**

### Where the remaining 14 points are

Nearly all of them are behind decisions already made, not behind unwritten code:

| Unblock                                                    | Dimension effect | Weighted gain |
| ---------------------------------------------------------- | ---------------- | ------------- |
| **npm packaging** (parked by the user)                     | 5: 48 → ~85      | **+3.7**      |
| **Credential off the client** (`BACKEND.md`, needs ingest) | 4: 58 → ~80      | **+2.2**      |
| **Test the periphery** (§1c below — no one else needed)    | 1: 72 → ~85      | **+2.0**      |
| **A real browser matrix** (needs a device cloud)           | 8: 68 → ~85      | **+1.7**      |
| Wire-format fixes D-1/D-3/D-15 (needs ingest)              | 2: 82 → ~90      | +1.2          |
| Code-splitting + a benchmark harness                       | 3: 72 → ~85      | +1.6          |

All six lands at **~81-83**. **85 — parity with Mixpanel — requires the two items that
need other people**, which is the same conclusion `FRONTEND.md` reached from the other
direction. Front-end-only, with packaging parked, the ceiling is ~81.

---

## 1c. The testing gap, audited file by file — 2026-08-12

**Why this section exists.** Dimension 1 scores 72, not 85, and the reason is not the
core: `shared/**` is at **85.27% mutation score**, which is genuinely strong. The reason
is that the _periphery_ has close to nothing. Two independent measurements agree on
which files, so this is evidence rather than impression:

- **unit line coverage** from `coverage/lcov.info`
- **mutation score** from the first full-scope run (`stryker.full.conf.json`), which
  asks the sharper question: would any test _notice_ if this line were wrong?

### Tier 1 — untested and it matters. Do these first.

| File                                                     | LOC | Unit lines | Mutation                          | Why it matters                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | --- | ---------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intemptJs/platformParser.ts`                            | 162 | **27.8%**  | **7.36%** (288 uncovered mutants) | **The worst risk in the SDK.** It derives device, browser, OS and geo attributes attached to **every event**. When it is wrong it is wrong _silently_ — no error, no dropped request, just every event mislabelled and dashboards that look fine. Nothing else on this list can corrupt data this quietly. |
| `intemptJs/component/HtmlEventData.component.ts`         | 52  | **0.0%**   | —                                 | Builds the payload for every auto-tracked click, change and submit: target text, form field capture, hierarchy. **It contains the `doNotCapture` / `type === 'password'` redaction** — the one privacy control on auto-tracked DOM data, and no test asserts it fires.                                     |
| `loaders/sdkLoader.ts`                                   | 85  | 74.1%      | **42.78%** (51 uncovered)         | How the SDK boots, finds its own script tag, and **replays calls the snippet stub queued before it loaded**. A bug here loses every pre-init event. Has 26 Cypress tests, which is why coverage is not terrible, but the mutation score says most of the branch logic is unasserted.                       |
| `intemptJs/modules/autoTracker/autoTracker.eventPool.ts` | 23  | **17.4%**  | **0.00%**                         | The fallback delivery path, used when the batcher cannot initialise. It has no retry, no persistence and no bound — so the code that runs in the _already-degraded_ case is the code with no tests.                                                                                                        |

### Tier 2 — untested, lower blast radius

| File                                   | LOC | Unit lines | Mutation                  | Note                                                                                                                   |
| -------------------------------------- | --- | ---------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `loaders/webEditorLoader.ts`           | 101 | **0.0%**   | **0.00%** (169 uncovered) | Visual-editor entry point. Internal tool, 2 Cypress tests at the loader boundary only. Not on the customer event path. |
| `main.ts`                              | 20  | **0.0%**   | **0.00%** (47 uncovered)  | The bootstrap and the guard decision. Fails loudly and immediately if broken.                                          |
| `.../shopifyTracker.module.ts`         | 38  | **2.6%**   | —                         | Only runs for Shopify customers, and only when `?shopify=1`.                                                           |
| `.../htmlTracker.module.ts`            | 12  | 66.7%      | —                         | Thin listener wiring; the payload work is `HtmlEventData` above.                                                       |
| `choices/choices.service.ts`           | 93  | 51.6%      | 36.84%                    | Personalisation fetch. Degrades to control on failure, which is the safe direction.                                    |
| `component/userAttribute.component.ts` | 40  | 77.5%      | —                         | Landing page and referrer derivation.                                                                                  |
| `models/*.model.ts` (3 files)          | ~9  | 0.0%       | —                         | `auth`, `HtmlEvent`, `choicesRequest` — near-trivial constructors.                                                     |

### What "test the periphery" concretely means

**One file, first, before anything else: `platformParser.ts`.** 288 uncovered mutants on
code that mislabels data silently. It is also cheap to test — it is nearly pure: user-agent
string in, attributes out. Table-driven tests over a corpus of real UA strings would kill
most of those mutants and are exactly the shape §3f-ii found to be high-yield (mutants in
code that _computes a value_, not in guard or reporting branches — see §3f-iii for why
that distinction matters).

Then `HtmlEventData.component.ts`, because the password/`doNotCapture` redaction is a
privacy control asserted by nothing.

**What NOT to chase:** `main.ts` and `webEditorLoader.ts` are 0% and will stay 0% for
now. That is a **recorded decision, not an oversight** — neither is on the customer event
path and both fail loudly. Writing 169 mutants' worth of tests for the visual editor
before `platformParser` has any would be optimising the wrong number.

**The gap no amount of unit testing closes:** there is still **no Safari, iOS Safari or
Android Chrome coverage at all**. Those are precisely the browsers where storage quotas,
ITP cookie capping and `pagehide` semantics diverge — i.e. where an analytics SDK actually
breaks. Cypress cannot drive them. That is `BACKLOG.md` §3 and it needs a device cloud,
which needs money.

---

## 0b. Scope caveat: these are not the same product

The rubric scores **engineering quality, not feature parity** — but the scope
difference is real and it changes how the footprint numbers should be read.

Mixpanel is _not_ track-only. Measured surface:

| Capability                                        | Mixpanel                                  | Intempt                                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Event tracking, batching, queueing                | ✅                                        | ✅                                                                                                                                       |
| User profiles / people                            | ✅ `mixpanel-people.js` (473 LOC)         | partial (`userAttribute.component.ts`)                                                                                                   |
| Groups                                            | ✅ `mixpanel-group.js` (174 LOC)          | ✅ `group.model.ts`                                                                                                                      |
| Autocapture (clicks, rage/dead click, shadow DOM) | ✅ ~1,700 LOC                             | ✅ `autoTracker/**`                                                                                                                      |
| Feature flags + variants                          | ✅ `flags/index.js` (708 LOC)             | ❌                                                                                                                                       |
| Audience targeting (json-logic)                   | ✅ `targeting/**` (separate 26 KB bundle) | partial (server-side)                                                                                                                    |
| Session replay (rrweb)                            | ✅ separate **333 KB** bundle, on demand  | ❌                                                                                                                                       |
| **DOM-level experience delivery**                 | ❌ **none**                               | ✅ `choices/**` — 7 mutation types (`attribute`/`delete`/`edit`/`insert`/`move`/`styles`/`clone`), stylesheet injection, element cloning |
| **Live visual web editor**                        | ❌ **none**                               | ✅ `WebEditorModificationHandler` + `webEditorLoader` + `openerOrigin`/`channel` postMessage handshake                                   |

So: **you have a real capability Mixpanel does not** — an A/B content-mutation
engine plus a visual editor, 1,644 LOC across `choices/**` + `webEditorLoader`.
Mixpanel has capability you don't (flags, replay). Neither is a superset, and the
101 KB → 258 KB comparison is not like-for-like as I first framed it.

### But the footprint gap is not caused by experiences — or by TypeScript

Measured, not assumed:

| Bundle                                 | Raw    | gzip  | brotli |
| -------------------------------------- | ------ | ----- | ------ |
| `intempt.min.js` (everything)          | 252 KB | 65 KB | 54 KB  |
| `mixpanel.min.js` (core)               | 101 KB | 33 KB | 29 KB  |
| `mixpanel-recorder.min.js` (on-demand) | 333 KB | —     | 61 KB  |

Two claims to correct:

1. **TypeScript costs you essentially nothing.** `tsconfig.json` targets
   **ES2020** and the emitted bundle contains **zero** downlevel helpers —
   `__awaiter`, `__generator`, `__spreadArray`, `__extends`, `__decorate` all
   grep to 0 occurrences in `dist/`. Types are erased at compile. TS is not a
   factor in your bundle size, and it is a net asset for a commercial SDK
   (`strict: true` is already on). Keep it.

2. **`psl` is the actual cause — ~152 KB of the 252 KB.** The `psl` module is
   152 KB raw, carrying **9,353 public-suffix rule literals**, and it _is_ in the
   shipped bundle (my first grep missed it because the identifier is minified;
   the data is unambiguous — `blogspot`, `ac.uk`, `co.jp`, `pvt.k12` all present
   in `dist/intempt.min.js`).

   It is imported in exactly **one place** for exactly **one function**:

   ```ts
   // src/shared/storageHandler.ts:3, used only at :48–63
   import psl from 'psl';

   export function handleDomain(domain: string) {
     /* cookie-domain derivation */
   }
   ```

**This reframes the finding in your favour.** Subtract `psl` and your own code is
roughly **100 KB — i.e. Mixpanel-core-sized — while also containing an
experience-delivery engine and a visual editor that Mixpanel has no equivalent
of.** Your code is _denser in capability per KB_ than the comparator.

The footprint problem is therefore two narrow, tractable things, not a
pervasive one:

- **One dependency in one function.** Drop `psl`, or lazy-load it only on the
  cookie-write path. Mixpanel derives eTLD+1 heuristically in `utils.js` with no
  data table. Expected saving: ~150 KB raw / ~25 KB brotli, for a change to a
  single ~15-line function.
- **No code splitting.** A customer who only calls `track()` still downloads
  `choices/**` + `webEditorLoader` (1,644 LOC) and the web editor's injected
  22 KB string blob. Mixpanel's model is the fix and the proof: core stays
  101 KB, the 333 KB recorder is a _separate bundle fetched on demand_. You have
  more justification for splitting than they do, because your optional surface
  is a larger share of your total.

Dimension 3 is scored **45** rather than 30 on the strength of the above. It is
not scored higher because the two defects are real and customer-visible today:
every page load pays 25 KB brotli for a table used once, and every track-only
customer pays for the experiences engine.

---

Measured facts used for scoring:

| Metric                                 | Intempt                                                          | Mixpanel                                                                            |
| -------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Source LOC (ts/js, excl. node_modules) | 11,991                                                           | 12,445                                                                              |
| Minified bundle                        | **252 KB** raw / 54 KB brotli (monolith)                         | **101 KB** raw / 29 KB brotli (core only)                                           |
| — of which one dependency              | **~152 KB is `psl`** (9,353 rule literals, used in 1 function)   | no equivalent data table                                                            |
| — own code, `psl` excluded             | **~100 KB** — _incl. experiences + visual editor_                | 101 KB                                                                              |
| Modular sub-bundles                    | 0 (single monolith)                                              | 5 (core / recorder / targeting / snippet / wrapper)                                 |
| TS downlevel-helper overhead           | **0** (`target: ES2020`, no `__awaiter`/`__spreadArray` emitted) | n/a (JS)                                                                            |
| Capability Mixpanel lacks              | DOM experience engine + visual web editor (1,644 LOC)            | —                                                                                   |
| Capability Intempt lacks               | —                                                                | feature flags (708 LOC), session replay (333 KB on-demand)                          |
| Unit tests                             | 0                                                                | 22 suites, 8,644 LOC (mocha + jsdom + sinon + fake-indexeddb)                       |
| Integration tests                      | 14 Cypress specs, Chrome only                                    | WDIO on 6 real browser/OS targets via SauceLabs                                     |
| CI test matrix                         | Node 21 only, 1 browser                                          | Node 22/24/26 × 6 browsers, JUnit/CTRF reporting                                    |
| Lint                                   | none (prettier config only, not enforced)                        | eslint gate in `npm test`                                                           |
| Public type surface                    | internal `.ts` only, no shipped `.d.ts`                          | `src/index.d.ts` shipped via `"types"`                                              |
| `package.json` publishable             | **`"private": true`, `"version": "0.0.0"`**                      | versioned, `main`/`module`/`types`, CHANGELOG                                       |
| Persistence backends                   | localStorage only                                                | localStorage **+ IndexedDB** (`src/storage/indexed-db.js`) with wrapper abstraction |
| Transports                             | `fetch` only                                                     | XHR + `sendBeacon` + img fallback, per-call `transport` option                      |
| Cross-tab safety                       | `sharedLock.ts` (88 LOC, port)                                   | `shared-lock.js` (154 LOC, hardened)                                                |
| `: any` occurrences in src             | 61                                                               | n/a (JS)                                                                            |
| GDPR/consent module                    | `consent.model.ts` (31 LOC)                                      | `gdpr-utils.js` (301 LOC)                                                           |

---

## 1. Score breakdown: 0–100

Weighted rubric behind the §0 headline. Each dimension scored 0–100, then
weighted. The **Cluster** column maps each row to the architecture /
shippability split in §0.

| #   | Dimension                             | Weight | Intempt | Mixpanel | Notes                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------- | ------ | ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Correctness & test coverage**       | 15%    | **22**  | 92       | Zero unit tests. 14 Cypress specs cover batcher/queue/lock/guard but no core API (`track`/`identify`/`alias`/`group`), no persistence, no consent. No coverage gate.                                                                                                                                                                                                                                          |
| 2   | **Reliability / delivery guarantees** | 15%    | **58**  | 90       | Batcher+queue+lock ported and functional: 429/5xx backoff, 413 halving, dedup by event id, unload flush. But: localStorage-only persistence (5 MB cap, sync main-thread), no IndexedDB tier, `fetch`-only transport, `unloading:true` path _returns without removing items_ → guaranteed duplicate sends on next load, relying solely on `sentEventIds` set that is itself capped/serialized to localStorage. |
| 3   | **Performance & footprint**           | 12%    | **45**  | 85       | See §0b — own code is ~100 KB, competitive with Mixpanel core _while_ carrying an experiences engine Mixpanel lacks; TypeScript adds zero. Two real defects: **`psl` ships ~152 KB for one function** (`storageHandler.ts:48`), and zero code-splitting means track-only customers download `choices/**` + web editor. No brotli measurement or size gate in CI.                                              |
| 4   | **Security posture**                  | 10%    | **45**  | 80       | `writeKey` is split and `btoa`-encoded into a **`Authorization: Basic`** header client-side (`autoTracker.module.ts:164-165`, header set at `:179`). Full write credential is readable in devtools and in the bundle's request log; it also _forces_ `fetch` and makes `sendBeacon` impossible. No SRI story, no CSP guidance, no dependency audit in CI, Sonar quality gate is commented out.                |
| 5   | **API surface & backward compat**     | 10%    | **35**  | 90       | No semver — `version: 0.0.0`, `private: true`, no CHANGELOG, no deprecation policy. Version is a **hardcoded string literal** (`console.log('version:', 'v6.0')` in `main.ts:48`). No published `.d.ts`. Global-side-effect init in `main.ts` IIFE with no `init()` contract.                                                                                                                                 |
| 6   | **Observability & diagnostics**       | 8%     | **25**  | 75       | 54 raw `console.*` calls gated only on `EnvConfig.isProduction()`. `errorReporter` hook exists in the batcher but nothing wires it to a sink. No internal metrics (queue depth, flush latency, drop count), no debug mode, no self-telemetry.                                                                                                                                                                 |
| 7   | **Privacy & compliance**              | 8%     | **40**  | 88       | `optIn`/`optOut` are in-memory only (`this._autoTracker.doNotTrack`) — **not persisted**, so opt-out resets on reload. No cookie/localStorage opt-out persistence, no DNT/GPC honoring, no `ignore_dnt` config, no PII masking/scrubbing, no data-residency switch. Mixpanel's `gdpr-utils.js` is the reference.                                                                                              |
| 8   | **Build, release & CI/CD**            | 10%    | **38**  | 88       | Build works (vite, 3 modes). But CI: no lint, no unit tests, no browser matrix, no size budget, no provenance/attestation, no npm publish, no changelog automation, unpinned action SHAs, `npm install` not `npm ci` (non-reproducible). Deploy is a raw S3 copy with a `/v1` path that has already caused an incident (revert `3dc3a54`).                                                                    |
| 9   | **Docs & DX**                         | 6%     | **45**  | 85       | `README.md` + `USAGE.md` exist; no generated API reference, no migration guide, no examples dir, no framework adapters (React/Next/Vue), no TS quickstart.                                                                                                                                                                                                                                                    |
| 10  | **Code health & maintainability**     | 6%     | **50**  | 78       | Structure is genuinely good (clear module boundaries, DI-ish config threading). Dragged down by 61 `: any`, no lint gate, `console` noise, duplicated `getProfileId/getSessionId/getPageId` triplet in every public method, 452-LOC `autoTracker.module.ts` doing init + transport + lifecycle.                                                                                                               |

### Scores

```
Intempt JS SDK   →  40 / 100
Mixpanel JS SDK  →  85 / 100
```

Intempt weighted: `.15(22)+.15(58)+.12(45)+.10(45)+.10(35)+.08(25)+.08(40)+.10(38)+.06(45)+.06(50)` = **39.8 → 40**

**Verdict:** the _architecture_ is at roughly 70 — the batching/queue/lock core is a competent Mixpanel port and the module layout is cleaner than Mixpanel's. What's missing is everything that makes a library _commercially shippable_: tests, semver/publishing, persistence tiering, transport fallbacks, persisted consent, credential hygiene, and a bundle budget. That's the 40→91 gap, and almost all of it is additive work rather than a rewrite. Note the scope caveat in §0b: the footprint deficit is one dependency plus a missing build split, not a design flaw — and TypeScript costs nothing.

### Top 8 blockers (ordered by score-per-effort)

1. **Zero unit tests** (−10.4 weighted pts) — biggest single lever.
2. **`writeKey` as client-side Basic auth** — security + blocks `sendBeacon`.
3. **`private: true` / `version: 0.0.0`** — cannot be consumed as a package at all.
4. **`psl` = ~152 KB of a 252 KB bundle** — one dependency, one function, one fix.
5. **`optOut` not persisted** — a compliance defect, not a feature gap.
6. **`unloading:true` never dequeues** — duplicate-event bug under real traffic.
7. **localStorage-only queue** — 5 MB cap, sync writes, lost on quota error.
8. **CI has no lint / no matrix / no size gate / `npm install`**.

---

## 2. Deep plan to 90+

Five phases. Each phase lists the concrete change, the file, and the projected score delta. Total projected: **38 → 91**.

### Phase 1 — Make it a package (Week 1) · +7 pts

Fixes dimension 5 (35→85) and part of 8.

1. **`package.json`**: drop `"private": true`, set real `version`, add
   `"main"`, `"module"`, `"types"`, `"exports"`, `"sideEffects": false`,
   `"files"`, `"publishConfig"`, `"engines"`, `repository`/`license`/`homepage`.
2. **Single source of version.** Delete the `'v6.0'` literal in `src/main.ts:48`.
   Inject at build time via vite `define`:
   ```ts
   // vite.config.ts
   define: {
     __SDK_VERSION__: JSON.stringify(pkg.version);
   }
   ```
   Export it as `Intempt.VERSION` and stamp it on every outbound payload as
   `$lib_version` — Mixpanel does this (`Config.LIB_VERSION`) and it is how you
   correlate a server-side anomaly to a client build. Without it you cannot do
   incident forensics.
3. **Ship `.d.ts`.** Hand-author `src/index.d.ts` as the _public_ contract
   (mirror `mixpanel-js/src/index.d.ts`) rather than emitting from internals —
   this decouples refactors from consumer breakage.
4. **`CHANGELOG.md`** + adopt semver formally. Automate with
   `changesets` (recommended over semantic-release here because your release is
   an S3 artifact _and_ an npm package, and changesets lets you gate both).
5. **Explicit init contract.** `main.ts` currently self-initializes in a
   top-level IIFE. Keep that for the CDN/snippet build, but the module build
   must export a pure `createIntempt(config)` with **no** import-time side
   effects — otherwise `sideEffects: false` is a lie and bundlers will
   mis-optimize.

**Inherit from Mixpanel:** `src/index.d.ts` structure; the loader split under
`src/loaders/` (`loader-module.js` vs `loader-globals.js` vs
`mixpanel-jslib-snippet.js`) — one core, several thin entrypoints. You already
have `src/loaders/`; extend it to emit distinct bundles rather than one file.

### Phase 2 — Test foundation (Weeks 1–3) · +12 pts

Fixes dimension 1 (22→88). This is the largest single gain.

Adopt Mixpanel's exact two-tier split, because it maps to what each tier can
actually catch:

- **Tier 1 — unit, jsdom, fast (`vitest`).** Mixpanel uses mocha+babel+jsdom;
  you're already on vite, so **vitest** is the equivalent with zero new
  toolchain. Target ≥85% line / ≥75% branch on `src/shared/**`,
  `src/guard/**`, `src/intemptJs/models/**`, `src/intemptJs/guards/**`.
- **Tier 2 — real-browser integration (WDIO).** Cypress cannot give you Safari
  or iOS, and those are exactly where `localStorage` quota, ITP cookie capping,
  and `pagehide` semantics differ. Keep your 14 Cypress specs as a fast local
  smoke tier; add WDIO for the release gate.

Port these Mixpanel unit suites directly — they are the highest-value ones and
your code is already a port of what they test:

| Mixpanel suite                  | LOC   | Port to                                            |
| ------------------------------- | ----- | -------------------------------------------------- |
| `tests/unit/request-batcher.js` | large | `src/shared/queue/requestBatcher.ts`               |
| `tests/unit/request-queue.js`   | large | `src/shared/queue/requestQueue.ts`                 |
| `tests/unit/shared-lock.js`     | —     | `src/shared/storage/sharedLock.ts`                 |
| `tests/unit/storage.js`         | 87    | `src/shared/storageHandler.ts` + `queueStorage.ts` |
| `tests/unit/indexed-db.js`      | —     | new IndexedDB tier (Phase 3)                       |
| `tests/unit/gdpr-utils.js`      | —     | new consent module (Phase 4)                       |
| `tests/unit/utils.js`           | 535   | `src/shared/shared.utils.ts`                       |

Copy their `fake-indexeddb` + `jsdom-global` + `sinon` fake-timer setup
(`tests/unit/jsdom-setup.js`) verbatim — deterministic timer control is what
makes batcher/backoff tests non-flaky, and it is the single hardest thing to
get right from scratch.

Add three test classes Mixpanel does **not** have, which you need for the
throughput target:

- **Property/fuzz tests** on the queue: random enqueue/flush/failure
  interleavings must never lose or duplicate an event id.
- **Contract tests**: golden-file snapshots of every outbound payload shape, so
  a refactor cannot silently change the wire format your ingest depends on.
- **Load tests** (see §4).

### Phase 3 — Reliability & performance core (Weeks 3–6) · +14 pts

Fixes dimensions 2 (58→90) and 3 (30→85).

1. **IndexedDB persistence tier.** Port `src/storage/indexed-db.js` (132 LOC)
   and `src/storage/wrapper.js`. This is the _single most important_ inheritance
   for your throughput goal: localStorage is synchronous and blocks the main
   thread on every queue write, and caps at ~5 MB shared with the host page. At
   sustained high event rates localStorage is the bottleneck and the failure
   mode is silent quota loss. Mixpanel's `wrapper.js` gives you the
   IndexedDB-with-localStorage-fallback abstraction — take the pattern whole,
   including its `init()` promise-caching so concurrent callers don't race
   `open()`.
2. **Fix the unload dequeue bug.** `requestBatcher.ts:~262`: on
   `unloading: true` the handler returns before `removeItemsFromQueue`, so a
   successfully-delivered unload batch is re-sent next load. Mixpanel handles
   this by marking items in-flight with an expiry rather than skipping removal.
   Port `request-queue.js`'s in-flight/`orphaned` handling.
3. **Transport fallback chain.** Currently `fetch`-only. Add
   `sendBeacon` → `fetch(keepalive)` → XHR, selected per call, with a
   `transport` option on `track` (Mixpanel `mixpanel-core.js:650–730`).
   `sendBeacon` is the only transport that reliably survives tab close on
   Safari — **but it cannot set headers**, which is precisely why the Basic-auth
   design in Phase 4 must be fixed first. These two items are coupled.
4. **Bundle budget.** Get core under **60 KB min / 20 KB brotli**:
   - **Drop `psl`.** Measured: 152 KB raw, 9,353 rule literals, ~60% of your
     bundle — confirmed present in `dist/` and imported in exactly one place
     (`storageHandler.ts:3`) for exactly one function (`handleDomain`, :48–63). For cookie-domain
     derivation you need only the eTLD+1 heuristic; Mixpanel does this in a few
     lines in `utils.js` with no data table. If you truly need full PSL
     correctness, load it lazily and only on the cookie-write path.
   - Split into `intempt.core.js` / `intempt.autotrack.js` /
     `intempt.choices.js` / `intempt.webeditor.js`, async-loaded. Your
     `choices` module (ModificationHandler, 459 LOC + config 289 LOC) and
     `webEditorLoader` are pure dead weight for a customer who only calls
     `track`. Mixpanel's `dist/` proves the model: 104 KB core, recorder and
     targeting as separate 341 KB / 26 KB bundles fetched on demand.
   - Enforce with `size-limit` in CI (Phase 5) — a budget that isn't a gate
     regresses within two sprints.
5. **Sampling & load shedding.** Add `sample_rate` and a queue high-water mark
   with an explicit drop policy (drop-oldest for autotracked/low-value events,
   never for `identify`/`alias`). Emit a `$events_dropped` counter. Without
   this, a traffic spike turns into unbounded client memory growth.

### Phase 4 — Security, privacy, observability (Weeks 5–7) · +11 pts

Fixes dimensions 4 (45→85), 6 (25→80), 7 (40→90).

1. **Stop sending the write key as Basic auth.** Two options, pick per your
   ingest capability:
   - _Preferred:_ a public, ingest-only **project token** in the URL path or
     body (Mixpanel's model — the token is public by design and carries no
     write authority beyond event ingest). This unblocks `sendBeacon`, removes
     a credential from the client, and lets you rate-limit per token server-side.
   - _If the write key must stay:_ move it to a query param or body field so no
     custom header is required, and scope it server-side to ingest-only.
     Either way, document that the client credential is public and must not be
     reusable for reads or admin.
2. **Port `gdpr-utils.js` (301 LOC).** You need persisted opt-out — currently
   `optOut()` sets an in-memory flag that is lost on reload, which is a
   compliance defect. Take Mixpanel's cookie+localStorage opt-out persistence,
   `has_opted_out_tracking()`, DNT respect with `ignore_dnt` escape hatch, and
   `clear_opt_in_out_tracking()`. Add on top: **GPC** (`navigator.globalPrivacyControl`),
   a PII scrubber hook (`before_send`), and a configurable data-residency host.
3. **Observability.** Replace the 54 bare `console.*` with a leveled logger
   (`silent|error|warn|info|debug`) behind a `debug` config flag. Wire the
   batcher's existing `errorReporter` to a real sink with sampling and a
   circuit breaker (never let SDK error reporting amplify an outage). Expose
   `intempt.diagnostics()` returning queue depth, last flush latency, retry
   state, drop counts — this is what turns a customer support ticket from days
   into minutes.
4. **Supply chain.** `npm audit --audit-level=high` gate, Dependabot,
   pinned action SHAs, `npm ci` everywhere, SRI hash published per release,
   npm provenance attestation, and **un-comment the Sonar quality gate** in
   `.github/workflows/analyze.yaml` — it currently runs and reports nothing
   blocking.
5. **Kill `: any`.** 61 occurrences, concentrated in the batcher/queue
   boundary. Enable `strict`, `noImplicitAny`, `exactOptionalPropertyTypes`.
   Type the payload shapes — they are your wire contract.

### Phase 5 — CI/CD, docs, release engineering (Weeks 6–8) · +9 pts

Fixes dimensions 8 (38→92), 9 (45→85), 10 (50→80). Harness delivered in §3.

- Lint gate (eslint + prettier --check), typecheck gate, unit + coverage gate,
  browser matrix, size-limit gate, `npm audit` gate.
- Changesets-driven release: version bump → CHANGELOG → npm publish with
  provenance → S3 upload to **immutable versioned paths** plus a mutable
  `latest` alias. The `/v1` incident (`af1a16b` → reverted in `3dc3a54`) is a
  symptom of mutable deploy paths; versioned-immutable + alias makes rollback a
  pointer flip instead of a rebuild.
- Docs: generated API reference (Mixpanel's `doc/build-docs.js` + `dox` from
  JSDoc — your methods are already JSDoc'd, so this is nearly free), an
  `examples/` dir, and React/Next adapters.

### Projected trajectory

| After    | Score  |
| -------- | ------ |
| Baseline | 40     |
| Phase 1  | 45     |
| Phase 2  | 57     |
| Phase 3  | 71     |
| Phase 4  | 82     |
| Phase 5  | **91** |

---

## 3. What to inherit from Mixpanel — file-by-file

Mixpanel is **Apache-2.0**, so direct code reuse is permitted with attribution
(retain the license header and NOTICE the derivation). Confirm with your counsel
before shipping copied files.

| Take                                     | From                                                                                  | Why                                                                   | Effort |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| **IndexedDB storage + wrapper**          | `src/storage/indexed-db.js`, `src/storage/wrapper.js`, `src/storage/local-storage.js` | Removes the localStorage bottleneck; prerequisite for high throughput | M      |
| **In-flight / orphaned item handling**   | `src/request-queue.js`                                                                | Fixes your unload duplicate-send bug                                  | M      |
| **Transport selection & `sendBeacon`**   | `src/mixpanel-core.js:640–740`                                                        | Unload reliability on Safari                                          | S      |
| **GDPR/consent utilities**               | `src/gdpr-utils.js` (301 LOC)                                                         | Persisted opt-out; you have 31 LOC where you need 300                 | M      |
| **Unit test harness & fake-timer setup** | `tests/unit/jsdom-setup.js`, `tests/unit/test-utils/`                                 | Deterministic async tests; hardest part to get right                  | S      |
| **Batcher/queue/lock test suites**       | `tests/unit/{request-batcher,request-queue,shared-lock,storage}.js`                   | Your code is already a port of the SUT — tests port nearly 1:1        | M      |
| **WDIO browser matrix config**           | `tests/browser/wdio.{shared,local,sauce}.mjs`, `test-ports.js`, `testServer.js`       | Real Safari/iOS/Android coverage                                      | M      |
| **Multi-entrypoint loader pattern**      | `src/loaders/*` + `rollup.config.mjs`                                                 | Enables code-splitting → bundle budget                                | L      |
| **eTLD+1 without a data table**          | `src/utils.js` cookie-domain logic                                                    | Lets you delete `psl`                                                 | S      |
| **JSDoc → API reference**                | `doc/build-docs.js`                                                                   | Free docs from JSDoc you already wrote                                | S      |
| **Shared-lock hardening**                | `src/shared-lock.js` (154 vs your 88 LOC)                                             | Their extra 66 LOC is retry/timeout/clock-skew handling               | S      |
| **Promise polyfill pattern**             | `src/promise-polyfill.js`                                                             | Only if you must support legacy; otherwise skip                       | —      |

**Do not inherit:** their persistence key/cookie format (locks you to their
schema), the rrweb recorder dependency (341 KB — build or buy separately), and
their mocha/babel-6 toolchain (you're on vite; vitest is strictly better).

---

---

## 3b. Proposed CI/CD test harness (adapted from Mixpanel)

> Nothing below is applied. These are the files to create when you decide to
> proceed. Paths are given as comments at the top of each block.

### Mixpanel's harness, and what to take from it

Mixpanel runs **three** workflows, and the split is the design worth copying:

| Mixpanel workflow                | Trigger                    | Matrix                        | Gate character        |
| -------------------------------- | -------------------------- | ----------------------------- | --------------------- |
| `unit-tests.yml`                 | every push + PR            | Node 22/24/26                 | fast, blocking        |
| `integration-tests.yml`          | push to master + `**/*-rc` | 6 real browsers via SauceLabs | slow, release gate    |
| `openfeature-provider-tests.yml` | master                     | Node 22/24/26                 | sub-package isolation |

Their test commands:

```
test          = lint && unit-test
test:ci       = lint && unit-test:ci        # mocha --reporter json → results.json
unit-test     = BABEL_ENV=test mocha --require babel-core/register tests/unit/*.js
integration-test:local = wdio run tests/browser/wdio.local.mjs
integration-test:sauce = wdio run tests/browser/wdio.sauce.mjs
```

Three mechanics to inherit specifically:

1. **JSON reporter → `dorny/test-reporter`.** They emit mocha-json to
   `tests/*/results/*.json` and publish it as a GitHub _check run_ with
   `list-tests: failed`. Failures land in the PR UI instead of buried in log
   scrollback. Note they set `fail-on-error: false` on the reporter — the
   _test step_ fails the job, the reporter never does.
2. **`specFileRetries: 3` in `wdio.shared.mjs`.** Real-device runs are flaky for
   infrastructural reasons; retrying the spec file (not the assertion) absorbs
   tunnel hiccups without hiding real failures.
3. **Test server spawned by the runner's `onPrepare`.** `testServer.js` serves
   the _built_ artifact over two ports (parent + child, for cross-origin and
   iframe cases) and is torn down in `onComplete`. No separate CI step, no
   `wait-on` race in the workflow file.

### What your current CI is missing

Present today (`build.yaml`, `analyze.yaml`, `autopr.yaml`):

- ✅ build on every branch, Cypress run, S3 deploy on `main`, Sonar scan, auto-PR staging→main.

Absent:

- ❌ lint gate (no eslint at all; prettier config exists but is never checked)
- ❌ typecheck as its own gate (only implicit via `tsc &&` in build)
- ❌ any unit tests
- ❌ Node version matrix (Node 21 only — and 21 is EOL)
- ❌ browser matrix (Chrome only, via Cypress)
- ❌ coverage measurement or threshold
- ❌ bundle size budget
- ❌ `npm audit` / Dependabot
- ❌ `npm ci` (uses `npm install` → non-reproducible builds)
- ❌ pinned action SHAs (`actions/checkout@v2` in `autopr.yaml`)
- ❌ concurrency cancellation
- ❌ npm publish, provenance, changelog
- ❌ post-deploy verification of the live bundle
- ❌ Sonar quality gate is present but **commented out**, so it reports and blocks nothing

### File 1 — `.github/workflows/ci.yml` (fast gate)

```yaml
name: CI

# Fast gate: runs on every push and PR. Must stay under ~5 min.
# Modeled on mixpanel-js/.github/workflows/unit-tests.yml, extended with
# lint / typecheck / size-budget / audit gates that Mixpanel keeps out-of-band.

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main, staging]

# Cancel superseded runs on the same ref — at PR volume this is most of the
# runner bill.
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  static:
    name: Lint & typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22.x
          cache: npm
      # npm ci, not npm install — install mutates the lockfile and makes the
      # build non-reproducible. The current build.yaml uses npm install.
      - run: npm ci
      - name: Prettier check
        run: npx prettier --check "src/**/*.ts" "__tests__/**/*.ts"
      - name: ESLint
        run: npm run lint
      - name: Typecheck (strict)
        run: npx tsc --noEmit

  unit:
    name: Unit tests (node ${{ matrix.node-version }})
    runs-on: ubuntu-latest
    permissions:
      contents: read
      checks: write # for dorny/test-reporter to post results
    strategy:
      fail-fast: false
      matrix:
        node-version: [22.x, 24.x, 26.x]
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm
      - run: npm ci
      - name: Unit tests + coverage
        run: npm run test:unit:ci

      - name: Test report
        uses: dorny/test-reporter@7b7927aa7da8b82e81e755810cb51f39941a2cc7 # v2
        if: success() || failure()
        with:
          name: Unit Tests (node ${{ matrix.node-version }})
          reporter: mocha-json
          path: '__tests__/results/*.json'
          list-tests: failed
          fail-on-error: 'false'

      # Coverage thresholds are enforced by vitest.config.ts, so a drop fails
      # the job above. This step only publishes the artifact for review.
      - name: Upload coverage
        if: matrix.node-version == '22.x' && (success() || failure())
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: coverage
          path: coverage/
          retention-days: 14

  smoke:
    name: Cypress smoke (chrome)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22.x
          cache: npm
      - run: npm ci
      # The existing 14 Cypress specs, kept as the fast smoke tier. Real
      # cross-browser coverage lives in browser-tests.yml.
      - run: npm run test:e2e

  build:
    name: Build & size budget
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22.x
          cache: npm
      - run: npm ci
      - run: npm run build

      # A bundle budget that is not a gate regresses within two sprints.
      # Thresholds live in .size-limit.json.
      - name: Size budget
        run: npx size-limit

      - name: Report sizes
        if: always()
        run: npx size-limit --json | tee size.json

      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: dist
          path: |
            dist/
            size.json
          retention-days: 14

  audit:
    name: Dependency audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22.x
          cache: npm
      - run: npm ci
      - run: npm audit --audit-level=high
```

### File 2 — `.github/workflows/browser-tests.yml` (release gate)

```yaml
name: Browser Tests

# Real-browser release gate. Direct adaptation of
# mixpanel-js/.github/workflows/integration-tests.yml.
#
# Why this exists alongside the Cypress smoke tier: Cypress cannot drive Safari,
# iOS Safari, or Android Chrome. Those are precisely the browsers where
# localStorage quota behavior, ITP cookie capping, and pagehide/unload semantics
# diverge — i.e. where an analytics SDK actually breaks. A green Chrome-only
# suite is not evidence of cross-browser correctness.
#
# Requires repo secrets: SAUCE_USERNAME, SAUCE_ACCESS_KEY.

on:
  push:
    branches: [main, staging, '**/*-rc']
  pull_request:
    branches: [main, staging]
  # Sauce minutes are metered; allow manual runs on feature branches.
  workflow_dispatch:

concurrency:
  group: browser-${{ github.ref }}
  cancel-in-progress: true

jobs:
  integration:
    name: ${{ matrix.browser }}
    runs-on: ubuntu-latest

    permissions:
      contents: read
      checks: write

    strategy:
      fail-fast: false
      max-parallel: 4 # keep within the Sauce concurrency allowance
      matrix:
        browser:
          - chrome-latest
          - edge-latest
          - safari-latest
          - firefox-latest
          - ios-safari-sim
          - android-chrome-sim

    env:
      SAUCE_USERNAME: ${{ secrets.SAUCE_USERNAME }}
      SAUCE_ACCESS_KEY: ${{ secrets.SAUCE_ACCESS_KEY }}
      # Tunnel name must be unique per matrix leg or the legs collide.
      SAUCE_TUNNEL_NAME: ci-intempt-js-${{ matrix.browser }}-${{ github.run_id }}

    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22.x
          cache: npm

      - run: npm ci

      # Browser specs load the real built artifact, not source — this is what
      # catches minifier-induced breakage (e.g. reserved-word mangling, which
      # __tests__/bundleReservedWords.cy.ts already guards against in-source).
      - name: Build
        run: npm run build:staging

      - name: Sauce test
        # Android emulators cannot reach `localhost` on the runner, so the
        # runner's LAN IP is passed through for the tunnel to target.
        run: |
          BROWSER=${{ matrix.browser }} \
          ROOT_DIR=$(pwd) \
          SAUCE_HOST=$(hostname -I | awk '{print $1; exit}') \
          npm run test:browser:sauce

      - name: Test report
        uses: dorny/test-reporter@7b7927aa7da8b82e81e755810cb51f39941a2cc7 # v2
        if: success() || failure()
        with:
          name: Browser Tests (${{ matrix.browser }})
          reporter: mocha-json
          path: 'tests/browser/results/*.json'
          list-tests: failed
          fail-on-error: 'false'

      - name: Upload logs
        if: failure()
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
        with:
          name: wdio-logs-${{ matrix.browser }}
          path: |
            tests/browser/results/
            logs/
          retention-days: 7
```

### File 3 — `.github/workflows/release.yml` (immutable release + rollback)

This replaces the raw `aws s3 cp` step in `build.yaml`. **The `/v1` incident
(`af1a16b`, reverted in `3dc3a54`) is the failure mode of a mutable deploy
path:** there is no prior artifact to point back at, so recovery means rebuild,
re-upload, then wait out browser caches. Immutable-versioned + short-TTL alias
makes rollback a pointer flip.

S3 layout:

```
/v1/<version>/intempt.min.js   immutable, cache 1y
/v1/intempt.min.js             alias, cache 5m   <- what customers embed
/v1/latest.json                {"version": "...", "sri": "..."}
```

````yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      rollback_to:
        description: 'Version to re-point the alias at (blank = normal release)'
        required: false
        type: string

concurrency:
  group: release
  cancel-in-progress: false # never cancel a release mid-upload

permissions:
  contents: read

jobs:
  # ---------------------------------------------------------------------------
  # Rollback path: no build, no publish. Re-point the alias at an existing
  # immutable version. Completes in under a minute.
  # ---------------------------------------------------------------------------
  rollback:
    if: github.event_name == 'workflow_dispatch' && inputs.rollback_to != ''
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    env:
      AWS_REGION: us-east-1
      AWS_S3_BUCKET_NAME: 253548970387.cdn.intempt.com
    steps:
      - uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502 # v4.0.2
        with:
          role-to-assume: arn:aws:iam::253548970387:role/GithubActionsIntemptJSDeployer
          role-session-name: IntemptJSRollback
          aws-region: ${{ env.AWS_REGION }}

      - name: Verify target version exists
        run: |
          aws s3api head-object \
            --bucket "${{ env.AWS_S3_BUCKET_NAME }}" \
            --key "v1/${{ inputs.rollback_to }}/intempt.min.js"

      - name: Re-point alias
        run: |
          aws s3 cp \
            "s3://${{ env.AWS_S3_BUCKET_NAME }}/v1/${{ inputs.rollback_to }}/intempt.min.js" \
            "s3://${{ env.AWS_S3_BUCKET_NAME }}/v1/intempt.min.js" \
            --cache-control "public, max-age=300, must-revalidate" \
            --content-type "application/javascript"
          echo '{"version":"${{ inputs.rollback_to }}"}' > latest.json
          aws s3 cp latest.json \
            "s3://${{ env.AWS_S3_BUCKET_NAME }}/v1/latest.json" \
            --cache-control "public, max-age=60" \
            --content-type "application/json"

      - name: Invalidate CDN alias
        run: |
          aws cloudfront create-invalidation \
            --distribution-id "${{ vars.CLOUDFRONT_DISTRIBUTION_ID }}" \
            --paths "/v1/intempt.min.js" "/v1/latest.json"

  # ---------------------------------------------------------------------------
  # Normal release path.
  # ---------------------------------------------------------------------------
  release:
    if: github.event_name == 'push' || inputs.rollback_to == ''
    runs-on: ubuntu-latest
    permissions:
      id-token: write # AWS OIDC + npm provenance
      contents: write # changesets version commit + tag
      pull-requests: write
    env:
      AWS_REGION: us-east-1
      AWS_S3_BUCKET_NAME: 253548970387.cdn.intempt.com
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          fetch-depth: 0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 22.x
          cache: npm
          registry-url: https://registry.npmjs.org

      - run: npm ci

      # Re-run the full gate here rather than trusting the CI run on the merge
      # commit. A release must not be able to ship on a stale green check.
      - name: Gate
        run: |
          npm run lint
          npx tsc --noEmit
          npm run test:unit:ci

      # Consumes .changeset/*.md, bumps version, writes CHANGELOG.md, and either
      # opens a "Version Packages" PR or (if one was just merged) publishes.
      - name: Version or publish
        id: changesets
        uses: changesets/action@c8bada60c408975afd1a20b3db81d6eee6789308 # v1.4.9
        with:
          publish: npm run release:publish
          commit: 'chore: release'
          title: 'chore: release'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_CONFIG_PROVENANCE: 'true'
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # Everything below runs only when a version was actually published.
      - name: Read version
        if: steps.changesets.outputs.published == 'true'
        id: v
        run: echo "version=$(node -p "require('./package.json').version")" >> "$GITHUB_OUTPUT"

      - name: Build production bundle
        if: steps.changesets.outputs.published == 'true'
        run: npm run build

      - name: Size budget
        if: steps.changesets.outputs.published == 'true'
        run: npx size-limit

      - name: Compute SRI hash
        if: steps.changesets.outputs.published == 'true'
        id: sri
        run: |
          HASH="sha384-$(openssl dgst -sha384 -binary dist/intempt.min.js | openssl base64 -A)"
          echo "hash=$HASH" >> "$GITHUB_OUTPUT"

      - uses: aws-actions/configure-aws-credentials@e3dd6a429d7300a6a4c196c26e071d42e0343502 # v4.0.2
        if: steps.changesets.outputs.published == 'true'
        with:
          role-to-assume: arn:aws:iam::253548970387:role/GithubActionsIntemptJSDeployer
          role-session-name: IntemptJSDeployer
          aws-region: ${{ env.AWS_REGION }}

      - name: Upload immutable version
        if: steps.changesets.outputs.published == 'true'
        run: |
          aws s3 cp dist/intempt.min.js \
            "s3://${{ env.AWS_S3_BUCKET_NAME }}/v1/${{ steps.v.outputs.version }}/intempt.min.js" \
            --cache-control "public, max-age=31536000, immutable" \
            --content-type "application/javascript"

      - name: Flip alias
        if: steps.changesets.outputs.published == 'true'
        run: |
          aws s3 cp dist/intempt.min.js \
            "s3://${{ env.AWS_S3_BUCKET_NAME }}/v1/intempt.min.js" \
            --cache-control "public, max-age=300, must-revalidate" \
            --content-type "application/javascript"
          echo '{"version":"${{ steps.v.outputs.version }}","sri":"${{ steps.sri.outputs.hash }}"}' > latest.json
          aws s3 cp latest.json \
            "s3://${{ env.AWS_S3_BUCKET_NAME }}/v1/latest.json" \
            --cache-control "public, max-age=60" \
            --content-type "application/json"

      - name: Invalidate CDN alias
        if: steps.changesets.outputs.published == 'true'
        run: |
          aws cloudfront create-invalidation \
            --distribution-id "${{ vars.CLOUDFRONT_DISTRIBUTION_ID }}" \
            --paths "/v1/intempt.min.js" "/v1/latest.json"

      # Post-deploy verification: fetch the live alias and assert the version
      # string is present in the served bytes. This is the check that would have
      # caught the /v1 path incident at deploy time rather than via a customer.
      - name: Verify live bundle
        if: steps.changesets.outputs.published == 'true'
        run: |
          set -e
          for i in 1 2 3 4 5 6; do
            if curl -fsSL "https://cdn.intempt.com/v1/intempt.min.js" -o live.js; then
              if grep -q "${{ steps.v.outputs.version }}" live.js; then
                echo "Live bundle serves ${{ steps.v.outputs.version }}"; exit 0
              fi
            fi
            sleep 20
          done
          echo "::error::Live bundle did not serve ${{ steps.v.outputs.version }} within ~2 min"
          exit 1

      - name: Release summary
        if: steps.changesets.outputs.published == 'true'
        run: |
          {
            echo "### intempt-js ${{ steps.v.outputs.version }}"
            echo '```html'
            echo '<script src="https://cdn.intempt.com/v1/intempt.min.js"'
            echo '        integrity="${{ steps.sri.outputs.hash }}"'
            echo '        crossorigin="anonymous"></script>'
            echo '```'
            echo "Pinned: \`https://cdn.intempt.com/v1/${{ steps.v.outputs.version }}/intempt.min.js\`"
            echo "Rollback: re-run this workflow with \`rollback_to\` set to a prior version."
          } >> "$GITHUB_STEP_SUMMARY"
````

### File 4 — `vitest.config.ts` (unit tier + coverage gate)

Vitest rather than Mixpanel's mocha+babel-6: you are already on vite, so this
adds no toolchain. The coverage thresholds are what make the gate real.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    // Non-opaque origin required for localStorage — same reason Mixpanel sets
    // url: 'http://localhost' in tests/unit/jsdom-setup.js
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    include: ['__tests__/unit/**/*.spec.ts'],
    setupFiles: ['__tests__/unit/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: [
        'src/shared/**',
        'src/guard/**',
        'src/intemptJs/models/**',
        'src/intemptJs/guards/**',
      ],
      // Ratchet these upward; never downward.
      thresholds: { lines: 85, branches: 75, functions: 85, statements: 85 },
    },
  },
});
```

`__tests__/unit/setup.ts` — the equivalent of Mixpanel's `jsdom-setup.js`, whose
key job is deterministic fake timers (that is what makes batcher/backoff tests
non-flaky, and it is the hardest thing to get right from scratch):

```ts
import { beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto'; // needed once the IndexedDB tier lands

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // Fixed epoch so retry/backoff assertions are exact, not approximate.
  vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
```

### File 5 — WDIO configs (`tests/browser/`)

Three files, mirroring Mixpanel's split. `wdio.shared.mjs` holds everything
common and spawns the test server itself:

```js
// tests/browser/wdio.shared.mjs
import { spawn } from 'child_process';
import waitOn from 'wait-on';

const PARENT_PORT = 3001;
const CHILD_PORT = 3002; // second origin, for cross-origin / iframe cases
let testServer;

export const sharedConfig = {
  runner: 'local',
  specs: ['./specs/**/*.spec.ts'],
  maxInstances: 1,
  baseUrl: `http://localhost:${PARENT_PORT}`,
  waitforTimeout: 10_000,
  connectionRetryTimeout: 5 * 60 * 1000,
  connectionRetryCount: 3,
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 10 * 60 * 1000 },

  // Retry the whole spec FILE, not individual assertions. Absorbs tunnel and
  // emulator flake without masking a genuine failure.
  specFileRetries: 3,
  specFileRetriesDelay: 5,

  // JSON output is what dorny/test-reporter consumes in the workflow.
  reporters: ['spec', ['junit', { outputDir: './tests/browser/results' }]],

  onPrepare: async () => {
    testServer = spawn('node', ['tests/browser/testServer.js'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    await waitOn({
      resources: [
        `http://localhost:${PARENT_PORT}/health`,
        `http://localhost:${CHILD_PORT}/health`,
      ],
      timeout: 10_000,
    });
  },

  onComplete: () => testServer?.kill(),
};
```

```js
// tests/browser/wdio.local.mjs — headless Chrome for local dev
import { sharedConfig } from './wdio.shared.mjs';

const args = ['--headless=new', '--no-sandbox'];
if (process.env.INSPECT) args.push('--remote-debugging-port=9222');

export const config = {
  ...sharedConfig,
  capabilities: [
    {
      browserName: 'chrome',
      browserVersion: 'latest',
      'goog:chromeOptions': { args },
      'goog:loggingPrefs': { browser: 'ALL' },
    },
  ],
  logLevels: { webdriver: 'silent' },
};
```

```js
// tests/browser/wdio.sauce.mjs — the 6-target release matrix
import { sharedConfig } from './wdio.shared.mjs';

const VALID = [
  'chrome-latest',
  'edge-latest',
  'safari-latest',
  'firefox-latest',
  'ios-safari-sim',
  'android-chrome-sim',
];

if (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY) {
  console.error('Missing SAUCE_USERNAME / SAUCE_ACCESS_KEY');
  process.exit(1);
}
if (!VALID.includes(process.env.BROWSER)) {
  console.error(`BROWSER must be one of: ${VALID.join(', ')}`);
  process.exit(1);
}

// NOTE: Mixpanel uses Date.now() for the default tunnel name. In CI always pass
// SAUCE_TUNNEL_NAME explicitly (the workflow does) so matrix legs never collide.
const TUNNEL_NAME =
  process.env.SAUCE_TUNNEL_NAME || `tunnel-${process.env.SAUCE_USERNAME}-local`;

const COMMON = {
  build: `intempt-js ${process.env.GITHUB_REF || 'local'} ${process.env.GITHUB_RUN_NUMBER || ''}`,
};

const CAPS = {
  'chrome-latest': {
    browserName: 'chrome',
    browserVersion: 'latest',
    platformName: 'Windows 11',
    'sauce:options': COMMON,
  },
  'edge-latest': {
    browserName: 'MicrosoftEdge',
    browserVersion: 'latest',
    platformName: 'Windows 11',
    'sauce:options': COMMON,
  },
  'firefox-latest': {
    browserName: 'firefox',
    browserVersion: 'latest',
    platformName: 'Windows 11',
    'sauce:options': COMMON,
  },
  'safari-latest': {
    browserName: 'safari',
    browserVersion: 'latest',
    platformName: 'macOS 15',
    'sauce:options': { armRequired: true, ...COMMON },
  },
  'ios-safari-sim': {
    platformName: 'iOS',
    browserName: 'Safari',
    'appium:deviceName': 'iPhone Simulator',
    'appium:platformVersion': 'current_major',
    'appium:automationName': 'XCUITest',
    'appium:safariWebviewAtomWaitTimeout': 360000,
    'appium:webviewConnectTimeout': 60000,
    'sauce:options': {
      ...COMMON,
      armRequired: true,
      deviceOrientation: 'PORTRAIT',
      idleTimeout: 300,
      maxDuration: 3600,
      newCommandTimeout: 300,
    },
  },
  'android-chrome-sim': {
    platformName: 'Android',
    browserName: 'Chrome',
    'appium:deviceName': 'Android GoogleAPI Emulator',
    'appium:platformVersion': 'current_major',
    'appium:automationName': 'UiAutomator2',
    'sauce:options': {
      ...COMMON,
      deviceOrientation: 'PORTRAIT',
      idleTimeout: 180,
    },
  },
};

export const config = {
  ...sharedConfig,
  // Android emulators can't resolve `localhost` on the runner.
  baseUrl: `http://${process.env.SAUCE_HOST || 'localhost'}:3001`,
  user: process.env.SAUCE_USERNAME,
  key: process.env.SAUCE_ACCESS_KEY,
  services: [
    [
      'sauce',
      {
        sauceConnect: true,
        sauceConnectOpts: {
          tunnelName: TUNNEL_NAME,
          region: 'us',
          proxyLocalhost: 'allow',
          apiAddress: ':8032',
        },
      },
    ],
  ],
  capabilities: [CAPS[process.env.BROWSER]],
};
```

### File 6 — `.size-limit.json` (bundle budget)

Targets assume Phase 3's code-splitting and the removal of `psl`. Set the
initial values to _today's_ numbers so the gate can't fail on day one, then
ratchet down as each Phase 3 item lands.

```json
[
  {
    "name": "core",
    "path": "dist/intempt.core.min.js",
    "limit": "20 KB",
    "gzip": false,
    "brotli": true
  },
  {
    "name": "autotrack",
    "path": "dist/intempt.autotrack.min.js",
    "limit": "12 KB",
    "brotli": true
  },
  {
    "name": "choices",
    "path": "dist/intempt.choices.min.js",
    "limit": "15 KB",
    "brotli": true
  },
  {
    "name": "snippet",
    "path": "dist/intempt.snippet.min.js",
    "limit": "1 KB",
    "brotli": true
  }
]
```

### File 7 — `.eslintrc.json`

```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": { "project": "./tsconfig.json", "sourceType": "module" },
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking"
  ],
  "env": { "browser": true, "es2022": true },
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "error",
    "no-console": ["error", { "allow": [] }],
    "eqeqeq": ["error", "always"],
    "no-restricted-globals": [
      "error",
      {
        "name": "localStorage",
        "message": "Use the storage wrapper so the IndexedDB tier and quota handling apply."
      }
    ]
  },
  "ignorePatterns": ["dist/", "node_modules/", "*.config.ts"]
}
```

Two rules there are deliberately load-bearing:

- `no-explicit-any: error` will fail on all **61** current occurrences. Introduce
  it as `warn`, fix the batcher/queue boundary first (that is your wire
  contract), then flip to `error`.
- `no-console: error` will fail on all **54** current occurrences. That is the
  forcing function for the leveled logger in Phase 4 — otherwise the logger gets
  added and `console.*` keeps being used alongside it.

### `package.json` scripts these workflows assume

```json
{
  "scripts": {
    "lint": "eslint src __tests__ --ext .ts",
    "lint:fix": "eslint src __tests__ --ext .ts --fix",
    "format:check": "prettier --check \"src/**/*.ts\"",
    "typecheck": "tsc --noEmit",

    "test": "npm run lint && npm run typecheck && npm run test:unit",
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:unit:ci": "vitest run --coverage --reporter=json --outputFile=__tests__/results/results.json",

    "test:e2e": "cypress run",
    "test:browser": "wdio run tests/browser/wdio.local.mjs",
    "test:browser:sauce": "wdio run tests/browser/wdio.sauce.mjs",

    "size": "size-limit",
    "release:publish": "npm run build && changeset publish"
  }
}
```

New devDependencies: `vitest`, `@vitest/coverage-v8`, `jsdom`,
`fake-indexeddb`, `eslint`, `@typescript-eslint/{parser,eslint-plugin}`,
`prettier`, `size-limit`, `@size-limit/preset-app`,
`@wdio/{cli,local-runner,mocha-framework,sauce-service,spec-reporter,junit-reporter}`,
`wait-on`, `@changesets/cli`, `express`.

### Rollout order

| Step | Change                                                                   | Gate mode                    |
| ---- | ------------------------------------------------------------------------ | ---------------------------- |
| 1    | Add eslint + prettier config, `lint` script                              | warn-only, non-blocking      |
| 2    | Add `ci.yml` with static + smoke + build jobs                            | blocking                     |
| 3    | Add vitest + first ported suite (`requestQueue`)                         | blocking, no threshold yet   |
| 4    | Port remaining Mixpanel suites; enable coverage thresholds               | blocking                     |
| 5    | Flip `no-explicit-any` / `no-console` to `error`                         | blocking                     |
| 6    | Add `.size-limit.json` at current sizes                                  | blocking, ratchet later      |
| 7    | Add WDIO local config; then `browser-tests.yml` on `main`/`staging` only | blocking on release branches |
| 8    | Add changesets; `release.yml`; retire the deploy job in `build.yaml`     | blocking                     |
| 9    | Un-comment the Sonar quality gate in `analyze.yaml`                      | blocking                     |

Steps 1–3 are roughly a day. Step 4 is the bulk of Phase 2. Step 7 needs a Sauce
Labs account (or BrowserStack — same WDIO config, swap the service).

---

## 4. Beyond parity — engineering for 10 lakh (1M) events/sec sustained

Framing first, because it changes what work matters: **1M events/sec is an
ingest-tier number, not a browser-tier number.** No single browser produces more
than ~10–100 events/sec. 1M/sec sustained means roughly 1–10M concurrent
sessions. So the SDK's job is not to be fast in isolation — it is to (a) impose
near-zero cost per client, (b) _never_ amplify load during an incident, and
(c) make the aggregate shape predictable enough for the ingest tier to plan
capacity. The SDK is a load-shaping device.

### 4a. Client-side cost per session

- **Bundle**: 60 KB core / 20 KB brotli target (Phase 3). At 10M sessions/day,
  258 KB → 60 KB saves ~2 PB/day of CDN egress. This is a direct line-item cost.
- **Main-thread budget**: assert in CI that SDK init < 10 ms and per-`track`
  cost < 0.1 ms. Move JSON serialization and queue writes off the critical path
  — batch-serialize at flush, not at enqueue.
- **Web Worker offload**: move the queue + batcher into a `SharedWorker` (one
  per origin across tabs). This eliminates cross-tab lock contention entirely
  (your `sharedLock` becomes unnecessary), removes all queue I/O from the main
  thread, and gives one flush stream per browser instead of one per tab —
  cutting your server-side connection count by the average tabs-per-user. This
  is the highest-leverage architectural change available and Mixpanel does _not_
  have it; it is where you can beat the comparator rather than match it.

### 4b. Aggregate load shaping (the part that actually protects 1M/sec)

- **Server-driven config.** Ship a small, cached remote-config fetch that can
  change `batchSize`, `flushInterval`, `sampleRate`, and a kill-switch **without
  a redeploy**. During an ingest incident you need to halve global client load
  in minutes. Without this your only lever is a CDN rollback, which takes hours
  to propagate through browser caches.
- **Jittered flush intervals.** A fixed `batchFlushIntervalMs` across 10M
  clients creates synchronized thundering herds, especially after a network
  partition heals. Add ±25% jitter to every scheduled flush and to retry
  backoff. Your backoff currently has none — `retryMS = flushInterval * 2`
  deterministically, so every client that failed at T retries at T+2f together.
  This is the single most likely cause of a self-inflicted outage at your scale.
- **Full-jitter exponential backoff with a cap and a circuit breaker.** Replace
  the current doubling with `random(0, min(cap, base·2^n))`. Add a breaker that
  stops flushing entirely after N consecutive failures and probes with a single
  request. Honor `Retry-After` (you already do) _and_ a `X-Intempt-Backoff`
  server hint so ingest can shed load cooperatively.
- **Adaptive batch sizing.** You halve on 413; also _grow_ on sustained success
  toward a max, and shrink on rising latency. Larger batches at high volume cut
  request count superlinearly — the dominant server cost at 1M/sec is requests,
  not bytes.
- **Payload compression.** `CompressionStream('gzip')` is available in all
  modern browsers; you currently have zero compression (`grep gzip` → 0 hits).
  Event JSON compresses 5–10×. This cuts egress and, more importantly, ingest
  bandwidth and parse cost.

### 4c. Correctness at scale

- **Idempotency end-to-end.** You have client-side `sentEventIds`, but that set
  lives in localStorage and is capped — it cannot be the only defense. Send a
  stable `$insert_id` per event and dedupe **server-side** on a time window.
  Client dedup is best-effort; server dedup is the guarantee. At 1M/sec even a
  0.1% duplicate rate is 1,000 dup/sec.
- **Clock skew.** Client `Date.now()` is untrustworthy at scale (a meaningful
  fraction of devices are minutes-to-years off). Send both client time and a
  monotonic `performance.now()` delta from session start, and let the server
  compute a corrected timestamp from its own receive time. Ordering bugs from
  skew are the classic analytics-at-scale defect.
- **Ordering.** Add a per-session monotonic sequence number so the server can
  detect gaps and reorder, independent of timestamps.
- **Schema versioning on the wire.** Version the payload envelope so ingest can
  accept N and N−1 concurrently — with browser caches you will have old clients
  in the field for months. This is mandatory, not optional, once you have real
  volume.

### 4d. Verification you don't currently have

- **Load harness**: a headless-Chrome fleet driving synthetic sessions at target
  rate against a staging ingest, asserting zero event loss and bounded p99
  flush latency. Run weekly, not per-commit.
- **Chaos tests**: inject 500s, 429s, timeouts, offline transitions, quota
  exhaustion, and tab-close races; assert no loss, no unbounded growth, no
  duplicate storm.
- **Soak test**: a single tab open 24 h with continuous events — asserts no
  memory growth, no unbounded `sentEventIds`/`itemIdsSentSuccessfully` growth.
  Note both of those maps in `requestBatcher.ts` currently grow without bound;
  `itemIdsSentSuccessfully` is never pruned. **That is a memory leak on any
  long-lived tab** and it will surface first in exactly your high-volume
  customers.
- **Real-device matrix**: Safari/iOS `pagehide` and ITP behavior cannot be
  validated in Cypress-on-Chrome.

### 4e. Commercial-grade table stakes still absent

Multi-instance support (two projects on one page), a `before_send`/`on_error`
plugin surface, framework adapters (React/Next/Vue/Svelte), CSP/SRI guidance,
SOC2-relevant audit logging of config changes, a documented support/deprecation
policy, and a public status/changelog feed.

---

## Recommended sequencing

If you do only three things, do these — they're 33 of the 53 points:

1. **Phase 2 (tests)** — unlocks safe change velocity for everything else.
2. **Phase 3 items 1, 2, 4** (IndexedDB, unload dequeue fix, drop `psl`) —
   the reliability bug and the bundle are both customer-visible today. Dropping
   `psl` is the single best effort-to-impact item in the whole plan: ~15 lines
   changed, ~150 KB raw / ~25 KB brotli saved on every page load.
3. **Phase 4 items 1, 2** (credential hygiene, persisted opt-out) — these are
   the two findings that fail an enterprise security/privacy review outright.

Two bugs to fix regardless of sequencing, because they are live defects:
`itemIdsSentSuccessfully` unbounded growth (memory leak), and the
`unloading: true` early return (duplicate sends).
