# DECISIONS — SDK enterprise-hardening programme

Settled decisions with rationale, so a later session does not re-litigate them.
Append new entries; do not silently rewrite old ones. If a decision is reversed,
mark it **SUPERSEDED** and add the replacement below it.

Format: what was decided, why, and what would change our mind.

---

## D1 — Benchmark against `mixpanel-browser`, not a generic rubric

**Decided:** score against Mixpanel JS v2.81.0 as the reference implementation of
a commercially mature browser analytics SDK.

**Why:** it is the closest mature comparator, Apache-2.0 (so we can inherit code,
not just ideas), and already checked out locally at `/home/beso/mixpanel-js`. A
score against an abstract rubric would not tell us *what to copy*.

**Caveat, recorded deliberately:** the two products are **not** the same scope,
and the rubric measures engineering quality, **not feature parity**:

- Intempt has a DOM-level experience-delivery engine (`choices/**`, 7 mutation
  types) plus a live visual web editor — **Mixpanel has no equivalent**.
- Mixpanel has feature flags (708 LOC) and rrweb session replay — **Intempt has
  neither**.

Neither is a superset. Any footprint comparison must be core-to-core.

---

## D2 — Vitest for the unit tier, not Mixpanel's mocha + babel-6

**Decided:** vitest.

**Why:** the repo is already on vite, so vitest adds no new toolchain. Mixpanel's
mocha + `babel-core@6.7.2` + browserify stack is legacy and would be a step
backwards. What we *do* inherit from them is the harder-won part: the jsdom setup
and, critically, deterministic fake-timer control (`tests/unit/jsdom-setup.js`) —
that is what makes batcher/backoff tests non-flaky.

**Would change our mind:** nothing foreseeable.

---

## D3 — Keep TypeScript; it is not a bundle-size problem

**Decided:** keep TS, keep `strict: true`.

**Why — measured, not assumed:** `tsconfig.json` targets **ES2020** and the
emitted bundle contains **zero** downlevel helpers (`__awaiter`, `__generator`,
`__spreadArray`, `__extends`, `__decorate` all grep to 0 in `dist/`). Types are
erased at compile. TS contributes ~0 bytes and is a net asset for a commercial
SDK's public contract.

This was explicitly checked because TS was hypothesised as a cause of the 252 KB
bundle. It is not. See D4 for the actual cause.

---

## D4 — The bundle problem is `psl` plus missing code-splitting

**Decided:** treat footprint as two narrow defects, not a pervasive one.

**Why — measured:**

| Bundle | Raw | brotli |
|---|---|---|
| `intempt.min.js` (monolith) | 252 KB | 54 KB |
| `mixpanel.min.js` (core only) | 101 KB | 29 KB |
| `mixpanel-recorder.min.js` (on-demand) | 333 KB | 61 KB |

`psl` is **152 KB raw / 9,353 rule literals ≈ 60% of the bundle**, imported once
(`src/shared/storageHandler.ts:3`) for one function (`handleDomain`, :48–63).
Confirmed present in `dist/` — an initial grep for `psl` missed it because the
identifier is minified, but the data markers (`blogspot`, `ac.uk`, `co.jp`,
`pvt.k12`) are unambiguous.

**Subtract `psl` and our own code is ~100 KB — Mixpanel-core-sized, while also
containing an experiences engine and visual editor Mixpanel lacks.** Our code is
denser in capability per KB than the comparator. The two real defects:

1. `psl` ships 152 KB for one function → drop it (Mixpanel does eTLD+1
   heuristically in `utils.js`, no data table) or lazy-load on the cookie-write
   path only.
2. No code-splitting → a track-only customer downloads `choices/**` +
   `webEditorLoader` (1,644 LOC) and the web editor's injected 22 KB string blob.

Because of this, dimension 3 was scored **45**, not 30, raising the overall score
from 38 to **40**.

---

## D5 — Immutable versioned CDN paths with a short-TTL alias

**Decided:** publish to `/v1/<version>/intempt.min.js` (immutable, 1y cache) and
flip `/v1/intempt.min.js` (alias, 5m cache) to point at it. Add `/v1/latest.json`
carrying version + SRI hash.

**Why:** the current deploy overwrites a single mutable path, so there is no prior
artifact to roll back to — recovery means rebuild, re-upload, then wait out
browser caches. That is exactly the `/v1` incident (`af1a16b`, reverted in
`3dc3a54`). With immutable + alias, **rollback becomes a pointer flip** and can be
a one-minute workflow with no build.

Also add a post-deploy step that fetches the live alias and greps for the version
string — the check that would have caught that incident at deploy time rather than
via a customer report.

---

## D6 — Two-tier browser testing: Cypress smoke + WDIO release gate

**Decided:** keep the existing 14 Cypress specs as a fast Chrome-only smoke tier;
add WDIO/SauceLabs across 6 real browser targets as the release gate.

**Why:** Cypress cannot drive Safari, iOS Safari, or Android Chrome — and those
are precisely where `localStorage` quota behaviour, ITP cookie capping, and
`pagehide`/unload semantics diverge, i.e. where an analytics SDK actually breaks.
A green Chrome-only suite is not evidence of cross-browser correctness. Sauce
minutes are metered, hence the split rather than running everything everywhere.

BrowserStack would work identically — same WDIO config, swap the service.

---

## D7 — Fix the write-key credential before adding `sendBeacon`

**Decided:** these are one change, not two, and the credential fix comes first.

**Why:** the write key is currently `btoa`-encoded into an
`Authorization: Basic` header client-side (`src/intemptJs/modules/autoTracker/autoTracker.module.ts:164-165`, header set at `:179`).
That puts a write credential in devtools **and** forces `fetch`, because
`sendBeacon` cannot set custom headers. `sendBeacon` is the only transport that
reliably survives tab close on Safari. So the security defect and the unload
reliability gap have the same root cause.

**Preferred fix:** a public, ingest-only project token in the URL path or body
(Mixpanel's model — public by design, no write authority beyond event ingest,
rate-limitable server-side). If the write key must stay, move it to a query param
or body field so no custom header is needed, and scope it server-side to
ingest-only.

---

## D8 — Documentation-first checkpointing for multi-session work

**Decided:** programme state lives in `docs/sdk-hardening/CHECKPOINT.md`, pointed
at from a root `CLAUDE.md`, updated in the same commit as the work it describes.

**Why:** the programme spans many sessions and will outlive any single context
window. A root `CLAUDE.md` is loaded automatically at session start, so it is the
one reliable hook for pointing a cold session at the real state. Committing the
checkpoint alongside the code keeps the two from drifting; a checkpoint that lags
the code is worse than none, because the next session trusts it.

---

## D9 — Audit was report-only; no source changes in Phase 0

**Decided:** Phase 0 produced documents only. No source file was modified.

**Why:** explicit user instruction. Recorded here so a later session does not go
looking for phantom Phase 0 code changes, or assume the proposed CI/CD files in
`AUDIT.md` §3b were applied. **They were not** — they are proposals with a
rollout order.
