# BACKEND — work the SDK needs from ingest

> Handover document. Every item here is **blocked on backend work** and is
> therefore backlogged on the SDK side (user decision, 2026-08-11). Nothing in
> this file can be built client-first.
>
> Ordered by what unblocks the most SDK work per unit of backend effort.
>
> **Shareable rendering for the backend team:**
> https://claude.ai/code/artifact/82bd5a93-23fe-49e5-b371-ae3fae3acd56 — republish
> to that same URL after editing this file, or the two will diverge. **This file
> is the authority.**

---

## 1. Public, ingest-only project token — unblocks `sendBeacon`

**Today:** the write key is split on `.` and `btoa`-encoded into an
`Authorization: Basic` header in the browser.

Two consequences, one security and one reliability, with a single root cause:

1. A write credential is visible in devtools on every customer page.
2. It **forces `fetch`**, because `sendBeacon` cannot set headers — and
   `sendBeacon` is the only transport the spec guarantees survives page teardown.
   This is why events are lost on tab close, worst on Safari and mobile Safari.

### The migration surface is five call sites and four endpoints, not one

Re-audited 2026-08-11. The original version of this document cited only the
batch-track site, which understated the work on both sides: a token that only
`/track` accepts would leave four credentialed `fetch` calls behind, and the
client would then carry _both_ auth schemes indefinitely.

| Call site                                   | Endpoint                                        |
| ------------------------------------------- | ----------------------------------------------- |
| `autoTracker.module.ts:178` (header `:193`) | `…/sources/<id>/track` — batch, the hot path    |
| `autoTracker.module.ts:433` (header `:441`) | `…/sources/<id>/track` — second, non-batch path |
| `autoTracker.module.ts:395` (header `:402`) | `…/projects/<p>/consents/data`                  |
| `intemptJs.ts:306` (header, near `:319`)    | `…/projects/<p>/feeds/<id>/data`                |
| `choices.service.ts:56` (request at `:194`) | `…/optimization/choose-web`                     |

**What this asks of you:** the new token needs to be accepted on **all four
endpoints**, not just ingest — or tell us which of them should keep `Basic` and
why, and we will scope the client change to match. Note that `feeds/…/data` and
`choose-web` are **reads**, so "ingest-only scope" is not sufficient for them as
written; they likely need either a second scope or a deliberate decision that
they stay on the authenticated path. **This is the one open design question in
this document that we cannot answer client-side.**

Only the two `/track` sites need `sendBeacon`, so the transport work depends on
the first two rows alone. The other three are the security finding only.

### What is _not_ blocked on you — recorded so the split is clear

Client-side leftovers we will fix regardless of the token decision: an unguarded
`console.error('credentials not found')` at `choices.service.ts:94` (every other
diagnostic in the SDK is gated on `EnvConfig`), and the absent SRI/CSP guidance
for the embed snippet in the customer docs. Neither reduces the finding above —
the credential is in the request, not only in a log line.

**What we need:**

- A new credential type: a token scoped to **event ingest only** for one
  org/project/source. No read access, no admin authority. Public by design, like
  Mixpanel's project token — so appearing in page source stops being a finding.
- The token must be accepted **off the header** — in the request body preferred
  (`{ token, track: [...] }`), or the URL path. Query string is a last resort:
  it lands in access logs and `Referer`.
- **Accept `text/plain` bodies and parse them as JSON.** Non-negotiable for
  beacons: any other content type forces a CORS preflight, and a preflight will
  not complete during page teardown. CORS must allow the simple request.
- **Rate limits per token, per IP, and per-project quotas.** The token is public,
  so server-side abuse control replaces the credential's former secrecy. This is
  the actual security control in the new model — it is not optional hardening.
- **Dual-accept `Authorization: Basic` during a deprecation window.** This matters
  more here than usual: the CDN path is mutable and there is no rollback
  artifact, so we cannot assume old embedded snippets ever update.
- **Rotation and revocation**, with multiple concurrently-valid tokens per source
  so rotation does not require a synchronised client update.

**Unblocks:** the transport fallback chain (`sendBeacon` → `fetch(keepalive)` →
XHR), which is Phase 3 item 3 and the fix for unload event loss. See D7.

---

## 2. Status codes the retry logic can act on

The SDK's backoff, batch-halving and dequeue decisions all key off the response,
and we have already fixed one bug where an ambiguous answer caused **silent data
loss** (D17). Required semantics:

| Status              | SDK behaviour                                                        |
| ------------------- | -------------------------------------------------------------------- |
| 2xx                 | accepted — dequeue                                                   |
| 400                 | permanently bad payload — drop, do not retry                         |
| 413                 | too large — halve the batch and retry; a single-event 413 is dropped |
| 429 + `Retry-After` | back off for exactly that long                                       |
| 5xx                 | retryable — exponential backoff                                      |

Anything that is not a definite answer is treated as "not delivered" and retried.

### 2a. Open question — does ingest actually send `Retry-After`?

**We need a yes/no plus the conditions.** The SDK parses the header
(`autoTracker.module.ts:205`) and honours it verbatim over its own backoff, but
nobody has confirmed `…/sources/<id>/track` ever emits it. It may be dead code.

Why it matters: as of 2026-08-11 the SDK applies **full jitter** to its own
exponential backoff, so a fleet failing together now spreads its retries instead
of arriving as one spike. `Retry-After` is the one path still unjittered, because
it is an explicit server instruction. But if ingest tells 1M clients "come back in
30s", all 1M return in the same 30th second — reintroducing exactly the
thundering herd the jitter removed, only now server-scheduled and synchronised
more tightly than the client ever was.

So:

1. Does `/track` emit `Retry-After`? On which statuses — 429 only, or 503 too?
2. If yes, we intend to treat it as a **floor jittered upward**
   (`retryAfter + random(0, retryAfter * 0.2)`) — never returning sooner than
   asked, but not in a synchronised block either. **Confirm that is acceptable**,
   i.e. that the value means "not before T" rather than "exactly at T".
3. If ingest would rather control the spread itself, the alternative is for the
   server to vary the per-client `Retry-After` value. Either works; it should be
   one or the other, not both, or the delays compound.

---

## 3. Idempotency on `eventId` — would let us delete client complexity

Every payload already carries a stable `eventId`. If ingest deduplicates on it,
the whole at-most-once / at-least-once tension in D13 and D18 disappears: the SDK
can dequeue optimistically, and the pre-send marking, its rollback, and the
unload ambiguity handling can all be simplified away.

**This is the highest-value item on the list after the token itself**, because it
removes client code rather than adding it — and client code is the part we cannot
patch quickly, given the mutable CDN path.

---

## 4. Confirm `$lib_version` is accepted on the payload

The SDK version is already single-sourced and exposed as `Intempt.VERSION`, but
it is **not** stamped onto outbound events, because that changes the wire format
posted to `…/sources/<id>/track`. If ingest validates strictly, an unknown field
means rejected batches — dropped events for every customer, which is worse than
the missing forensics it was meant to fix.

**Needed:** confirmation that an unknown top-level field is tolerated, or the name
ingest would prefer. See D12.

---

## 5. A server-controlled brake for load shedding

Framing: at 1–10M concurrent sessions the SDK is a load-shaping device, and its
most important property during an incident is that it **must not amplify**.

The SDK can and will do its own share client-side (jitter, circuit breaker,
bounded queue with an explicit drop policy — none of which need you). But the
only mechanism that lets you shed load **from the server side** during an
incident is a directive in the ingest response: a sample rate, a pause duration,
or a kill switch. Without it, your only lever is refusing connections, which
clients then retry against.

**Suggested shape:** an optional object on the ingest response, e.g.
`{ "control": { "sampleRate": 0.1, "pauseMs": 60000 } }`. The SDK ignores it
until implemented, so it can ship server-first.

---

## 6. Regional ingest endpoints — unblocks a real data-residency switch

The SDK now takes an explicit ingest host override
(`IntemptConfig.apiHost`, script URL `&api_host=`), validated to https and used for
event and consent ingest. That is the plumbing for data residency, and it works
today against any host you stand up.

**What is missing is the hosts.** `.env.production` and `.env.development` both
point at `api.intempt.com/v1`; there is no EU endpoint. So the SDK deliberately
does **not** offer a `region: 'us' | 'eu'` config option, because an enum that
accepts `'eu'` and falls back to a US host tells a customer they are compliant
while sending their data to the United States — a worse outcome than not having
the feature (see D26).

**What we need from you, in order:**

1. Whether a regional ingest deployment is planned, and where.
2. The canonical base URLs, so the SDK can ship a `region` shorthand mapping to
   them rather than making every customer paste a host.
3. Whether a write key issued in one region is valid in another, or whether keys
   are region-scoped. This decides whether a wrong `api_host` fails as a 401 (loud,
   good) or silently accepts data in the wrong jurisdiction (the failure mode that
   matters).
4. Whether the choices/experience API (`choices.service.ts`) would also be
   regionalised. It is not routed by `apiHost` today, on the assumption that
   experience delivery and event ingest would move together.

**Effort shape for us: small** — a lookup table plus a config option. The work is
entirely yours.

---

## Summary

| #   | Item                                                                                                                       | Unblocks                                                       | Effort shape                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| 1   | Public ingest-only token, accepted off-header, `text/plain`, rate-limited — **on all four credentialed endpoints, see §1** | `sendBeacon`; fixes unload loss **and** the credential finding | New credential type + auth path on 4 endpoints  |
| 2   | Retry-actionable status codes                                                                                              | Correct backoff; prevents silent loss                          | Mostly confirmation                             |
| 3   | Idempotency on `eventId`                                                                                                   | Lets us **remove** client complexity                           | Ingest dedupe store                             |
| 4   | Accept `$lib_version`                                                                                                      | Incident forensics                                             | Confirmation, likely no code                    |
| 5   | Load-shedding directive in the response                                                                                    | Server-side control during an incident                         | Small, ship server-first                        |
| 6   | Regional ingest endpoints (and whether write keys are region-scoped)                                                       | A real data-residency switch, not just a host override         | Regional deployment; SDK side is a lookup table |

Items 1–2 are the minimum to unblock the SDK's reliability work.
