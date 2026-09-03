# API reference

Every method listed here lives on `window.intempt` once the SDK has loaded. There is no
constructor to call and nothing to import — see [Installing](#installing).

**There is also a generated reference: `npm run docs:api`** (TypeDoc, output in
`docs/api-generated/`, gitignored). The two are complementary and neither replaces the
other — the generated one is read out of the types, so a changed signature appears in it
without anyone remembering, and it is a CI gate; this one explains what the signatures
_mean_, which no generator produces.

This reference is written against the source, not generated. The validation rules and the
exact error strings below come from `src/intemptJs/guards/intemptJs.guard.ts`, and the
call order from `src/intemptJs/intemptJs.ts`. The error strings are pinned by tests
(`tests/unit/intemptJsGuard.test.ts`), so they are part of the contract you can catch on —
they will not change silently.

- [Installing](#installing)
- [Configuration](#configuration)
- [Two rules that apply to every method](#two-rules-that-apply-to-every-method)
- [Identity: `identify`, `group`](#identity)
- [Events: `track`, `record`](#events)
- [Consent and opt-out: `consent`, `optIn`, `optOut`, `isUserOptIn`](#consent-and-opt-out)
- [Commerce: `productAdd`, `productView`, `productOrdered`](#commerce)
- [Session: `logOut`](#session)
- [Recommendations: `recommendation`](#recommendations)
- [`VERSION`](#version)
- [Reserved event titles](#reserved-event-titles)
- [DOM events the SDK emits](#dom-events-the-sdk-emits)
- [Limitations](#limitations)

---

## Installing

The SDK ships as a self-initialising IIFE on the CDN. **There is no module build today**,
so `npm install intemptjs` followed by `import` will not work: the published package has
no `main`, `module` or `exports` field and nothing to import. The script tag is the
install method.

```html
<!-- 1. Queue stub — lets you call window.intempt.* before the SDK finishes loading -->
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

<!-- 2. The SDK itself -->
<script
  async
  src="https://cdn.intempt.com/v1/intempt.min.js?organization=my-org&project=my-project&source=web-source&key=username.password"
></script>
```

**The `/v1/` path segment is required.** The SDK locates its own `<script>` tag by
searching `document.scripts` for a `src` containing its build-time CDN URL, which is
`https://cdn.intempt.com/v1/intempt.min.js` (`.env.production`). A tag loaded from a URL
without `/v1/` is not recognised, the SDK reads an empty configuration, and the
constructor throws `IntemptJs initialization failed: All config fields must be provided.`
The symptom in the console is `CAN'T FIND SCRIPT`.

For the SRI and CSP directives to pair with this snippet, see
[Security](#hardening-the-embed).

### What the stub does and does not do

The stub records calls and the real instance replays them in order once it loads. Two
consequences:

- **A stubbed call returns nothing.** `isUserOptIn()` returns `undefined` — not `false` —
  when called before the SDK has loaded, and is then replayed pointlessly. Read it only
  after the SDK is live.
- **A stubbed call does not validate, so `try`/`catch` around it catches nothing.** The stub
  records the arguments; validation happens later, during replay. A rejected payload then
  surfaces as `[Intempt] Error replaying queued call <method>` in the console, on the SDK's
  stack rather than yours. Validate anything you care about before the SDK is ready.
- `recommendation()` is the exception: the stub hands back a real `Promise` that resolves
  when the replayed call resolves.

To tell the two apart:

```javascript
function intemptReady() {
  return Boolean(window.intempt) && window.intempt._isStub !== true;
}
```

The SDK removes the stub `<script>` element from the DOM after replaying, so do not look
for that tag as a readiness signal.

## Configuration

Configuration comes from the query string on the SDK's own `<script src>`. There is no
runtime config object.

| Parameter      | Maps to        | Required | Notes                                            |
| -------------- | -------------- | -------- | ------------------------------------------------ |
| `organization` | `organization` | yes      | Organization identifier                          |
| `project`      | `project`      | yes      | Project identifier                               |
| `source`       | `sourceId`     | yes      | The source you are sending events to             |
| `key`          | `writeKey`     | yes      | `username.password` form; split on the first `.` |
| `shopify`      | `shopify`      | no       | Enabled by **presence** — see below              |
| `magento`      | `magento`      | no       | Enabled by **presence** — see below              |

`shopify` and `magento` are read with `!!searchParams.get(...)`, so **any non-empty value
turns them on**. `&shopify=0` and `&shopify=false` both _enable_ Shopify tracking. The
only way to disable either is to omit the parameter.

If any of the four required parameters is absent from the URL it is read as the empty
string, and the constructor throws:

```
IntemptJs initialization failed: All config fields must be provided.
```

## Two rules that apply to every method

**1. Opt-out silences everything except `recommendation`.** Every tracking method begins
with an `isUserOptIn()` check and returns immediately if the visitor has opted out. No
event is queued, no error is raised, nothing is logged. `recommendation()` has no such
check and still calls the API while opted out — if that matters for your consent posture,
gate the call yourself.

**2. Validation throws; it does not warn.** Invalid arguments raise an `Error` from inside
your own call, on your own stack. If a bad payload must not break the page, wrap the call:

```javascript
try {
  window.intempt.track({ eventTitle: 'Checkout Started', data: { cartId } });
} catch (err) {
  reportToYourOwnLogger(err);
}
```

The message strings below are exact. Checks run in the order listed, and the order is
itself part of the contract — the first failing check is the one that throws.

---

## Identity

### `identify(params)`

Associates the current visitor with a user ID you control. Call it as soon as you know who
someone is, and on every subsequent page load while they remain signed in.

```javascript
window.intempt.identify({ userId: 'user_123' });

window.intempt.identify({
  userId: 'user_123',
  eventTitle: 'User Registration',
  userAttributes: { email: 'user@example.com', plan: 'premium' },
  data: { signupSource: 'homepage' },
});
```

| Field            | Type     | Required | Notes                                                                                          |
| ---------------- | -------- | -------- | ---------------------------------------------------------------------------------------------- |
| `userId`         | `string` | yes      | Must be **truthy**. `''`, `0`, `null` and `undefined` are all rejected.                        |
| `eventTitle`     | `string` | no       | Required if you pass `userAttributes`. Must not be a [reserved title](#reserved-event-titles). |
| `userAttributes` | `object` | no       | Profile attributes. Requires `eventTitle`.                                                     |
| `data`           | `object` | no       | Event properties. Does **not** require `eventTitle`.                                           |

Checks, in order:

1. `params` missing, `null`, or an empty object →
   `Parameters for the 'identify' method are required.`
2. `eventTitle` present and reserved →
   `The '<eventTitle>' event title is forbidden`
3. `userId` falsy →
   `Identify parameters are invalid: 'userId' is required.`
4. `userAttributes` present without `eventTitle` →
   `Identify parameters are invalid: set 'eventTitle' to use 'userAttributes'.`

Note that the reserved-title check runs _before_ the `userId` check: a call with both a
reserved title and no `userId` reports the title.

### `group(params)`

Associates the visitor with an account, company or workspace.

```javascript
window.intempt.group({
  accountId: 'company_acme',
  eventTitle: 'Account Updated',
  accountAttributes: { name: 'Acme Corp', plan: 'enterprise' },
});
```

| Field               | Type     | Required | Notes                                                                              |
| ------------------- | -------- | -------- | ---------------------------------------------------------------------------------- |
| `accountId`         | `string` | yes      | Rejected only if `undefined` or `null`. **`''` and `0` are accepted** — see below. |
| `eventTitle`        | `string` | no       | Required if you pass `accountAttributes`. Must not be reserved.                    |
| `accountAttributes` | `object` | no       | Account attributes. Requires `eventTitle`.                                         |

Checks, in order:

1. Empty `params` → `Parameters for the 'group' method are required.`
2. `eventTitle` reserved → `The '<eventTitle>' event title is forbidden`
3. `accountId` `undefined`/`null` → `Group parameters are invalid: 'accountId' is required.`
4. `accountAttributes` without `eventTitle` →
   `Group parameters are invalid: set 'eventTitle' to use 'accountAttributes'.`

**`group` and `identify` disagree on empty IDs.** `identify` rejects a falsy `userId`;
`group` accepts `accountId: ''` and `accountId: 0`. If your account IDs can be numeric or
blank, validate them before calling — the SDK will not.

---

## Events

### `track(params)`

The general-purpose custom event. Both fields are mandatory.

```javascript
window.intempt.track({
  eventTitle: 'Newsletter Signup',
  data: { listId: 'weekly', source: 'footer' },
});
```

| Field        | Type     | Required | Notes                                                    |
| ------------ | -------- | -------- | -------------------------------------------------------- |
| `eventTitle` | `string` | yes      | Rejected if `undefined` or `null`. Must not be reserved. |
| `data`       | `object` | yes      | Must be a **non-empty** object.                          |

Checks, in order:

1. Empty `params` → `Parameters for the 'track' method are required.`
2. `eventTitle` `undefined`/`null` → `Track parameters are invalid: eventTitle is required.`
3. `eventTitle` reserved → `The '<eventTitle>' event title is forbidden`
4. `data` missing, `null`, or `{}` → `Track parameters are invalid: 'data' can't be empty.`

`eventTitle: ''` passes step 2. If you need an event with no properties, use `record`
rather than inventing a filler `data` key.

### `record(params)`

Like `track`, but `data` is optional and user or account context can ride along on the same
call.

```javascript
window.intempt.record({
  eventTitle: 'Feature Used',
  userId: 'user_123',
  accountId: 'company_acme',
  data: { feature: 'dashboard_export' },
});
```

| Field               | Type     | Required |
| ------------------- | -------- | -------- |
| `eventTitle`        | `string` | yes      |
| `accountId`         | `string` | no       |
| `userId`            | `string` | no       |
| `accountAttributes` | `object` | no       |
| `userAttributes`    | `object` | no       |
| `data`              | `object` | no       |

Checks, in order:

1. Empty `params` → `Parameters for the 'record' method are required.`
2. `eventTitle` `undefined`/`null` → `Record parameters are invalid: eventTitle is required.`
3. `eventTitle` reserved → `The '<eventTitle>' event title is forbidden`

That is all of it. Unlike `identify` and `group`, `record` does **not** require an
`eventTitle` alongside `userAttributes`/`accountAttributes` — but it does require
`eventTitle` unconditionally, so the situation cannot arise.

---

## Consent and opt-out

Two separate mechanisms, easy to confuse:

- `optOut()` / `optIn()` change whether the SDK collects anything at all. This is the
  switch.
- `consent()` **records a consent decision as an event**. It does not stop tracking. A
  `consent({ action: 'reject' })` call sends an event saying the visitor declined; if you
  also want collection to stop, call `optOut()`.

### `optOut()`, `optIn()`, `isUserOptIn()`

```javascript
window.intempt.optOut(); // stop collecting
window.intempt.optIn(); // resume
window.intempt.isUserOptIn(); // -> boolean; true by default
```

Tracking is **on by default**. The opt-out flag is persisted to `localStorage` under
`intempt_do_not_track`, so it survives reloads. `optIn()` writes too, so an opt-out is not
a one-way door.

Storage failures are swallowed by design — `optOut()` will not throw back into a consent
banner's click handler even in Safari private mode or under a full quota. In that case the
flag still holds for the current page but is lost on reload.

**`localStorage` is origin-scoped**, so an opt-out on `www.example.com` does not carry to
`shop.example.com`. If you serve one product across subdomains you must call `optOut()`
on each origin yourself. A shared cookie at the registrable domain is not implemented.

### `consent(params)`

```javascript
window.intempt.consent({
  action: 'accept',
  validUntil: Date.now() + 365 * 24 * 60 * 60 * 1000,
  email: 'user@example.com',
  category: 'analytics',
});
```

| Field        | Type                   | Required  | Notes                                                            |
| ------------ | ---------------------- | --------- | ---------------------------------------------------------------- |
| `action`     | `'accept' \| 'reject'` | yes       | **Case-sensitive.** `'Accept'` is rejected.                      |
| `validUntil` | `number`               | see below | Declared required in the type, but **not validated** at runtime. |
| `email`      | `string`               | no        |                                                                  |
| `message`    | `string`               | no        |                                                                  |
| `category`   | `string`               | no        |                                                                  |

Checks, in order:

1. Empty `params` → `Parameters for the 'consent' method are required.`
2. `action` `undefined`/`null` → `Consent parameters are invalid: action is required.`
3. `action` is anything other than `'accept'` or `'reject'` →
   `Consent parameters are invalid: action should be either "reject" or "accept".`

`validUntil` is typed as required and TypeScript will insist on it, but a plain JavaScript
call that omits it succeeds and sends the event without it. Do not rely on the SDK to
catch that.

Also note: `consent()` is itself gated on the opt-out check. Calling it while opted out is
a silent no-op, so a "re-consent" flow that runs after `optOut()` must call `optIn()`
first or the decision is never recorded.

---

## Commerce

None of the three commerce methods validate their arguments. They check the opt-out flag
and send. A malformed payload reaches ingest.

```javascript
window.intempt.productAdd({ productId: 'prod_123', quantity: 2 });
window.intempt.productView('prod_123'); // a plain string
window.intempt.productOrdered([
  // an array
  { productId: 'prod_123', quantity: 2 },
  { productId: 'prod_456', quantity: 1 },
]);
```

| Method                     | Argument                          | Event title sent  |
| -------------------------- | --------------------------------- | ----------------- |
| `productAdd(product)`      | `{ productId, quantity? }`        | `Added to cart`   |
| `productView(productId)`   | `string`                          | `Product viewed`  |
| `productOrdered(products)` | `Array<{ productId, quantity? }>` | `Product ordered` |

The argument shapes are inconsistent — one object, one bare string, one array. That is
history, not design. Read the table before writing the call.

On Shopify stores loaded with `&shopify=1`, product views and add-to-cart are also
detected automatically, so calling `productAdd` yourself there can double-count.

---

## Session

### `logOut()`

Resets the profile and session state so the next events are attributed to a new anonymous
visitor. Call it when a user signs out; otherwise the next person on a shared machine
inherits the previous profile.

```javascript
window.intempt.logOut();
```

Takes no arguments, validates nothing, and is a no-op while opted out. It also emits
`intempt:logOut`.

---

## Recommendations

### `recommendation(params)` → `Promise`

Fetches items from a feed. Asynchronous, and the only method that is **not** gated on the
opt-out flag.

```javascript
const items = await window.intempt.recommendation({
  id: 123,
  quantity: 10,
  fields: ['productId', 'name', 'price', 'image'],
});
```

| Field      | Type       | Required | Notes                     |
| ---------- | ---------- | -------- | ------------------------- |
| `id`       | `number`   | yes      | Feed ID                   |
| `quantity` | `number`   | yes      | Sent as `limit`           |
| `fields`   | `string[]` | yes      | Fields to return per item |

Nothing here is validated. The request also sends the current `profileId`, your
`sourceId`, and the `productId` last seen in `localStorage`.

**Error behaviour, precisely.** A network-level failure resolves to `null`. A response
whose body is not JSON — an HTML error page from a proxy, or a `401` with an empty body —
**rejects** the returned promise rather than resolving to `null`, because the body parse
happens outside the SDK's `try`/`catch`. Handle both:

```javascript
let items = null;
try {
  items = await window.intempt.recommendation({
    id: 123,
    quantity: 10,
    fields: ['productId'],
  });
} catch {
  items = null;
}
if (items) render(items);
```

---

## `VERSION`

```javascript
window.intempt.VERSION; // e.g. '6.0.0'
```

The build-time SDK version, stamped from `package.json`. Useful in a bug report. It is
**not** on the queue stub, so reading it before the SDK loads gives `undefined` — which
doubles as a readiness check.

---

## Reserved event titles

These titles are rejected, case-insensitively, on `track`, `record`, `identify` and
`group`:

| Reserved title | Why                                                              |
| -------------- | ---------------------------------------------------------------- |
| `auto-track`   | Marks events the SDK generated itself rather than ones you sent. |
| `view page`    | Emitted by the automatic page-view tracker.                      |
| `leave page`   | Emitted on page exit, and carries time-on-page.                  |
| `change on`    | Emitted on form-field changes.                                   |
| `click on`     | Emitted on clicks.                                               |
| `submit on`    | Emitted on form submits.                                         |
| `identify`     | Reserved for the identity stream.                                |
| `consent`      | Reserved for the consent stream.                                 |

They are reserved because the platform routes and reports on them as its own primitives.
An event you send under one of these names would be indistinguishable from an automatic
one, which corrupts every derived metric built on it — page-view counts, session
duration, funnel steps, consent audit trails. So the SDK refuses rather than letting the
mix happen quietly.

**Matching is exact on the whole title, not a substring.** `'consent banner shown'` and
`'identify user'` are both accepted. Case is ignored, so `'CLICK ON'` and `'View Page'`
are both rejected.

The error is:

```
The '<the title you passed>' event title is forbidden
```

Note the case asymmetry: `identify` and `group` only check the title _if you passed one_,
since it is optional there. `track` and `record` always check.

---

## DOM events the SDK emits

Every event the SDK sends is also dispatched as a `CustomEvent` on `window`, so you can
mirror analytics into your own tooling without patching the SDK.

| Event              | `detail`                       | Fired by                                            |
| ------------------ | ------------------------------ | --------------------------------------------------- |
| `intempt:event`    | `{ event }` — the full payload | **every** event, automatic and manual               |
| `intempt:track`    | `{ eventName }`                | `track()`                                           |
| `intempt:identify` | `{ eventName }`                | `identify()`                                        |
| `intempt:group`    | `{ eventName }`                | `group()`                                           |
| `intempt:record`   | `{ eventName }`                | `record()`                                          |
| `intempt:consent`  | `{ eventName }`                | `consent()`                                         |
| `intempt:product`  | `{ eventName }`                | `productAdd()`, `productView()`, `productOrdered()` |
| `intempt:logOut`   | `{ eventName: 'Log Out' }`     | `logOut()`                                          |
| `intempt:page`     | `{ eventName }`                | automatic page view / page leave                    |
| `intempt:session`  | `{ eventName }`                | automatic session start                             |
| `intempt:html`     | `{ eventName }`                | automatic click / change / submit                   |
| `intempt:shopify`  | `{ eventName }`                | Shopify tracker                                     |

```javascript
window.addEventListener('intempt:event', (e) => {
  myLogger.debug('intempt sent', e.detail.event);
});
```

`intempt:event` carries the payload; the per-type events carry only a name. These fire at
dispatch time, which is before the event is delivered — a listener firing is not proof of
delivery.

---

## Limitations

Stated up front so you do not find them after integrating.

| Limitation                                                   | Detail                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CDN install only**                                         | No module build, no `main`/`module`/`exports`, no published types. `import` does not work.                                                                                                                                                                 |
| **The `/v1/` path is load-bearing**                          | The SDK finds its own script tag by matching the full CDN URL. A different path means no configuration.                                                                                                                                                    |
| **No public ID getters**                                     | Profile, session and page IDs are attached internally. There is no `getProfileId()`.                                                                                                                                                                       |
| **Consent is origin-scoped**                                 | `localStorage`, so opt-out does not cross subdomains.                                                                                                                                                                                                      |
| **`recommendation` ignores opt-out**                         | It calls the API regardless. Gate it yourself if needed.                                                                                                                                                                                                   |
| **Blocked on localhost**                                     | Tracking is blocked on `localhost`, `*.localhost` and `127.0.0.1`, and for bot user agents. See [examples/README.md](../examples/README.md) for how to develop against this.                                                                               |
| **The write key is in the page**                             | It is a query parameter on a public script URL and is sent as an HTTP Basic credential. Treat it as a write-only public key, scope it to one source, and rotate it if it is used for anything else.                                                        |
| **`shopify`/`magento` cannot be disabled by value**          | `=0` and `=false` enable them. Omit the parameter.                                                                                                                                                                                                         |
| **A bad config fails as silence, not as an error you catch** | The constructor throws inside the SDK's own async bootstrap, so `window.intempt` stays the queue stub. Your calls keep succeeding and queue forever; nothing is ever sent. Check the console for `IntemptJs initialization failed` or `CAN'T FIND SCRIPT`. |

### Hardening the embed

The SDK bundle at `/v1/intempt.min.js` is a **mutable** path: it is overwritten in place on
release rather than versioned per build. Two consequences for your CSP and SRI setup:

- **Do not pin `integrity` on the CDN URL.** A subresource-integrity hash will start
  failing — and silently disable your analytics — the next time the bundle is republished.
  If you need SRI, self-host a copy you control at a URL you version yourself, and pin the
  hash of that.
- A workable CSP is `script-src 'self' https://cdn.intempt.com;` plus
  `connect-src https://api.intempt.com;`. The SDK also injects DOM changes for
  experiences, which needs `style-src` to permit whatever your experiences use.

---

## See also

- [USAGE.md](../USAGE.md) — the narrative guide, task by task
- [TypeScript quickstart](TYPESCRIPT.md) — types you can copy today
- [Migration guide](MIGRATION.md)
- [React](integrations/REACT.md) · [Next.js](integrations/NEXTJS.md) · [Vue](integrations/VUE.md)
- [examples/](../examples/) — runnable pages
