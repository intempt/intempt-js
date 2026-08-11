# Release notes — draft for the hardening release

> **Status: draft, not published.** There is no `CHANGELOG.md` and no changesets
> setup yet — that is `BACKLOG.md` 1.1 (packaging), which is parked. This file
> holds the customer-facing wording until there is somewhere real to put it, so the
> one behaviour change in this release is not communicated from memory.
>
> **The only entry here that changes existing behaviour is the first one.**
> Everything else in the hardening programme is additive or internal. Approved for
> release-note inclusion by the user, 2026-08-12.

---

## ⚠️ Browser privacy signals are now honoured by default

**What changed.** The SDK now respects two browser privacy signals it previously
ignored: **Do Not Track** (`navigator.doNotTrack`) and **Global Privacy Control**
(`navigator.globalPrivacyControl`). When a visitor's browser sends either signal,
the SDK stops sending events for that visitor.

**Why.** GPC is a legally recognised opt-out under the California Consumer Privacy
Act as amended by the CPRA, and under the Colorado Privacy Act. Ignoring it is a
compliance exposure rather than a product choice. This matches the default in
`mixpanel-browser`.

**What you will see.** **Your event volume will drop slightly**, with no change on
your side. The size of the drop depends on your audience:

- Do Not Track is a minority Firefox setting; Safari removed it in 2019.
- GPC is enabled by default in Brave and DuckDuckGo, and by Firefox's
  Enhanced Tracking Protection in strict mode.
- Expect **low single-digit percent** for a typical consumer site, and more for a
  privacy-conscious or developer audience.

The drop is in *collected events*, not in your existing data — historical numbers
are unaffected, so a year-on-year comparison spanning the upgrade date will show a
step, not a re-baselining.

**If you run a consent management platform.** If you already collect and log
explicit consent, that consent can legitimately take precedence over a generic
browser signal. Add `&ignore_dnt=1` to your SDK script URL to restore the previous
behaviour:

```html
<script src="https://cdn.intempt.com/v1/intempt.min.js?org=YOUR_ORG&source=YOUR_SOURCE&ignore_dnt=1"></script>
```

One switch covers both signals deliberately. Two switches would invite honouring
Do Not Track while ignoring GPC, which is the one combination with no legal
justification.

**Notes on how it behaves**, in case you are reconciling numbers:

- A browser signal **outranks a stored opt-in**. A visitor who previously opted in
  and now sends GPC is not tracked.
- The signal is **not persisted** and is **not cleared by `optIn()`**. It is a
  live browser setting, not a visitor decision, and is held separately from stored
  consent so that `optIn()` cannot override a legally binding signal.
- The diagnostic notice fires **once per page**, not once per event.

---

## Also in this release — no action needed

These are additive; none changes what you receive today.

- **Consent now works across subdomains.** An opt-out recorded on
  `shop.example.com` is honoured on `www.example.com`, via a cookie at your
  registrable domain. Visitors who opted out under a previous version are carried
  over automatically. The mechanism can only ever *widen* an opt-out, never
  narrow one.
- **Optional PII scrubbing**, off by default. Enable with `&pii_scrubbing=1`.
- **Optional API host override** for data-residency requirements:
  `&api_host=…`.
- **Delivery is more resilient under load** — jittered retries, a circuit breaker
  that stops hammering an ingest tier that is down, and a bounded queue with a
  reported drop count instead of silent loss at the storage quota.
- **Events now persist in IndexedDB** where available, rather than localStorage
  only: no ~5 MB cap and no synchronous writes blocking your page's main thread.
- **`IntemptJs.VERSION`** and `window.intempt.VERSION` now report the SDK version.

---

## Known issues we are being explicit about

Recorded here because a customer reconciling data will hit them, and finding them
undocumented is worse than finding them listed. Full register: `DEFECTS.md`.

- **Events are timestamped on arrival, not on occurrence** (D-1). An event that was
  queued through a retry or a page reload is attributed to when it reached us.
  Fixing this changes the wire format and is in progress with the ingest team.
- **Two copies of the snippet on one page send every event twice** (D-2). Check for
  a duplicate install — including a SPA that re-initialises on route change.
- **`?shopify=false` enables Shopify tracking** (D-17). Omit the parameter to
  disable it; do not set it to `false` or `0`.
