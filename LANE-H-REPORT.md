# Lane H — transport fallback chain

Base: `e71a356`. Branch: `lane-h-transport`.

## Commit

1. `feat(transport): add fetch(keepalive) -> XHR fallback chain to AutoTrackerTransport`
   — split `_sendBatchRequest` into `_sendViaFetch` (returns a `BatchSendResult`
   for any delivered HTTP response, or `null` when the transport itself failed
   to deliver: `fetch` throwing or an abort with nothing received) and
   `_sendViaXHR` (async, event-based, no `sendBeacon`). Falls back to XHR only
   when `fetch` is missing or `_sendViaFetch` returns `null`; any real HTTP
   response (400/413/500/etc.) returns immediately and never reaches XHR, so
   `requestBatcher.ts`'s failure/recovery classification and circuit breaker
   are untouched — one `BatchSendResult` per call either way.

## Tests added — `tests/unit/autoTrackerTransport.test.ts` (4 new)

- fetch succeeds -> XHR never constructed
- fetch rejects (stubbed to actually throw) -> XHR succeeds -> single success result
- fetch rejects AND XHR fails -> single failure result (`httpStatusCode: 0`), not two
- fetch resolves 400 -> XHR never constructed, 400 passed through unchanged

## Gates

1. `npm run build` — clean. `dist/intempt.min.js`: **93245 B** (was 92548, **+697 B** — the fallback leg + guard code; expected, no other files touched).
2. `npm run test:unit` — **924/924 passed** (27 files; was 920/26).
3. `npm run test` (Cypress) — **122/122 passed**.
4. `npm run test:mutation` — **86.57%** (unchanged from pre-existing baseline; `requestBatcher.ts` 88.19% unaffected — new code is in `autoTracker.transport.ts`, not mutation-scanned as a hot file but covered by the 4 new unit tests exercising every branch).
5. `npx eslint src/intemptJs/modules/autoTracker/autoTracker.transport.ts tests/unit/autoTrackerTransport.test.ts` — **0 warnings** (fixed one no-op expression during authoring).

## Not done / out of scope

- `sendBeacon` leg — explicitly excluded per instructions (blocked on backend auth support, D7/BACKEND.md #1).
- Did not touch `requestBatcher.ts`, `package.json`, or any DO-NOT-TOUCH path.
