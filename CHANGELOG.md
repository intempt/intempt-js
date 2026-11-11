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

### Added

- `onDeliveryFailure(failure)` config listener (INT-7444): called once per batch on its final
  outcome with `{ kind: 'transport' | 'terminal' | 'dropped', status?, eventCount, eventIds,
retryAfter?, terminal }`. Queue-cap overflow reports as `dropped`.
- `track()` and `record()` return `true` when the event was handed to the queue, `false` when
  it was not (opted out). They never throw for a delivery problem.
