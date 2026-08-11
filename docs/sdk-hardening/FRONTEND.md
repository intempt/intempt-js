# FRONTEND — the work that needs nobody else

> Companion to [`BACKEND.md`](BACKEND.md). That file lists what the SDK needs from
> ingest; **this file is everything reachable without the backend team, ordered by
> rubric points per day of work.**
>
> Scores are against the 10-dimension rubric in [`AUDIT.md`](AUDIT.md) §1.
> Current: **62/100** (was 40 at the audit). Mixpanel comparator: 85.

---

## The ceiling, stated up front

**Front-end work alone reaches ~85, not 91.** Two dimensions are capped by things
outside this list:

| Cap | Why | Worth |
|---|---|---|
| Dimension 4 (security) caps at ~62 | The write key is a client-side `Authorization: Basic` header. Removing it is `BACKEND.md` item 1 — there is no client-side fix. | ~2.3 pts |
| Dimension 2 (reliability) caps at ~86 | `sendBeacon` cannot set headers, so the transport chain's most important leg is blocked behind the same credential change. | ~0.9 pts |
| Dimension 1 (tests) caps below 92 | Safari / iOS Safari / Android coverage needs a paid device cloud (Sauce or BrowserStack). A budget decision, not a backend one. | ~1 pt |

So: **62 → ~85 on this list. 85 → 91 needs the two `BACKEND.md` items plus the
browser-matrix spend.** Do not plan the last six points as front-end work.

---

## The list

Ranked by points per day. Total **+22.9 points, ~30 working days**.

| # | Task | Dim | Δ | Est |
|---|---|---|---|---|
| 1 | Packaging | 5 | +3.6 | 3d |
| 2 | Structured logging & metrics **✅ done** | 6 | +3.4 | 3d |
| 3 | CI breadth | 8 | +2.8 | 2.5d |
| 4 | Security, the client-side half | 4 | +1.7 | 1.5d |
| 5 | Privacy & consent | 7 | +2.4 | 3d |
| 6 | Code health | 10 | +1.7 | 3d |
| 7 | Docs & DX | 9 | +2.5 | 4d |
| 8 | Test breadth (**in progress**) | 1 | +3.0 | 6d |
| 9 | Performance & footprint | 3 | +1.2 | 2.5d |
| 10 | Reliability, the client-side half | 2 | +0.6 | 1.5d |

**Two departures from strict ranking, and the reasons:**

- **Do #3 first regardless.** It is the cheapest real points on the board *and* it
  protects everything else. Related: the branch has never been pushed, so none of
  the gates built so far have ever actually run. That is a five-minute task and it
  gates the value of #3, #4 and #8.
- **#8 is last on points-per-day but unblocks #1, #6 and #9.** Refactoring the
  module split, killing `any` across the codebase, or code-splitting the bundle
  without tests on the public API is how an incident ships. Its first sub-item
  (mutation testing) is already running.

---

### 1. Packaging — dim 5: 52 → 88 · +3.6 · 3d

Phase 1 tasks 3–5, previously backlogged by the user (2026-08-11). Included here
because they are front-end work; if they stay parked, the ceiling drops to ~81.

- Hand-author `src/index.d.ts` as the **public** contract (mirror
  `/home/beso/mixpanel-js/src/index.d.ts`), not emitted from internals, so
  refactors do not break consumers.
- Add a module build exporting a pure `createIntempt(config)` with **no
  import-time side effects**, keeping the self-initialising IIFE for the CDN
  snippet. Only then add `main` / `module` / `exports` / `types` /
  `sideEffects: false` to `package.json` — they are deliberately absent today
  because there is nothing importable to point at (see CHECKPOINT §2, task 1).
- `CHANGELOG.md` + changesets; a written deprecation policy.

### 2. Structured logging & metrics — dim 6: 40 → 82 · +3.4 · 3d · **✅ done**

The worst-scoring dimension, and entirely ours. **Landed — see CHECKPOINT §3g for
the full record, including the bundle accounting.**

- ✅ 53 of the 55 raw `console.*` calls replaced with a levelled logger
  (`src/shared/logger/logger.ts`) gated on config rather than only on
  `EnvConfig.isProduction()`, with `debug: true` to lift production silence for a
  support case. Two calls survive deliberately and are documented in place:
  `CAN'T FIND SCRIPT` in `sdkLoader.ts` (fires before any config exists, and is
  the string support tells customers to look for) and the one in `envConfig.ts`
  (the logger's own gate lives there — routing it would be circular).
- ✅ Internal metrics in `src/shared/logger/metrics.ts`: queue depth, flush
  latency, **drop count** — §3c's counter finally has a consumer — and breaker
  state transitions. Readable as `intempt.getDiagnostics()`; transitions are also
  logged.
- ✅ A sink hook, `onDiagnostic` on `IntemptConfig`, gated independently of the
  console so it still fires in production. A throwing sink is swallowed.

Still open on this dimension, and it is breadth rather than plumbing: route the
quota-failure telemetry from item 10 through the sink.

### 3. CI breadth — dim 8: 62 → 90 · +2.8 · 2.5d

`ci.yml` exists (§3d) with unit + build + mutation + e2e. Missing:

- ESLint + Prettier configs **and** gates. There is no lint config in the repo at
  all today, which is why `ci.yml` deliberately omits a lint job.
- `.size-limit.json` pinned at the current 81.80 kB / 23.09 kB gzip, ratcheting.
- `release.yml`: npm publish with provenance (`publishConfig` is already set).
- Pin every action to a SHA; `npm audit` gate once #4's upgrades land.
- Un-comment the Sonar quality gate in `analyze.yaml`.

### 4. Security, the client-side half — dim 4: 45 → 62 · +1.7 · 1.5d

The credential itself is `BACKEND.md` item 1. What is ours:

- SRI and CSP guidance for the embed snippet, in customer-facing docs.
- Upgrade the devDependencies behind the 19 open advisories (8 high, 4 critical,
  all devDeps — see the note at the foot of `ci.yml`), then turn the audit gate on.
- Guard the unguarded `console.error('credentials not found')` at
  `choices.service.ts:94` — every other diagnostic in the SDK is gated.
- A bundle secret-scan step, so a key can never be baked into `dist/`.

### 5. Privacy & consent — dim 7: 58 → 88 · +2.4 · 3d

Persisted opt-out already landed (§4 defect 3). Remaining:

- Port `gdpr-utils.js` (301 LOC).
- Honour DNT and GPC; add an `ignore_dnt` config for customers who have their own
  consent gate.
- PII masking / scrubbing on outbound payloads.
- **Cross-subdomain consent cookie at the eTLD+1** — the D15 limitation. Consent
  is `localStorage` today, so an opt-out on `www.example.com` does not carry to
  `shop.example.com`. Use the `psl`-free `extractEtldPlusOne` helper from §5.
- A data-residency switch.

### 6. Code health — dim 10: 56 → 85 · +1.7 · 3d

- Kill the 61 `: any`; flip `no-explicit-any` and `no-console` to `error`.
- Split the 452-line `autoTracker.module.ts` — it does init, transport and
  lifecycle in one file.
- Dedupe the `getProfileId` / `getSessionId` / `getPageId` triplet repeated in
  every public method.
- One-line guard for `IntemptJs.optIn()` / `optOut()`, which dereference
  `this._autoTracker` and throw on a misconfigured instance (noted in §4).

### 7. Docs & DX — dim 9: 47 → 88 · +2.5 · 4d

Nothing customer-facing has changed in this programme — `AUDIT.md` and friends are
internal.

- Generated API reference (TypeDoc) off the `index.d.ts` from #1.
- `examples/` directory; React / Next / Vue adapters; a TS quickstart; a migration
  guide.

### 8. Test breadth — dim 1: 68 → 88 · +3.0 · 6d · **in progress**

Four sub-items. **Only the last is underway.**

- ⬜ `intemptJs.ts` public API: `track`, `identify`, `alias`, `group`, `record`,
  `consent`. Their *argument validation* is covered by the 80 `IntemptJsGuard`
  tests; the methods themselves have **no test**.
- ⬜ The choices engine — 1,289 LOC of DOM mutation plus the web editor, the
  capability Mixpanel does not have, and essentially untested.
- ⬜ Golden-file contract tests on the outbound payload shape. Also the thing that
  would let `$lib_version` (`BACKEND.md` item 4) be added with confidence.
- 🟡 **Mutation testing to the user-set 85% floor.** 70.66% → 75.12% so far;
  ~100–130 tests remain. Worklist and measured kill rate in CHECKPOINT §3f-i.

Note the coverage-scope caveat: the enforced gates measure `src/shared/**`,
`src/guard/**` and `src/intemptJs/guards/**` — about 3,160 of 7,973 lines. The
first two sub-items above are what widen that.

### 9. Performance & footprint — dim 3: 78 → 88 · +1.2 · 2.5d

Also previously parked by the user (code-splitting).

- Code-split so track-only customers do not download `choices/**` + the web
  editor (1,644 LOC they never execute).
- Brotli measurement alongside gzip; the size gate from #3.
- Main-thread budget assertions in CI: init < 10 ms, per-`track` < 0.1 ms.

### 10. Reliability, the client-side half — dim 2: 82 → 86 · +0.6 · 1.5d

- `fetch(keepalive)` → XHR fallback chain. The `sendBeacon` leg is blocked on
  `BACKEND.md` item 1, but the other two legs are not.
- Surface quota-failure telemetry through the logger from #2.

---

## Where this leaves the score

| | Score | Gap to Mixpanel |
|---|---|---|
| Audit baseline | 40 | 45 |
| Today | **62** | 23 |
| This list complete | **~85** | 0 |
| Plus `BACKEND.md` 1–2 and a device cloud | **~91** | — |
