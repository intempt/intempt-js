# BACKLOG — everything deliberately parked

> **Why this file exists.** Parked items were previously recorded scattered across
> `CHECKPOINT.md` §0b, §2a, §2a-i and the foot of `FRONTEND.md`, which made "what is
> not being worked, and why" impossible to answer without reading all of them. This
> is the single list. **`CHECKPOINT.md` §0b remains the list of what _is_ being
> worked** — if an item is in both files, §0b wins and this file is stale.
>
> **Every entry needs three things:** who or what unblocks it, what it costs to
> leave parked, and the date it was parked. An item with no cost recorded is an
> item nobody can prioritise later.
>
> Updated 2026-08-12.

## Topics in this file

**This is the single tracker for everything parked.** The two biggest items each own a
topic, because they are what the score is now capped by:

| Topic                        | What is in it                                                                  | Blocker           |
| ---------------------------- | ------------------------------------------------------------------------------ | ----------------- |
| **§1.1 Packaging**           | npm publishing: `index.d.ts`, module build, `exports`, `CHANGELOG`, changesets | user              |
| **§2 Ingest / `BACKEND.md`** | all six server-side items, and the wire-format defects they gate               | ingest            |
| **§2b Product decisions**    | four defects and three release notes that change customer-visible behaviour    | user              |
| §1.2, §1.3                   | code-splitting; the act of handing `BACKEND.md` over                           | user              |
| §3                           | cross-browser device cloud                                                     | money             |
| §4                           | changesets automation, the two `build.yaml` fixes                              | sequencing / user |
| §5, §6                       | reduced in scope; done, listed so nobody re-parks them                         | —                 |

**Packaging (§1.1) and the ingest work (§2) are the two that matter.** `AUDIT.md` §0a
quantifies them: together they are worth **+5.9 weighted points** and they are the
reason 85 (Mixpanel parity) is not reachable without other people. Everything else on
this list is worth ~1 point or less.

## How to read the blocker column

| Blocker        | Meaning                                                           |
| -------------- | ----------------------------------------------------------------- |
| **user**       | A decision, not code. Nothing technical is in the way.            |
| **ingest**     | Needs the backend/ingest team. `BACKEND.md` is the handover spec. |
| **money**      | Needs a paid account or service.                                  |
| **sequencing** | Only blocked by other work being in flight.                       |

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

**One slice of this is already done.** `ModificationHandler.ts` (D-23) was deleted
2026-08-12 as part of `FRONTEND.md` #6 — 459 LOC imported by nothing, carrying 18 of
the repo's `any` hits.

**It bought zero bytes, and that corrects this item's premise.** Measured: the bundle
is **91,248 bytes either way**, because vite never included an unimported module. So
the "1,644 LOC they never execute" figure below is **not** all payload — the part of
it that is genuinely unimported was already free. **Before spending 2.5 days here,
measure what `choices/**` and the web editor actually contribute to those 91.24 kB**;
the honest saving is whatever is _imported but unused at runtime_, which is a smaller
and harder number than the LOC count implies.

### 1.3 Handing `BACKEND.md` to the ingest team · blocker: user, then ingest

Six items, spec written and ready. Was §0b decision #3.

**Cost of parking: this is the tallest blocker in the programme.** Nothing below in
§2 can start until the handover happens, including the three worst known defects.

---

## 2. Blocked on ingest — the `BACKEND.md` items · blocker: ingest

Parked since 2026-08-11. All six are specified in `BACKEND.md`; the summary is
there, not here. What they unblock on our side:

| #   | Item                                    | Unblocks                                                                                                                                                                                            |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Public, ingest-only project token       | The `sendBeacon` transport leg (D7), so events survive a page the browser is tearing down. Also `FRONTEND.md` #10's last third, and dimension 4 (security), which **cannot exceed ~62 without it**. |
| 2   | Status codes the retry logic can act on | Correct retry classification instead of inference. Dimension 2 caps at ~86 without it.                                                                                                              |
| 2a  | Whether ingest ever sends `Retry-After` | Whether `autoTracker.module.ts:205`'s parse is live code or dead. If live, it needs jittering upward or every client returns in the same second.                                                    |
| 3   | Idempotency on `eventId`                | Lets us **delete** client-side dedupe complexity.                                                                                                                                                   |
| 4   | Confirm `$lib_version` is accepted      | Version stamping on payloads (Phase 1 task 2's deferred half). **Do not ship blind — a rejected payload is dropped events.**                                                                        |
| 5   | A server-controlled brake               | The fourth and last load-shedding mechanism; the other three (jitter §3a, breaker §3b, bounded queue §3c) are done client-side.                                                                     |
| 6   | Regional ingest endpoints               | A real `region: 'us' \| 'eu'` data-residency switch. Today it is `apiHost` only (D26).                                                                                                              |

**The three worst defects in `DEFECTS.md` are in this queue**, because all three
change the wire format:

- **D-1 — no event carries a timestamp.** Ingest attributes every event to its
  _delivery_ moment, so anything queued across a retry, the 60s breaker window, or
  a reload is mis-timed, and intra-session ordering is not recoverable from the
  payload at all. **The most consequential finding in the register.**
- **D-3 — every session event shares one `eventId`**, and the batcher dedupes on
  `eventId`, so session events after the first are droppable by design.
- **D-15 — auto-tracked events carry no `type` field.**

---

## 2b. Blocked on a product decision — customer-visible behaviour · blocker: user

**Parked 2026-08-12.** Each of these is a **one-line code change** and a **multi-line
consequence for existing customers**. None should ship on an engineer's judgement, which
is why they are here rather than in `CHECKPOINT.md` §0b. All four are `asserted` or
`open` in `DEFECTS.md`, so today's behaviour is pinned by a test and a fix will show up
as a failing test to update deliberately.

The shape they share: **the SDK currently accepts something invalid in silence.** Fixing
that means it starts throwing — inside the customer's own page, in code that works today.

### 2b.1 D-18 — the commerce helpers validate nothing

`productAdd`, `productView` and `productOrdered` call **no guard at all**, unlike
`track`/`identify`/`group`/`record`/`alias`/`consent`, which all validate first.
`productAdd(undefined)` builds and sends an event with `data: undefined` rather than
telling the caller anything.

- **Fix:** add the missing guard calls. One line each.
- **Cost of fixing:** any customer currently calling these loosely — passing a partial
  object, or a value from an unvalidated cart payload — gets a **thrown error in their
  page** where they previously got a silently degraded event. In an e-commerce checkout
  handler, an uncaught throw can break the purchase flow. That is a worse failure than
  the bad data.
- **Cost of NOT fixing:** malformed commerce events keep arriving and are only
  discoverable by someone noticing revenue rows with missing fields.
- **Recommended:** fix, but as **warn-through-the-logger, not throw** — the diagnostic
  sink already exists (`onDiagnostic`), so the customer can see the problem without their
  page breaking. Escalate to a throw in a later major, announced.

### 2b.2 D-19 — `identify` and `group` disagree about empty ids

`isIdentifyValid` rejects a falsy `userId` (`!!params.userId`). `isGroupValid` checks only
`undefined`/`null`, so **`group({ accountId: 0 })` and `group({ accountId: '' })` are
accepted** and sent. Two sibling methods, two different contracts, with nothing recording
which is intended.

- **Fix:** make `group` match `identify`. One condition.
- **Cost of fixing:** a customer whose account ids are numeric and can legitimately be
  `0` — an entirely plausible schema — starts getting throws for events that work today.
- **Cost of NOT fixing:** `accountId: ''` produces group events attached to an empty
  account, which is silent data corruption at the account level.
- **Recommended:** same as D-18 — warn, do not throw. **And decide explicitly whether
  `0` is a valid account id**, because that is a data-model question, not a lint one.

### 2b.3 D-20 — `consent.validUntil` is typed required and never validated

`ConsentParams.validUntil` is `number` and non-optional in TypeScript, but no runtime
check exists, so a JavaScript caller can omit it entirely and the consent record is
written with `validUntil: undefined`.

- **Fix:** validate it in `isConsentValid`.
- **Cost of fixing:** **this is the most dangerous of the four to make throw.**
  `consent()` is called from a consent-banner click handler. A throw there can leave the
  banner stuck, which means the visitor cannot give _or_ refuse consent — a compliance
  failure caused by a compliance check.
- **Cost of NOT fixing:** consent records with no expiry. If the retention policy is
  "delete when `validUntil` passes", a record with `undefined` may never expire, or may
  be treated as already expired. **Which of those happens is an ingest question**, so
  this one is partly coupled to §2.
- **Recommended:** warn, never throw, and ask ingest what it does with a missing
  `validUntil` before deciding whether a default is safe.

### 2b.4 D-14 — an untitled `group()` is reported as "Identify"

`GroupModel` falls back to `'Identify'` when no `eventTitle` is given
(`this.name = params.eventTitle ?? 'Identify'`), so an untitled group event is
**indistinguishable from an identify event at ingest**.

- **Fix:** change the fallback to something like `'Group'`.
- **Cost of fixing:** **this one is different from the other three — it changes a value
  that is already in customer reports.** Any saved report, funnel or alert keyed on the
  event name `"Identify"` will silently stop matching those events. It is a data
  migration, not a code change.
- **Cost of NOT fixing:** group and identify events cannot be separated in analysis, and
  nobody looking at the data can tell.
- **Recommended:** **hold until the `BACKEND.md` conversation is happening anyway.**
  Ingest has to be part of this — someone may need to backfill or alias historical
  events — and it should ship with a release note naming the date the meaning changed.

### 2b.5 Three drafted release-note lines, unapproved

In `RELEASE-NOTES-DRAFT.md`, kept separate from the DNT/GPC entry the user approved on
2026-08-12. Each describes a change that **has already landed** on the branch, so these
are not blocking code — they are blocking honest communication:

1. **`intempt:record` / `intempt:product` now carry a real `eventName`** (D-13). Was
   always `''`. Only the browser CustomEvent changed; nothing that reaches ingest.
   Affects customers whose listeners switch on `eventName` or work around the empty
   string.
2. **A second SDK instance now shuts the first one down** (D-2, "last instance wins").
   Previously both ran and every event was sent twice. **A page deliberately running two
   instances — two projects on one page — now loses one**, silently.
3. **A missing credential now throws at init** (D-25) instead of constructing and failing
   later as a 401. Direct-construction only; the script-tag path is unaffected.

**Cost of leaving unapproved:** a customer hits one of these and finds nothing written
down, which is exactly the failure `DEFECTS.md` exists to prevent.

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

### 4.2 Making the dev-dependency audit blocking · ✅ **DONE 2026-08-12**

`ci.yml`'s `audit` job has a blocking half (`--omit=dev`, currently **0**
advisories) and an advisory dev half at `--audit-level=high` (**4**: 1 high, 3
moderate). The remaining high needs vite ≥ 6.4.3, and **every vite ≥ 6 excludes
Node 21** (`engines: ^20.19.0 || >=22.12.0`) — the version `build.yaml` used to deploy
on. **Decision #1 landed and the deploy is now Node 22**, so the vite upgrade is
possible and this item is ready to work; it is listed here only until it is done.
**Closed.** vite went **5.4.21 → 6.4.3**, the tree is now **2 moderate / 0 high**
(from 19 with 8 high and 4 critical at the start of the programme), and `ci.yml`'s
dev-dependency audit is **blocking** at `--audit-level=high` with the
`continue-on-error` removed. Verified: `npm audit --audit-level=high` exits 0. The two
survivors are transitive moderates with no available fix. The production half stays at
`--audit-level=low`, holding the zero-runtime-dependency line.

### 4.3 Fixing `build.yaml`'s branch trigger · blocker: user

Its trigger is `branches: ['*']`, and a single `*` does not match a ref containing
`/`. **Every feature branch with a slash in its name has therefore been completely
ungated for as long as that file has existed** — this branch included. `ci.yml`
uses `['**']`, which is why it fires. The fix is one character; it is parked only
because it means touching the deploy path. **Still open after decision #1** — the
user approved the Node bump specifically and this was deliberately not bundled with
it. The sibling item, `npm install` → `npm ci` in the same file, is open for the same
reason: `install` resolves a fresh tree per run, which is what produced CI failures
#1–2.

---

## 5. Reduced in scope rather than parked

- **`region` enum for data residency** (D26) — shipped as `apiHost` only. Needs
  `BACKEND.md` item 6 before an enum would mean anything.
- **SRI** (§3g-ii) — shipped as a _warning_, not a recommendation, because
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
