# Migration guide

What to change if you integrated with an older snippet, and what is coming that will change
the install again.

Nothing on this page is speculative except the clearly marked
[Forthcoming](#forthcoming-the-module-build) section. Each item below is a change that already
happened in the shipped SDK.

- [Read this first: the CDN path is mutable](#read-this-first-the-cdn-path-is-mutable)
- [1. Add `/v1/` to the script URL](#1-add-v1-to-the-script-url)
- [2. Add the queue stub](#2-add-the-queue-stub)
- [3. `getProfileId()` was removed](#3-getprofileid-was-removed)
- [4. Opt-out now persists across reloads](#4-opt-out-now-persists-across-reloads)
- [5. `VERSION` is available](#5-version-is-available)
- [6. Queued events now survive a reload differently](#6-queued-events-now-survive-a-reload-differently)
- [7. `alias()` was removed](#7-alias-was-removed)
- [Forthcoming: the module build](#forthcoming-the-module-build)
- [Checklist](#checklist)

---

## Read this first: the CDN path is mutable

`https://cdn.intempt.com/v1/intempt.min.js` is **overwritten in place** on release. It is not
a versioned artifact, and there is no per-version URL to pin.

Two things follow, and they shape how you should plan any migration:

- **You cannot stay on an old build by not migrating.** Whatever is at `/v1/` is what your
  visitors run. The changes below are already on your pages; migrating means updating _your_
  integration to match, not choosing a version.
- **Do not pin an SRI `integrity` hash on that URL.** It will start failing the next time the
  bundle is republished, and a failed SRI check silently disables your analytics. If you need
  SRI, self-host a copy at a URL you version yourself.

Check what your visitors actually have with `window.intempt.VERSION` in the browser console.

## 1. Add `/v1/` to the script URL

**If your script tag looks like this, it is broken:**

```html
<!-- WRONG — the SDK will not start -->
<script
  async
  src="https://cdn.intempt.com/intempt.min.js?organization=…"
></script>
```

```html
<!-- Correct -->
<script
  async
  src="https://cdn.intempt.com/v1/intempt.min.js?organization=…"
></script>
```

**Why it matters.** The SDK reads its configuration from the query string on its own
`<script>` tag, and it finds that tag by scanning `document.scripts` for a `src` containing its
build-time CDN URL — which includes `/v1/`. A tag on any other path is not recognised, so the
SDK reads an empty configuration and the constructor throws.

**How it fails.** Not with an error you can catch. The console shows `CAN'T FIND SCRIPT` and
then `IntemptJs initialization failed: All config fields must be provided.`, `window.intempt`
stays a queue stub, and every call you make succeeds and queues forever. **No events are
sent, and nothing in your code notices.** If your data went quiet without a deploy on your
side, check this first.

## 2. Add the queue stub

Older integrations loaded the SDK script alone and wrapped calls in a readiness check, or
worse, called `window.intempt.track(...)` and hoped. Add the stub _before_ the SDK script:

```html
<script>
  (function () {
    if (window.intempt) return;
    var queue = [],
      pending = [];
    var methods = [
      'identify',
      'group',
      'track',
      'record',
      'consent',
      'productAdd',
      'productOrdered',
      'productView',
      'logOut',
      'optIn',
      'optOut',
      'isUserOptIn',
      'recommendation',
    ];
    var stub = { _isStub: true, _queue: queue, _pendingPromises: pending };
    methods.forEach(function (m) {
      stub[m] = function () {
        var args = [].slice.call(arguments);
        if (m === 'recommendation') {
          return new Promise(function (resolve, reject) {
            pending.push({ resolve: resolve, reject: reject });
            queue.push({ method: m, args: args });
          });
        }
        queue.push({ method: m, args: args });
      };
    });
    window.intempt = stub;
  })();
</script>
```

The SDK detects the stub, replays the queue in order, resolves any pending
`recommendation()` promises FIFO, and removes the stub's `<script>` element from the DOM.

**What this lets you delete:** readiness polling, `if (window.intempt)` guards around
tracking calls, and any `setTimeout` you added to work around events lost during page load.

**Two things the stub does not do**, so do not delete these:

- **It does not return values.** `isUserOptIn()` through the stub returns `undefined`, not
  `false`. Any code that reads it — painting a consent toggle, most commonly — still has to
  wait for the real SDK. Detect that with `window.intempt._isStub !== true`.
- **It does not validate.** A `try`/`catch` around a stubbed call catches nothing; the
  validation happens later during replay, and the error surfaces in the console as
  `[Intempt] Error replaying queued call <method>`.

If you keep a custom stub of your own, note the SDK looks for the queue under `_queue`,
`_stubQueue`, `queue` or `__queue`, and pending promises under `_pendingPromises` only.

## 3. `getProfileId()` was removed

`window.intempt.getProfileId()` existed between 2025-09 and 2026-04 and is **gone**. Calling
it now throws `TypeError: window.intempt.getProfileId is not a function`.

There is no replacement. Profile, session and page IDs are assigned internally and attached to
every outbound event; no getter exposes them.

**What to do instead**, depending on why you were reading it:

| You were using it to                        | Do this instead                                                                                                                                    |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Join SDK events to your own backend records | Call `identify({ userId })` with an ID **you** control, and join on that. This is more robust anyway — the profile ID does not survive `logOut()`. |
| Correlate a support ticket with a session   | Listen for `intempt:event` and log `e.detail.event` into your own tooling, which includes the IDs.                                                 |
| Pass the ID to a server-side API call       | Same: capture it from an `intempt:event` payload. Treat the shape as unstable — it is internal and has changed within the 6.x line.                |

```javascript
// Capturing the IDs yourself, if you genuinely need them
let lastPayload = null;
window.addEventListener('intempt:event', (e) => {
  lastPayload = e.detail.event;
});
```

## 4. Opt-out now persists across reloads

`optOut()` used to set an in-memory flag, so **a visitor who opted out started being tracked
again on their next page load**. It now writes to `localStorage` under
`intempt_do_not_track`, and `optIn()` writes too, so an opt-out is not a one-way door.

**If you built a workaround, remove it.** The common one was storing your own consent flag and
calling `optOut()` on every page load from your own bootstrap. That still works, but it is now
redundant, and if it runs _before_ your consent UI has resolved it can fight the SDK's own
state.

**Two behaviours to know now that it is real state:**

- **It is origin-scoped.** `localStorage` does not cross subdomains, so an opt-out on
  `www.example.com` does not apply on `shop.example.com`. If you serve one product across
  subdomains you must call `optOut()` on each origin. A shared cookie at the registrable
  domain is not implemented.
- **Storage failures are swallowed.** In Safari private mode or under a full quota the write
  fails silently, the flag holds for the current page, and it is lost on reload. `optOut()`
  will not throw back into a consent banner's click handler — which is what you want there,
  but it does mean you cannot detect the failure.

Also worth correcting if your consent flow assumed otherwise: **`consent()` does not stop
tracking.** It records the visitor's decision as an event. A reject flow needs
`consent({ action: 'reject' })` _then_ `optOut()` — in that order, because `consent()` is
itself gated on the opt-out flag and would be silently dropped if you opted out first.

## 5. `VERSION` is available

```javascript
window.intempt.VERSION; // e.g. '6.0.0'
```

Previously the version existed only as a string literal inside the bundle. It now comes from
`package.json` at build time and is exposed on the instance. Put it in bug reports; the
mutable CDN path means "the latest" is not a useful answer to "which version are you on".

It is **not** on the queue stub, which makes it a convenient readiness check.

## 6. Queued events now survive a reload differently

Pending events used to be held in `localStorage` as a single JSON array. They are now stored
in **IndexedDB** where available (with a permanent per-page fallback to `localStorage`), as one
record per event.

**You do not need to do anything.** Events sitting in the old format are migrated on first
read, once, and the legacy key is deleted.

This matters to you only if you were reading the SDK's storage directly — inspecting
`localStorage` in a debugging script, or clearing a specific key. Those reads will find
nothing now. There is no supported API for reading the pending queue; use the `intempt:event`
listener to observe what the SDK sends.

---

## 7. `alias()` was removed

`window.intempt.alias({ userId, anotherUserId })` is **gone**. Calling it now throws
`TypeError: window.intempt.alias is not a function`. The `AliasParams` type is removed from
the TypeScript definitions, and the `intempt:alias` DOM event is no longer dispatched.

**There is nothing to replace it with, because identity resolution is the platform's job.**
Intempt already merges profiles server-side: if two identities ever share any identifier — the
same device, the same email, the same phone — they converge on one profile without anyone
declaring the link. `alias()` only ever added reach for two user IDs that share nothing at
all, which is an ID-scheme migration, not something an integration should call.

It was also unsafe in a way that was easy to miss. A wrong `alias()` call permanently fuses
two real people into one profile, and there is no unmerge.

| You were using it to                                              | Do this instead                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Link an anonymous visitor to the user they became at signup       | Nothing. Call `identify({ userId })` as usual — the SDK stamps the anonymous profile ID on that event, so the pre-signup history follows automatically. This already worked; `alias()` was never required for it. |
| Attach a second ID you hold for a known user (CRM ID, billing ID) | Send it as a user attribute: `identify({ userId, eventTitle, userAttributes: { crm_id } })`. Email and phone attributes are resolution keys in their own right.                                                   |
| Migrate an entire user base from an old ID scheme to a new one    | Ask Intempt to run it as a server-side backfill. A bulk re-keying is not a client-side operation.                                                                                                                 |

If you had a `try`/`catch` around an `alias()` call, remove the call — the `TypeError` is
thrown synchronously and an unremoved call will surface in your own stack.

## Forthcoming: the module build

**None of this exists today. Do not write code against it yet.** It is here so you can plan,
and so you do not build something that the change will invalidate.

Planned:

- A module build exporting a side-effect-free `createIntempt(config)`, alongside the current
  self-initialising IIFE for the script-tag install.
- `main` / `module` / `exports` / `types` / `sideEffects` in `package.json` — deliberately
  absent today because there is nothing importable to point at.
- A hand-authored public `.d.ts`, so the declarations you maintain yourself today
  ([TYPESCRIPT.md](TYPESCRIPT.md)) become unnecessary.
- A `CHANGELOG.md` and a written deprecation policy.

When it lands, `npm install intemptjs` plus an import becomes a supported install and
configuration moves from URL query parameters into code. The script-tag install is not going
away.

**What to do now so that migration is cheap:** put a wrapper module between your app and
`window.intempt` — see
[`examples/typescript/analytics.ts`](../examples/typescript/analytics.ts). When the module
build arrives you change one file instead of every call site. That is the whole
recommendation, and it is worth doing for its own sake: the wrapper also gives you a no-op
when the SDK is blocked and an error boundary around validation that otherwise throws inside
your click handlers.

---

## Checklist

Run through this against a page that has the SDK on it:

1. Does the script `src` contain `/v1/`?
2. Is the queue stub present, and **before** the SDK script?
3. Are all four of `organization`, `project`, `source`, `key` filled in? An empty one stops
   the SDK with no catchable error.
4. Does the console show `CAN'T FIND SCRIPT`, `IntemptJs initialization failed`, or
   `[Intempt] Tracking blocked by guard conditions`? Each has a distinct cause — wrong path,
   bad config, and a guard (localhost or a bot user agent) respectively.
5. Does `window.intempt._isStub` come back `undefined`, and `window.intempt.VERSION` a
   version string? If `_isStub` is still `true` after a few seconds, the SDK never took over.
6. Any call to `getProfileId()` or `alias()` left in your code?
7. Any of your own opt-out-on-every-load workaround left in your bootstrap?
8. Does your consent flow call `consent()` **before** `optOut()`?
9. Any SRI `integrity` attribute on the CDN URL? Remove it or self-host.
10. Are you tracking route changes yourself in a SPA? Page views are already automatic through
    the History API — you are probably double-counting.

## See also

- [API reference](API.md) — exact validation rules and error strings
- [USAGE.md](../USAGE.md) — the narrative guide
- [TypeScript quickstart](TYPESCRIPT.md)
- [React](integrations/REACT.md) · [Next.js](integrations/NEXTJS.md) · [Vue](integrations/VUE.md)
