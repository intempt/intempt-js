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

---

## D10 — Start the published version at `6.0.0`, not `1.0.0`

**Decided:** `package.json` version `0.0.0` → `6.0.0`.

**Why:** the shipped bundle already logged `version: 'v6.0'`, so customers and
support tickets reference a 6.x SDK. Publishing a `1.0.0` package that is
*newer* than the `v6.0` in the field would make every future incident report
ambiguous about which artifact is meant. Semver continuity with what the field
already believes is worth more than a clean `1.0.0`.

**Would change our mind:** if `v6.0` turns out never to have been surfaced to
customers (it only logged on non-production builds), a `1.0.0` reset is
defensible — but the string was in the production source, so assume it leaked.

---

## D11 — Do not declare `main`/`module`/`exports`/`sideEffects` until the module build exists

**Decided:** Phase 1 task 1 ships only metadata that is **true today**. The
entry-point fields are deferred to task 5.

**Why:** the sole build output is an IIFE (`vite.config.ts`, `format: 'iife'`) and
`src/main.ts` self-initializes on import. `exports` pointing at an IIFE resolves
to something that cannot be meaningfully imported, and `sideEffects: false` on a
self-initializing entry invites a bundler to tree-shake the entire SDK away —
a silent, total failure in a consumer's build. A field that lies is worse than a
field that is absent: absence produces an honest resolution error, a lie produces
a green build with no tracking.

**Would change our mind:** nothing — task 5 makes the fields true, and they go in
with it.

---

## D12 — `$lib_version` stamping is blocked on ingest confirmation

**Decided:** version is single-sourced and exposed on the SDK object, but **not**
yet stamped onto outbound event payloads.

**Why:** the stamp belongs in `SessionEventModel`
(`src/intemptJs/modules/autoTracker/models/session.model.ts`), which is the wire
format posted to `…/sources/<id>/track`. If ingest validates strictly, an unknown
field means **rejected batches, i.e. dropped events for every customer** — a
worse outcome than the missing forensics the stamp was meant to fix. Client-side
observability is not worth risking the ingest path on an assumption.

**Unblocks when:** the ingest team confirms unknown top-level payload fields are
tolerated (or names the field they want). Then stamp it.

---

## D13 — On unload, dequeue only on a *definite* success

**Decided:** the `unloading: true` branch of `handleResponse` removes the batch
from the queue only when the response is an `ok`/2xx. Anything ambiguous — no
response object, `error` set, status 0 or 5xx — leaves the batch queued for the
next page load.

**Why:** `fetch(..., {keepalive: true})` fired from `beforeunload`/`pagehide`/
`visibilitychange` frequently *does* resolve before the page goes away, so
returning unconditionally without dequeuing discarded information we actually
had, and left delivered events in the queue. But the converse error is worse:
dequeuing on a guess loses events permanently, while retaining a delivered batch
costs at most a duplicate that `sentEventIds` usually catches. The asymmetry
decides the default.

**Would change our mind:** server-side idempotency on an event ID. With that,
dequeuing optimistically becomes free and this can be simplified.

---

## D14 — Already-sent queue items are evicted, not skipped

**Decided:** an item filtered by the `alreadySent` eventId check is removed from
the queue in the same flush.

**Why:** skipping alone was the real mechanism behind the reported duplicate
sends. A skipped item stays at the head of the queue, so `fillBatch` returns it
on every subsequent flush — the queue head is permanently blocked and each flush
burns part of its batch on garbage. Then, because `sentEventIds` is capped, the
item's eventId eventually ages out of the window and the item becomes eligible
again — and *is* re-sent. It can never legitimately be sent, so it must go.

---

## D15 — Persist opt-out in `localStorage`, accepting origin scope for now

**Decided:** `src/shared/consentState.ts` stores the do-not-track flag in
`localStorage` under `intempt_do_not_track`.

**Why:** it matches where the rest of the SDK's client state already lives, so it
adds no new storage surface, and it fixes the compliance defect immediately —
consent has to outlive the page that captured it.

**Known limitation, accepted deliberately:** `localStorage` is origin-scoped, so
an opt-out on `www.example.com` does not carry to `shop.example.com`. The correct
fix is a cookie written at the eTLD+1, which needs the `psl`-free eTLD+1 helper
(Phase 3) and belongs with the `gdpr-utils` port (Phase 4). Shipping the
origin-scoped version now is strictly better than an in-memory flag; it is not
the end state.

**Also decided:** storage failures are swallowed, never thrown. `optOut()` is
called from consent-banner click handlers, and in Safari private mode or at full
quota a throw there could break the host page's banner — turning our compliance
fix into their outage. The in-memory flag still holds for the current page.

---

## D16 — Replace `psl` with a heuristic, verified by a parity harness

**Decided:** `psl` and `@types/psl` are removed. `src/shared/publicSuffix.ts`
derives eTLD+1 from a TLD heuristic plus an explicit set of two-label suffixes.

**Why — measured:** `dist/intempt.min.js` went **225.86 kB → 72.43 kB**
(gzip **64.89 → 20.86 kB**), a 68% cut on every page load, and the SDK now has
**zero runtime dependencies** — which also deletes the `psl` supply-chain surface
before Phase 4 has to assess it. The cost was one function at one call site.

**The failure mode is bounded, which is what makes the trade acceptable:** a
wrong answer scopes a cookie one label too wide or too narrow. It cannot leak a
cookie to another registrant, because a browser rejects a `domain` that is not a
suffix of the current host, and our fallback is always *narrower* (the full
hostname), never wider. Mixpanel makes the same trade in `src/utils.js`.

**How it was verified, and why that step is not optional:** a parity harness ran
the old `psl`-backed `handleDomain` against the new one over 58 hostnames. It
caught a regression that reasoning alone had missed — **private suffixes**
(`github.io`, `vercel.app`, `herokuapp.com`, `appspot.com`, `blogspot.com`, and
**`myshopify.com`**, which matters because this SDK ships a Shopify tracker)
collapse to a *public* suffix under a naive last-two-labels rule, and a browser
rejects that cookie outright instead of mis-scoping it. Those suffixes now have
explicit entries.

Two divergences were kept deliberately, both asserted in
`__tests__/publicSuffix.cy.ts`:

- IP literals and single-label hosts now get **host-only** cookies. The old code
  emitted `domain=.0.1` for `127.0.0.1` and `domain=.localhost`, both of which
  browsers reject — the cookie was dropped, not scoped. This is a fix.
- Deep `.us` hierarchies (`example.pvt.k12.ma.us`) resolve one label too wide.
  Long tail; no known customer.

**Would change our mind:** a customer on a hostname the heuristic gets wrong. The
fix then is an explicit `cookie_domain` config option (Mixpanel's escape hatch),
not the return of a 152 KB table.

**Rule for anyone extending this:** re-run a parity check against a current
public-suffix list. Do not reason about the suffix set — that is exactly what
missed `myshopify.com` the first time.
