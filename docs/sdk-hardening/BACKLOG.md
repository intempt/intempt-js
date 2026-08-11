# BACKLOG — everything deliberately parked

> **Why this file exists.** Parked items were previously recorded scattered across
> `CHECKPOINT.md` §0b, §2a, §2a-i and the foot of `FRONTEND.md`, which made "what is
> not being worked, and why" impossible to answer without reading all of them. This
> is the single list. **`CHECKPOINT.md` §0b remains the list of what *is* being
> worked** — if an item is in both files, §0b wins and this file is stale.
>
> **Every entry needs three things:** who or what unblocks it, what it costs to
> leave parked, and the date it was parked. An item with no cost recorded is an
> item nobody can prioritise later.
>
> Updated 2026-08-12.

## How to read the blocker column

| Blocker | Meaning |
|---|---|
| **user** | A decision, not code. Nothing technical is in the way. |
| **ingest** | Needs the backend/ingest team. `BACKEND.md` is the handover spec. |
| **money** | Needs a paid account or service. |
| **sequencing** | Only blocked by other work being in flight. |

---

## 1. Parked by user decision — 2026-08-12

### 1.1 `FRONTEND.md` #1 — packaging · blocker: user
`src/index.d.ts` as a hand-authored public contract, a module build exporting a
pure `createIntempt(config)` with no import-time side effects, then the
`main`/`module`/`exports`/`types`/`sideEffects` fields, plus `CHANGELOG.md` and
changesets.

**Cost of parking: the largest on this list.** Worth **+3.6** rubric points on its
own; dimension 5 stays at **52**, and the front-end-only ceiling drops from ~85 to
**~81**. Downstream, it is also the real fix for two problems recorded elsewhere:
the SRI warning in §3g-ii (an immutable versioned artifact is what makes SRI safe)
and the `/v1` rollback gap in invariant §6.2 (there is no prior artifact to roll
back to because there are no versioned artifacts at all).

`release.yml` stays entirely unexercised while this is parked — it needs
`NPM_TOKEN`, an `npm-publish` environment and a tag, none of which exist yet.

### 1.2 `FRONTEND.md` #9 — code-splitting · blocker: user
Split so track-only customers stop downloading `choices/**` plus the web editor —
**1,644 LOC they never execute**. Worth +1.2.

**Cost of parking, and it grew:** the bundle went 81.8 → **91.24 kB** in the
five-lane merge, because the privacy scrubber's pattern tables and the logger are
module-level, so every customer pays for them whether the features are switched on
or not.

**One slice of this should not wait.** `ModificationHandler.ts` (D-23) is **459 LOC
imported by nothing**, and it carries **18 of the repo's ~89 `any` hits** — so
deleting it is also the cheapest slice of `FRONTEND.md` #6 code health, which *is*
being worked. Do it there and note it, rather than leaving 459 dead lines in the
bundle for want of a section number.

### 1.3 Handing `BACKEND.md` to the ingest team · blocker: user, then ingest
Six items, spec written and ready. Was §0b decision #3.

**Cost of parking: this is the tallest blocker in the programme.** Nothing below in
§2 can start until the handover happens, including the three worst known defects.

---

## 2. Blocked on ingest — the `BACKEND.md` items · blocker: ingest

Parked since 2026-08-11. All six are specified in `BACKEND.md`; the summary is
there, not here. What they unblock on our side:

| # | Item | Unblocks |
|---|---|---|
| 1 | Public, ingest-only project token | The `sendBeacon` transport leg (D7), so events survive a page the browser is tearing down. Also `FRONTEND.md` #10's last third, and dimension 4 (security), which **cannot exceed ~62 without it**. |
| 2 | Status codes the retry logic can act on | Correct retry classification instead of inference. Dimension 2 caps at ~86 without it. |
| 2a | Whether ingest ever sends `Retry-After` | Whether `autoTracker.module.ts:205`'s parse is live code or dead. If live, it needs jittering upward or every client returns in the same second. |
| 3 | Idempotency on `eventId` | Lets us **delete** client-side dedupe complexity. |
| 4 | Confirm `$lib_version` is accepted | Version stamping on payloads (Phase 1 task 2's deferred half). **Do not ship blind — a rejected payload is dropped events.** |
| 5 | A server-controlled brake | The fourth and last load-shedding mechanism; the other three (jitter §3a, breaker §3b, bounded queue §3c) are done client-side. |
| 6 | Regional ingest endpoints | A real `region: 'us' \| 'eu'` data-residency switch. Today it is `apiHost` only (D26). |

**The three worst defects in `DEFECTS.md` are in this queue**, because all three
change the wire format:

- **D-1 — no event carries a timestamp.** Ingest attributes every event to its
  *delivery* moment, so anything queued across a retry, the 60s breaker window, or
  a reload is mis-timed, and intra-session ordering is not recoverable from the
  payload at all. **The most consequential finding in the register.**
- **D-3 — every session event shares one `eventId`**, and the batcher dedupes on
  `eventId`, so session events after the first are droppable by design.
- **D-15 — auto-tracked events carry no `type` field.**

---

## 3. Blocked on money

### 3.1 Cross-browser WDIO / Sauce Labs tier · blocker: money
`AUDIT.md` §3b File 2. Parked 2026-08-11.
**Cost:** every browser claim in this repo is asserted in **jsdom and Electron
only**. Safari and Firefox behaviour is inferred, never executed. The lookbehind
trap in §3h (a regex that would have taken the whole bundle down on Safari < 16.4)
is exactly the class of defect this tier catches and nothing else here does.

### 3.2 `browser-tests.yml` · blocker: money
The workflow that would run 3.1.

---

## 4. Blocked on sequencing

### 4.1 Changesets automation · blocker: sequencing (needs 1.1 first)
Parked 2026-08-11. The manual half is inside 1.1.

### 4.2 Making the dev-dependency audit blocking · blocker: user decision #1
`ci.yml`'s `audit` job has a blocking half (`--omit=dev`, currently **0**
advisories) and an advisory dev half at `--audit-level=high` (**4**: 1 high, 3
moderate). The remaining high needs vite ≥ 6.4.3, and **every vite ≥ 6 excludes
Node 21** (`engines: ^20.19.0 || >=22.12.0`) — the version `build.yaml` deploys on.
**Cost of parking: nil in exposure, real in signal.** All three vite advisories are
`vite dev` server issues and this repo ships `vite build` output, so nothing is
reachable by a customer. But the job stays advisory, which means it cannot fail the
day something genuinely exploitable lands. **Do not work around `build.yaml` to
close this** — fix the Node version, then make the second half blocking.

### 4.3 Fixing `build.yaml`'s branch trigger · blocker: user decision #1
Its trigger is `branches: ['*']`, and a single `*` does not match a ref containing
`/`. **Every feature branch with a slash in its name has therefore been completely
ungated for as long as that file has existed** — this branch included. `ci.yml`
uses `['**']`, which is why it fires. The fix is one character; it is parked only
because it means touching the deploy path, same as decision #1.

---

## 5. Reduced in scope rather than parked

- **`region` enum for data residency** (D26) — shipped as `apiHost` only. Needs
  `BACKEND.md` item 6 before an enum would mean anything.
- **SRI** (§3g-ii) — shipped as a *warning*, not a recommendation, because
  `/v1/intempt.min.js` is mutable and a correct hash stops matching at the next
  release, at which point the browser refuses to run the SDK at all. Real fix is
  1.1.

---

## 6. Done, listed so nobody re-parks them

- **IndexedDB persistence** — approved and landed (§6b).
- **Client-side load shedding, three of four** — jitter (§3a), circuit breaker
  (§3b), bounded queue (§3c). The fourth is §2 item 5.
- **Cross-subdomain consent cookie** — the D15 limitation is closed (§3h, D23).
- **Coverage re-baseline** (D20) — gates now 93/88/94/94.
