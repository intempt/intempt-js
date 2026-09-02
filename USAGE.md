# Using IntemptJS

IntemptJS is a drop-in browser SDK for the [Intempt](https://intempt.com) platform. Add
one script tag and it starts tracking page views, sessions, and clicks automatically.
From there you can identify users, send custom events, manage consent, track commerce
events, and fetch recommendations — all through `window.intempt`.

This guide walks through the common things you'll actually do.

---

## 1. Add the SDK to your site

Add **two** snippets to your page `<head>`, in this order:

1. A small **queue stub** so you can call `window.intempt.*` right away — calls are
   buffered until the SDK is ready.
2. The **SDK script, loaded with `async`** so it never blocks page rendering. When it
   loads it takes over `window.intempt` and replays anything you queued.

There's no constructor — your account settings go in the SDK URL's query parameters.

```html
<!-- 1. Queue stub -->
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
      'alias',
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

<!-- 2. Load the SDK asynchronously -->
<script
  async
  src="https://cdn.intempt.com/v1/intempt.min.js?organization=my-org&project=my-project&source=web-source&key=username.password"
></script>
```

> **The `/v1/` path segment is required.** The SDK reads its configuration from the query
> string on its own `<script>` tag, and finds that tag by matching this exact URL. Loaded from
> any other path it reads an empty configuration and refuses to start — the console shows
> `CAN'T FIND SCRIPT` followed by `IntemptJs initialization failed`. `window.intempt` then
> stays a queue stub, so your calls keep succeeding and no events are ever sent. If you are
> upgrading an older snippet, check this first: see the
> [migration guide](docs/MIGRATION.md#1-add-v1-to-the-script-url).

| Parameter      | What it is                                                              |
| -------------- | ----------------------------------------------------------------------- |
| `organization` | Your organization identifier                                            |
| `project`      | Your project identifier                                                 |
| `source`       | Source ID (`sourceId`) you're sending data to                           |
| `key`          | Your API key, in `username.password` form                               |
| `shopify`      | Shopify tracking — add `&shopify=1` to enable, omit to disable          |
| `magento`      | Magento product detection — add `&magento=1` to enable, omit to disable |

> **`shopify` / `magento` are enabled by presence.** Including the parameter with any
> non-empty value turns it on; to disable, leave it out entirely. Note that `&shopify=0`
> or `&shopify=false` will **not** disable it — only omitting the parameter does.

Once the SDK loads it takes over **`window.intempt`**, replays any queued calls in
order, and begins auto-tracking. With the stub in place you can safely call
`window.intempt.*` anywhere on the page, even before the SDK has finished downloading.

Two things the stub cannot do for you, both of which matter in practice:

- **It returns nothing.** `isUserOptIn()` called through the stub gives back `undefined`, not
  `false`. Anything that reads a value — painting a consent toggle, most often — has to wait
  for the real SDK. Test with `window.intempt._isStub !== true`, or read
  `window.intempt.VERSION`, which only the real SDK has.
- **It does not validate.** A `try`/`catch` around a stubbed call catches nothing; validation
  happens later, during replay, and a rejected payload surfaces in the console as
  `[Intempt] Error replaying queued call …` rather than on your stack.

> **Heads up — tracking is off on localhost.** By default the SDK blocks tracking on
> `localhost` / `127.0.0.1` and for bot/crawler user agents. So if nothing shows up
> while developing locally, that's expected — test on a real (or staging) domain.

### 1a. Content Security Policy

If your site sends a `Content-Security-Policy` header, the SDK needs these
directives. Everything below is what the SDK actually contacts — there are no
other origins.

```
script-src  'self' https://cdn.intempt.com;
connect-src 'self' https://api.intempt.com;
img-src     'self' data: https://cdn.intempt.com;
style-src   'self' 'unsafe-inline';
```

| Directive                             | Why the SDK needs it                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `script-src https://cdn.intempt.com`  | Where the SDK bundle is served from. Also the origin of the visual web editor, which the SDK loads on demand.                |
| `connect-src https://api.intempt.com` | Event ingest and the recommendations API.                                                                                    |
| `img-src data:`                       | Inline image data used by rendered experiences.                                                                              |
| `style-src 'unsafe-inline'`           | **Only if you use experiences/recommendations that restyle the page.** If you use the SDK for event tracking alone, drop it. |

Two practical notes:

- **The queue stub in step 1 is an inline `<script>`.** Under a CSP without
  `'unsafe-inline'` it will be blocked, which silently loses every call made before
  the SDK finishes loading. Give it a nonce (`<script nonce="…">`, matching
  `script-src 'nonce-…'`) or move it to a file you serve yourself. Do **not** add
  blanket `'unsafe-inline'` to `script-src` just for this.
- **Test with `Content-Security-Policy-Report-Only` first.** A too-strict policy
  doesn't produce an error you'll notice — it produces missing analytics data.

### 1b. Subresource Integrity (SRI) — read this before you add one

SRI (`integrity="sha384-…"`) tells the browser to refuse a script whose bytes don't
match a hash you pinned, which protects you if the CDN is ever compromised. You
compute it from the exact file you intend to run:

```bash
curl -s https://cdn.intempt.com/v1/intempt.min.js \
  | openssl dgst -sha384 -binary \
  | openssl base64 -A
```

```html
<script
  async
  crossorigin="anonymous"
  integrity="sha384-<the hash from above>"
  src="https://cdn.intempt.com/v1/intempt.min.js?organization=my-org&project=my-project&source=web-source&key=username.password"
></script>
```

> **⚠️ Today this will break your site at our next release, and you should know that
> before you deploy it.** `https://cdn.intempt.com/v1/intempt.min.js` is a **mutable**
> URL: each release overwrites that same path in place. There is no versioned,
> immutable URL to pin yet. So a hash that is correct now stops matching the moment we
> publish an update, and the browser's response to a mismatch is to refuse to execute
> the script at all — the SDK simply stops loading, with no fallback and no warning
> beyond a console message.
>
> **So:** if your security policy requires SRI, contact Intempt support for an
> immutable versioned URL rather than pinning `/v1`. If you pin `/v1` anyway, treat it
> as something you must update on every Intempt release, and monitor for the SDK
> failing to load.

`crossorigin="anonymous"` is required alongside `integrity` — without it the browser
cannot verify a cross-origin response and blocks the script.

---

## 2. What gets tracked automatically

You don't have to wire anything up for the basics. Out of the box the SDK records:

- **Page views** — on first load and on every SPA route change (`pushState`,
  `replaceState`, back/forward). **Hash-only routers are not covered**: the SDK hooks the
  History API and does not listen for `hashchange`, so a router that navigates by assigning
  `location.hash` emits no page view. See [`examples/spa/`](examples/spa/index.html).
- **Page exits** — including time spent on the page.
- **Sessions** — a session starts and is kept alive as the visitor interacts.
- **Clicks, form changes, and form submits** — for any element on the page.

When someone clicks an element or submits a form, the SDK captures useful context:
the element's tag, `id`, classes, visible text, link target, where it sits in the page
(a CSS-selector path), and—on submit—the submitted form field values.

### Keeping sensitive text out of events

Some on-screen values shouldn't be sent to analytics (account numbers, balances,
personal info shown on a button or field). Add the **`doNotCapture`** attribute and the
SDK masks that element's captured text as `********`:

```html
<button doNotCapture>Show balance: $12,500</button>
<span doNotCapture>john.doe@private.com</span>
```

Password inputs (`<input type="password">`) are masked automatically — you don't need
to add anything.

> `doNotCapture` masks the **text/value** captured when an element is clicked or
> changed. It doesn't hide the element's tag, id, or classes, and it doesn't strip
> values submitted through a form — so avoid relying on it for whole-form secrecy.

---

## 3. Identify your users

When you know who someone is (after login, signup, etc.), tell Intempt:

```javascript
window.intempt.identify({ userId: 'user_123' });
```

Attach attributes by also giving the event a title (a title is required whenever you
send `userAttributes`):

```javascript
window.intempt.identify({
  userId: 'user_123',
  eventTitle: 'User Registration',
  userAttributes: { email: 'user@example.com', plan: 'premium' },
  data: { signupSource: 'homepage' },
});
```

If the same person was anonymous before logging in, link the two IDs with `alias`:

```javascript
window.intempt.alias({ userId: 'anon_abc', anotherUserId: 'user_123' });
```

To associate the user with a company/account, use `group`:

```javascript
window.intempt.group({
  accountId: 'company_acme',
  eventTitle: 'Account Updated', // required when sending accountAttributes
  accountAttributes: { name: 'Acme Corp', plan: 'enterprise' },
});
```

---

## 4. Send custom events

Use `track` for things your users do. `data` is required and can't be empty:

```javascript
window.intempt.track({
  eventTitle: 'Newsletter Signup',
  data: { listId: 'weekly', source: 'footer' },
});
```

`record` is similar but lets you attach user/account context inline and doesn't require
`data`:

```javascript
window.intempt.record({
  eventTitle: 'Feature Used',
  userId: 'user_123',
  accountId: 'company_acme',
  data: { feature: 'dashboard_export' },
});
```

**Reserved titles:** these event titles are used internally and will throw if you try
to use them — `auto-track`, `view page`, `leave page`, `change on`, `click on`,
`submit on`, `identify`, `consent` (case-insensitive).

---

## 5. Track commerce events

```javascript
// Added to cart
window.intempt.productAdd({ productId: 'prod_123', quantity: 2 });

// Viewed a product  (note: this one takes a plain string)
window.intempt.productView('prod_123');

// Completed order  (takes an array)
window.intempt.productOrdered([
  { productId: 'prod_123', quantity: 2 },
  { productId: 'prod_456', quantity: 1 },
]);
```

On Shopify stores (with `&shopify=1`), product views and add-to-cart are also detected
automatically.

---

## 6. Respect consent & opt-out

Tracking is **on by default**. Let users turn it off (and back on):

```javascript
window.intempt.optOut(); // stop all tracking
window.intempt.optIn(); // resume
window.intempt.isUserOptIn(); // -> true / false
```

While opted out, every tracking call (automatic and manual) quietly does nothing. The flag is
persisted to `localStorage`, so it survives reloads — but `localStorage` is **origin-scoped**,
so an opt-out on `www.example.com` does not carry to `shop.example.com`. Across subdomains you
must call `optOut()` on each origin yourself.

Record an explicit consent decision for GDPR/CCPA flows:

```javascript
window.intempt.consent({
  action: 'accept', // or 'reject'  (case-sensitive)
  validUntil: Date.now() + 365 * 24 * 60 * 60 * 1000, // e.g. 1 year
  email: 'user@example.com',
  category: 'analytics',
});
```

> **`consent()` does not stop tracking.** It sends an event recording what the visitor chose.
> `optOut()` is the switch. A reject flow needs both — and **in this order**, because
> `consent()` is itself gated on the opt-out flag and would be silently dropped if you opted
> out first:
>
> ```javascript
> window.intempt.consent({ action: 'reject', validUntil: expiry }); // record it
> window.intempt.optOut(); // then stop collecting
> ```
>
> The mirror applies on re-consent: call `optIn()` _before_
> `consent({ action: 'accept' })`, or the acceptance is never recorded.

A runnable version of both flows is in
[`examples/consent-banner/`](examples/consent-banner/index.html).

### Consent now follows the visitor across your subdomains

An opt-out used to be stored per-origin, so someone who opted out on
`www.example.com` was tracked again on `shop.example.com`. Consent is now also written
to a cookie at your registrable domain (`.example.com`), so one opt-out covers every
subdomain. Nothing to configure.

Two details worth knowing:

- On `localhost` and IP addresses a domain cookie is invalid, so the cookie is
  host-only there. Consent still persists; it just doesn't cross hosts, which on
  `localhost` it never could.
- If a visitor blocks cookies, `localStorage` still carries the decision — it just
  stays per-origin, as before.

### Re-asking after a policy change

`optOut()` records a refusal and `optIn()` records consent. To go back to _"never
asked"_ — so your banner shows again — clear the decision:

```javascript
window.intempt.clearConsent(); // forget the stored decision entirely
window.intempt.hasExplicitlyOptedIn(); // -> true only after an explicit optIn()
```

`hasExplicitlyOptedIn()` is **not** the inverse of `isUserOptIn()`. Tracking is on by
default, so a visitor who has never been asked reports `isUserOptIn() === true` and
`hasExplicitlyOptedIn() === false`. That third state is what tells your banner whether
to appear.

### Browser privacy signals: Do Not Track and Global Privacy Control

The SDK honours **Do Not Track** (`navigator.doNotTrack`) and **Global Privacy
Control** (`navigator.globalPrivacyControl`). When either is on, no data is sent —
regardless of what the visitor clicked on your banner, because GPC is a legally
recognised opt-out signal under CCPA/CPRA.

If you run your own consent management platform and its explicit, logged consent
should take precedence, add `&ignore_dnt=1` to the SDK script URL:

```html
<script
  async
  src="https://cdn.intempt.com/v1/intempt.min.js?organization=…&ignore_dnt=1"
></script>
```

> This switch disables **GPC as well as DNT**. Setting it moves the obligation to
> honour GPC onto you.

### Redacting PII before it leaves the browser

Off by default. Add `&pii_scrubbing=1` to the script URL and the SDK redacts, in event
payloads only:

- values of obviously sensitive field names (`email`, `phone`, `password`, `ssn`,
  `cardNumber`, `cvv`, `dob`, and similar);
- email addresses, formatted phone numbers, and card numbers found anywhere in event
  text. Card detection requires a valid Luhn checksum, so order ids and long
  timestamps are not mistaken for cards.

```html
<script
  async
  src="https://cdn.intempt.com/v1/intempt.min.js?organization=…&pii_scrubbing=1"
></script>
```

> **This is irreversible and it is not retroactive.** Redaction happens in the browser
> before transmission, so there is no way to recover a redacted value later — turn it
> on only once you're sure nothing downstream depends on the fields it covers. Formatted
> phone numbers are matched, but a bare digit run like `4155552671` is not, because that
> shape is indistinguishable from an order number.
>
> Records created by `consent()` are **never** scrubbed — the email in a consent record
> is the proof of consent.

This is a different mechanism from `doNotCapture` above: `doNotCapture` hides one
element's on-screen text, while PII scrubbing filters every outbound payload.

### Server-side geolocation

On by default, and the browser never handles the address — no third party is involved.

> **Rolling out.** Server-side derivation ships with `push-source-service#439`. Until that
> is deployed, this SDK sends no address and the server does not yet derive one, so
> `country`, `region` and `city` are empty for this source in the interim. The switch below
> already works and will take effect the moment the server side is live.

To turn it off, add `&use_ip_for_geolocation=false` to the script URL:

```html
<script
  async
  src="https://cdn.intempt.com/v1/intempt.min.js?organization=…&use_ip_for_geolocation=false"
></script>
```

With it off, events carry no `country`, `region` or `city`. Anything that segments or
reports on those goes empty for this source, so check what depends on them first.

Earlier versions of this SDK called `ipapi.co` from the browser on session start and
sent the resulting address as a user attribute. That call is gone.

### Choosing where data is sent (data residency)

Point ingest at a specific host with `&api_host=`:

```html
<script
  async
  src="https://cdn.intempt.com/v1/intempt.min.js?organization=…&api_host=https%3A%2F%2Fapi.eu.intempt.com%2Fv1"
></script>
```

Must be an absolute `https` URL including any version path. An invalid or non-https
value is ignored and the default host is used. Talk to Intempt before setting this —
the host has to exist and accept your write key.

Call `logOut()` when a user signs out so their session/profile state resets:

```javascript
window.intempt.logOut();
```

---

## 7. Fetch recommendations

`recommendation` is asynchronous and returns a `Promise`. Unlike the tracking methods, it is
**not** gated on the opt-out flag — it calls the API even when the visitor has opted out, so
gate it yourself if that matters to your consent posture.

Handle both failure modes: a network-level failure resolves to `null`, but a response whose
body is not JSON (a proxy error page, an empty `401`) **rejects**.

```javascript
let items = null;
try {
  items = await window.intempt.recommendation({
    id: 123, // feed ID
    quantity: 10,
    fields: ['productId', 'name', 'price', 'image'],
  });
} catch {
  items = null;
}

if (items) renderRecommendations(items);
```

---

## 8. React to events in your own code

Every action the SDK takes is broadcast as a DOM event on `window`, so you can hook
into them. There's a generic `intempt:event` plus per-type events
(`intempt:track`, `intempt:identify`, `intempt:product`, …):

```javascript
window.addEventListener('intempt:event', (e) => {
  console.log('Intempt sent:', e.detail.event);
});

window.addEventListener('intempt:track', (e) => {
  console.log('Custom event:', e.detail.eventName);
});
```

---

## 9. Diagnostics: see what the SDK is doing

By default the SDK is **silent in production** — it prints nothing to the console
on your live site. Three options let you look inside when you need to.

### `debug: true` — verbose console output

Turn this on to see the SDK's internal diagnostics, including on a production
build. This is what to enable when you're working through a support case:

```javascript
new IntemptJs({ /* …your config… */, debug: true });
```

Output is prefixed by subsystem, e.g.
`[RequestBatcher] circuit breaker closed -> open`.

Set `logLevel` for finer control: `'error'`, `'warn'`, `'info'`, `'debug'`, or
`'silent'`. It overrides `debug`, so `logLevel: 'silent'` quiets a development
build too.

### `onDiagnostic` — forward diagnostics to your own telemetry

Receive SDK diagnostics as structured records and send them wherever your other
telemetry goes (Sentry, Datadog, your own endpoint):

```javascript
new IntemptJs({
  /* …your config… */
  onDiagnostic: ({ level, scope, message, detail, timestamp }) => {
    if (level === 'error') {
      Sentry.captureMessage(`[${scope}] ${message}`, { extra: { detail } });
    }
  },
});
```

Notes:

- It receives **`warn` and above by default, in production too** — independently
  of `logLevel`, because catching problems on live sites is the point. Add
  `debug: true` to receive everything.
- It's called synchronously. Keep it fast.
- If your callback throws, the SDK swallows the error rather than letting it
  surface on your page.

### `getDiagnostics()` — read the delivery pipeline's state

```javascript
window.intempt.getDiagnostics();
// {
//   queueDepth: 3,             // events waiting to be sent
//   droppedEvents: 0,          // events discarded because the queue filled up
//   flushCount: 12,            // send attempts this page
//   flushFailureCount: 1,      // …of which failed to reach us
//   lastFlushLatencyMs: 84,
//   avgFlushLatencyMs: 91,
//   breakerState: 'closed',    // 'open' means the SDK has paused sending
//   breakerTransitions: 0      // non-zero means it hit a real outage
// }
```

Useful answers it gives directly: **`droppedEvents > 0`** means events were lost
(a very long outage, or a runaway tracking loop firing far more events than a real
session would). **`breakerState: 'open'`** means the SDK has deliberately stopped
sending for a short window because deliveries kept failing — events keep queueing
meanwhile, and sending resumes on its own.

---

## Tips & gotchas

- **All event methods take a single object** — e.g. `track({ eventTitle, data })`. The
  two exceptions are `productView('id')` (a string) and `productOrdered([...])` (an
  array).
- **Validation throws.** Missing a required field (like `userId` on `identify`) or
  using a reserved title raises an error — wrap calls in `try/catch` if a bad payload
  shouldn't break your page.
- **No `getProfileId()`.** Profile, session, and page IDs are managed internally and
  attached to events for you; there's no public getter to read them back.
- **Local testing.** Remember the localhost guard — use a staging domain to see events
  flow. [`examples/README.md`](examples/README.md#2-localhost-is-blocked-by-design) has a
  hosts-file workaround for developing locally.
- **Don't track SPA route changes yourself.** Page views are already automatic through the
  History API; adding your own router hook double-counts.

---

## Where to go next

|                                                 |                                                                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [**API reference**](docs/API.md)                | Every method, every validation rule, the exact error strings, and the full list of limitations                                                                                                                                 |
| [**examples/**](examples/)                      | Runnable pages — [basic](examples/basic-html/index.html), [consent](examples/consent-banner/index.html), [SPA routing](examples/spa/index.html), [commerce](examples/ecommerce/index.html), [TypeScript](examples/typescript/) |
| [**TypeScript quickstart**](docs/TYPESCRIPT.md) | Declarations for `window.intempt`, a typed wrapper, and the traps types can't catch                                                                                                                                            |
| [**Migration guide**](docs/MIGRATION.md)        | Upgrading an older integration, with a checklist                                                                                                                                                                               |
| **Frameworks**                                  | [React](docs/integrations/REACT.md) · [Next.js](docs/integrations/NEXTJS.md) · [Vue](docs/integrations/VUE.md)                                                                                                                 |
