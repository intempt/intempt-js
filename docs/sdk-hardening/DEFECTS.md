# DEFECTS — found, documented, not fixed

> **Why this file exists.** The five parallel lanes (2026-08-11) found ~30 real
> defects while writing tests and docs. Fixing them inside those lanes would have
> mixed unreviewed behaviour changes into test and documentation commits, so the
> rule was: **assert the current behaviour, name the defect, move on.** This is
> the register. Without it these findings existed only in one conversation.
>
> Nothing here is a regression introduced by the programme. These are pre-existing
> and, in most cases, shipped.
>
> **Status key:** `asserted` = a test pins today's behaviour, so a fix will show up
> as a failing test to update deliberately. `open` = observed, no test.
> `fixed` = corrected, listed for the record.
>
> **2026-08-12: THIRTEEN defects were fixed in one day** by nine parallel lanes —
> D-2, D-4, D-5, D-6, D-7, D-8, D-9, D-10, D-11, D-12, D-17, D-22, D-23, plus D-27
> which was found and fixed the same day. See `CHECKPOINT.md` §3n and §3o.
> **What remains is mostly the wire-format group** (D-1, D-3, D-15), which is blocked
> on the ingest team, plus D-13/14/16/18/19/20/21/24/25/26.

---

## Severity 1 — customer data is wrong, lost, or duplicated

### D-1. No event carries a timestamp · `asserted`
All 8 models have the `timestamp` line **commented out**. Events sit in the queue
across the 60s circuit-breaker window, exponential backoff, and page reloads, so
ingest attributes each to its *delivery* moment. Intra-session ordering is not
recoverable from the payload at all.
**Most consequential finding in the set.** Belongs in the same ingest conversation
as `$lib_version` (`BACKEND.md` item 4) because it changes the wire format.
Golden fixtures in `tests/unit/__golden__/payload/` record the current shape.

### D-2. A second `IntemptJs` instance duplicates every event · `fixed` 2026-08-12 — teardown + static `_activeInstance`; a second instance disposes the first ("last instance wins"). Needs a release-note line: it silently stops a first instance.
`AutoTrackerModule` subscribes to `document` with **no teardown**, so a second
instance double-sends. A fresh instance per test produced **14 consent POSTs for
one `consent()` call**. Real-world triggers: two copies of the snippet on a page,
or a SPA re-running init on route change.

### D-3. `session.model.ts:14` — `eventId: sessionId` · `asserted`
Every session event in a visit shares one id, and the batcher **dedupes on
eventId** (§4 defect 1). Session events after the first are therefore droppable
by design.

### D-4. `recommendation()` has no opt-out check · `fixed` 2026-08-12 — `recommendation()` is now gated on opt-out.
`intemptJs.ts:302`. The only public method where `optOut()` fails to stop an
identifier leaving the page. Privacy exposure, not just a data bug.

### D-5. `consent()` is gated on the opt-out flag · `fixed` 2026-08-12 — recording a consent decision is an audit record, not tracking, so it survives `optOut()`. Only `isConsentValid` can stop it.
`optOut()` then `consent({action:'reject'})` **silently discards the record of the
refusal** — a GDPR audit-trail hazard. The reverse order breaks re-consent.
Documented as a required call order in `USAGE.md` (opt-out *after* recording), but
the ordering trap is still there.

### D-6. One malformed choice discards every choice · `fixed` 2026-08-12 — per-item isolation; one malformed choice no longer discards the rest.
`choices.service.ts:31`, `choicesDataGuard` does `acc.push(...item.changes)`
unguarded. A single bad entry in the response means the visitor gets **no**
experiences.

### D-7. `markPointersFromChanges` takes down the whole batch · `fixed` 2026-08-12 — same isolation in the pointer-marking pass.
Runs at `choices.module.ts:40`, **outside** the per-change `try/catch` at 53–62,
so any throw means no experiences render at all. Three ways to throw:
- a change with no `xPathSelector` → `document.evaluate(undefined)`
- an `iwe` id that is not a legal attribute name → `InvalidCharacterError` (`:99`)
- only the first id per element is marked (`:89–102`), so a container referenced
  by two changes silently skips the second

### D-8. `style`/`update`/`insert` are async and never awaited · `fixed` 2026-08-12 — async handlers are awaited, so failures reach the try/catch.
`choices.module.ts:52–62`. The synchronous `catch` cannot see their failures, so
the "Error applying change of type" diagnostic **never fires for 3 of the 4 live
types**, and failures surface as unhandled rejections in the customer's page.

### D-9. `pagesTracker` — `popstate` fires the exit twice · `fixed` 2026-08-12 — `popstate` no longer fires the exit twice.
`init()` registers a `popstate` listener (`:45`) that does `end(); safeStart()`,
and `_patchHistoryForSpa()` registers another (`:67`) that dispatches
`locationchange`, handled at `:50` with `end(); safeStart()` again. `start()`
dedupes on identical href; **`end()` does not.** Every back/forward navigation
emits **two `Leave Page` events and one `View Page`**.

### D-10. `pagesTracker` — `replaceState` to an unchanged URL emits an orphan exit · `fixed` 2026-08-12 — a no-op `replaceState` no longer emits an orphan exit.
Same asymmetry. Frameworks that `replaceState` to sync query params (Next.js,
`router.replace`, `navigate(…, {replace:true})`) produce a stream of exit events
with no matching views — inflating exit counts and corrupting time-on-page.

### D-11. No `hashchange` listener · `fixed` 2026-08-12 — a `hashchange` listener was added, so hash-routed SPAs are tracked.
Hash-only routers emit **no page views at all**.

---

## Severity 2 — wrong or misleading behaviour, contained blast radius

### D-12. The documented install snippet was broken · `fixed`
`README.md` / `USAGE.md` shipped `https://cdn.intempt.com/intempt.min.js` with no
`/v1/`. That never matches `getCdnLink()`, so the SDK logs `CAN'T FIND SCRIPT`,
reads an empty config, and the constructor throws inside `main.ts`'s async
bootstrap — `window.intempt` is never replaced, every call succeeds against the
queue stub, and **nothing is ever sent**. Anyone who copied the docs verbatim got
a silently dead integration.
**Docs are fixed. Still to do: check real host sites for the `/v1`-less URL.**

### D-13. `_name` returns `''` for record and product · `asserted`
`record.model.ts:29`, `product.model.ts:26`. `intempt:record` and
`intempt:product` announce an **empty** `eventName` to customer listeners. Wire
payload is unaffected.

### D-14. `GroupModel` defaults its name to `'Identify'` · `asserted`
`group.model.ts:12`. An untitled `group()` is indistinguishable from an identify
at ingest.

### D-15. Auto-tracked events carry no `type` field · `asserted`
All 7 manual models set one. Ingest cannot classify on `type`.

### D-16. `consent()` computes a `pageId` and throws it away · `asserted`
`intemptJs.ts:213` passes it to a model with no such field.

### D-17. `?shopify=false` and `?shopify=0` both **enable** Shopify tracking · `fixed` 2026-08-12 — `shopify`/`magento` use the real boolean parser, so `?shopify=false` disables.
Read via `!!searchParams.get()`, so any present value is true. Pre-existing; the
new privacy switches deliberately did **not** inherit this pattern.

### D-18. Commerce methods validate nothing · `asserted`
`intemptJs.ts:229/250/272` — `productAdd`/`productView`/`productOrdered` call no
guard and send whatever they are given.

### D-19. `identify` and `group` disagree on empty ids · `asserted`
`identify` rejects a falsy `userId`; `group` accepts `accountId: 0` and `''`.

### D-20. `consent.validUntil` is typed required, never validated · `open`

### D-21. `window.__intemptGuardManager` is effectively unusable · `open`
Assigned during module evaluation, but the guard decision resolves in microtasks
immediately after, so no later `<script>` can affect it. Either document it as
internal or make the bootstrap await a hook.

### D-22. `choices.service.ts:164` — `async` function as a Promise executor · `fixed` 2026-08-12 — the `async` Promise executor no longer swallows throws.
A throw inside is swallowed instead of rejecting. Surfaced by ESLint.

---

### D-27. `apiHost` treats an empty query value as a value · `fixed` 2026-08-12
`src/loaders/sdkLoader.ts:72-89` used `?? undefined` for `apiHost` while the four
required fields use `?? ''`. So `?api_host=` with an **empty** value arrived as `''`
rather than `undefined`, and `resolveIngestBaseUrl` received an empty string instead
of falling through to the build-time default — a data-residency option that
misbehaves precisely when someone clears it. Found by the lane that raised
`sdkLoader.ts` from 9.67% to ~71% coverage, which is the argument for that coverage
work in one sentence. Fixed so an empty value is treated as absent.

## Severity 3 — dead code, hygiene, test-only

### D-23. `ModificationHandler.ts` is dead code · `fixed` — deleted 2026-08-12
459 LOC implementing 7 mutation types, **imported by nothing**. The live engine is
`WebEditorModificationHandler` (4 types), and the two use incompatible
element-addressing conventions, so it could not simply be re-enabled.

**Correction, measured at deletion: it was never in the shipped bundle.** This entry
previously implied it was ("shipped"), and `FRONTEND.md` #9 and a test comment both
asserted ~459 LOC reaching every customer. **Wrong.** `dist/intempt.min.js` is
**91,248 bytes with the file present and 91,248 bytes with it deleted**, and
`typography` — a type name unique to the dead class — appears **0 times** in the
bundle either way. Vite's IIFE build only includes reachable modules, so an
unimported file costs zero bytes. Verify a bundle claim against the bundle; "it is
in `src/`" does not mean "customers download it".

The deletion was still right — 459 unmaintained lines, 18 of the repo's `any` hits,
and ~517 lines of tests pinning behaviour nothing could invoke — but the reason is
maintenance and honesty, **not** payload. Do not carry the byte argument forward.

### D-24. `isValidConfig`'s caller is dead code · `asserted`
**This corrects an earlier note in `CHECKPOINT.md` §4**, which said `optIn`/
`optOut` throw on a misconfigured instance and wanted a one-line guard. Wrong on
its premise: `isValidConfig` (`intemptJs.guard.ts:24`) only ever throws or returns
literal `true`, so `if(!this.isValidConfig(config)) return;` at `intemptJs.ts:42`
is unreachable — a misconfigured `new IntemptJs()` **throws** rather than yielding
an instance with `_autoTracker` undefined. **Do not ship that guard.** The real
issue is the unreachable branch. Three tests record this.

### D-25. `isValidConfig` checks `=== ''`, so a *missing* field passes · `asserted`
Unreachable from the URL path (`?? ''` supplies empty strings), reachable by
direct construction.

### D-26. `tests/unit/setup.ts` cookie teardown misses domain-scoped cookies · `open`
The privacy suites clear their own state rather than changing shared setup. A
future cookie test that forgets to will leak into the next file.

---

## How to work through this list

Do **not** batch these into one "fix the defects" commit. Each severity-1 item
changes what customers receive, and several (D-1, D-3, D-15) change the wire
format, which means they need the ingest conversation first — the same one
`BACKEND.md` items 3 and 4 are waiting on.

Suggested order:

1. **D-2** (duplicate instance) and **D-9/D-10/D-11** (page tracker) — pure
   client-side, no wire change, and they corrupt the most common metrics.
2. **D-4, D-5** — privacy correctness; these fail an audit, not just a report.
3. **D-6, D-7, D-8** — the experiences engine currently fails all-or-nothing.
4. **D-1, D-3, D-15** — wire format; needs ingest sign-off.
5. **D-23** — delete, and take the bundle win with `FRONTEND.md` #9.

Each `asserted` item has a test that will fail when you fix it. That is intended:
the failing test is the specification, and updating it is how the fix gets
reviewed.
