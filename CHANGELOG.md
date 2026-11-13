# Changelog

## 7.0.0 — unreleased

### Changed (behaviour)

- **BREAKING:** consent records follow the same send-once rules as events. A 503 or 429 gets
  one resend after `Retry-After` (clamped to 1–60 s); every other status the server answers
  drops the record. A record that never reached the server is kept in memory (up to 100) and
  retried every 5 s. Each lost record is logged at error level and reported once to the
  `onDeliveryFailure` listener with `eventCount: 1` and `eventIds: []`; `consent()` still
  never throws for a delivery problem. It used to send once and only log a failure.
- The in-memory fallback path (used when the persistent queue cannot start) no longer sends on
  every `track()` while a failed batch waits: the batch is retried after 5 s, or after
  `Retry-After` for a 503/429, and events dropped by its 1,000-event cap are reported as
  `dropped`.
- Delivery failures (INT-7436): every batch is sent once. A 503 or 429 gets one resend after
  `Retry-After` (clamped to 1–60 s, 1 s when absent); a second failure drops the batch. Every
  other status the server answers (400, 401–404, 408, 413, 500, 502, 504, …) and a timeout after
  the request was written drop the batch. Only a send that never reached the server (offline,
  DNS, connection refused) keeps the batch for the next flush. The exponential backoff, the
  circuit breaker and the 413 batch halving are removed, and a fetch our own timeout aborted is
  no longer resent over XHR. `getDiagnostics().breakerState` now always reads `closed`.
- `allFlags()` sends `exposure: false`: it evaluates without recording an exposure (INT-7456).
  Read a value you render with `variation()`, which records it. Needs the audience-service
  change that reads the field; an older backend ignores it and records as before.

- "Session start" is dispatched in the same call that opens the session, so it is queued
  before the event that opened it (INT-7446). Until the browser's UA client hints resolve,
  it carries the user-agent-string platform.

### Added

- `window.intempt.onFlagError(listener)` and public
  `variationDetail(key, context, default, options?)` (INT-7454): a failed flag request
  reports `{ key, kind: 'auth' | 'bad_request' | 'server' | 'timeout' | 'network' | 'parse',
status? }`, and `variationDetail` returns `reason: 'error'`
  with that error. The default is still returned. A 401/403 is logged at error level once per
  instance, naming the source id.
- `variation(key, context, default, { disableExposure: true })` evaluates without recording an
  exposure, for a pre-render or prefetch read (INT-7456).

- `window.intempt.onDeliveryFailure(listener)` (INT-7444): the listener is called once per
  batch on its final outcome with `{ kind: 'transport' | 'terminal' | 'dropped', status?,
eventCount, eventIds, retryAfter?, terminal }`. Queue-cap overflow drops the oldest events not on the wire and reports them as `dropped`.
- Both listeners are registered on the live instance, not through the script src, and not on
  the queue stub. A later call replaces the listener; `null` removes it. See
  [Failure listeners](docs/API.md#failure-listeners).
- **BREAKING:** `track()` and `record()` return `true` when the event was handed to the queue,
  `false` when it was not (opted out). They never throw for a delivery problem.
