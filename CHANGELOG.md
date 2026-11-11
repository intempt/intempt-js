# Changelog

## Unreleased

### Changed (behaviour)

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

### Added

- `onFlagError(error)` config hook and public `variationDetail(key, context, default, options?)`
  (INT-7454): a failed flag request reports `{ key, kind: 'auth' | 'bad_request' | 'server' |
'timeout' | 'network' | 'parse', status? }`, and `variationDetail` returns `reason: 'error'`
  with that error. The default is still returned. A 401/403 is logged at error level once per
  instance, naming the source id.
- `variation(key, context, default, { disableExposure: true })` evaluates without recording an
  exposure, for a pre-render or prefetch read (INT-7456).

- `onDeliveryFailure(failure)` config listener (INT-7444): called once per batch on its final
  outcome with `{ kind: 'transport' | 'terminal' | 'dropped', status?, eventCount, eventIds,
retryAfter?, terminal }`. Queue-cap overflow reports as `dropped`.
- `track()` and `record()` return `true` when the event was handed to the queue, `false` when
  it was not (opted out). They never throw for a delivery problem.
