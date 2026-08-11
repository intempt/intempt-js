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
  var queue = [], pending = [];
  var methods = ['identify','group','track','record','alias','consent',
                 'productAdd','productOrdered','productView','logOut',
                 'optIn','optOut','isUserOptIn','recommendation'];
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
  src="https://cdn.intempt.com/intempt.min.js?organization=my-org&project=my-project&source=web-source&key=username.password">
</script>
```

| Parameter | What it is |
|-----------|------------|
| `organization` | Your organization identifier |
| `project` | Your project identifier |
| `source` | Source ID (`sourceId`) you're sending data to |
| `key` | Your API key, in `username.password` form |
| `shopify` | Shopify tracking — add `&shopify=1` to enable, omit to disable |
| `magento` | Magento product detection — add `&magento=1` to enable, omit to disable |

> **`shopify` / `magento` are enabled by presence.** Including the parameter with any
> non-empty value turns it on; to disable, leave it out entirely. Note that `&shopify=0`
> or `&shopify=false` will **not** disable it — only omitting the parameter does.

Once the SDK loads it takes over **`window.intempt`**, replays any queued calls in
order, and begins auto-tracking. With the stub in place you can safely call
`window.intempt.*` anywhere on the page, even before the SDK has finished downloading.

> **Heads up — tracking is off on localhost.** By default the SDK blocks tracking on
> `localhost` / `127.0.0.1` and for bot/crawler user agents. So if nothing shows up
> while developing locally, that's expected — test on a real (or staging) domain.

### 1a. Content Security Policy

If your site sends a `Content-Security-Policy` header, the SDK needs these
directives. Everything below is what the SDK actually contacts — there are no
other origins.

```
script-src  'self' https://cdn.intempt.com;
connect-src 'self' https://api.intempt.com https://ipapi.co;
img-src     'self' data: https://cdn.intempt.com;
style-src   'self' 'unsafe-inline';
```

| Directive | Why the SDK needs it |
|---|---|
| `script-src https://cdn.intempt.com` | Where the SDK bundle is served from. Also the origin of the visual web editor, which the SDK loads on demand. |
| `connect-src https://api.intempt.com` | Event ingest and the recommendations API. |
| `connect-src https://ipapi.co` | Geo/IP enrichment. **If you don't want this call, block this origin** — the SDK degrades to sending events without geo fields rather than failing. |
| `img-src data:` | Inline image data used by rendered experiences. |
| `style-src 'unsafe-inline'` | **Only if you use experiences/recommendations that restyle the page.** If you use the SDK for event tracking alone, drop it. |

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
  src="https://cdn.intempt.com/v1/intempt.min.js?organization=my-org&project=my-project&source=web-source&key=username.password">
</script>
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
  `replaceState`, back/forward).
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
  data: { signupSource: 'homepage' }
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
  eventTitle: 'Account Updated',         // required when sending accountAttributes
  accountAttributes: { name: 'Acme Corp', plan: 'enterprise' }
});
```

---

## 4. Send custom events

Use `track` for things your users do. `data` is required and can't be empty:

```javascript
window.intempt.track({
  eventTitle: 'Newsletter Signup',
  data: { listId: 'weekly', source: 'footer' }
});
```

`record` is similar but lets you attach user/account context inline and doesn't require
`data`:

```javascript
window.intempt.record({
  eventTitle: 'Feature Used',
  userId: 'user_123',
  accountId: 'company_acme',
  data: { feature: 'dashboard_export' }
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
  { productId: 'prod_456', quantity: 1 }
]);
```

On Shopify stores (with `&shopify=1`), product views and add-to-cart are also detected
automatically.

---

## 6. Respect consent & opt-out

Tracking is **on by default**. Let users turn it off (and back on):

```javascript
window.intempt.optOut();          // stop all tracking
window.intempt.optIn();           // resume
window.intempt.isUserOptIn();     // -> true / false
```

While opted out, every tracking call (automatic and manual) quietly does nothing.

Record an explicit consent decision for GDPR/CCPA flows:

```javascript
window.intempt.consent({
  action: 'accept',                                   // or 'reject'
  validUntil: Date.now() + 365 * 24 * 60 * 60 * 1000, // e.g. 1 year
  email: 'user@example.com',
  category: 'analytics'
});
```

Call `logOut()` when a user signs out so their session/profile state resets:

```javascript
window.intempt.logOut();
```

---

## 7. Fetch recommendations

`recommendation` is asynchronous and returns a `Promise` (it resolves to `null` on
error). Unlike the tracking methods, it works even when the user is opted out:

```javascript
const items = await window.intempt.recommendation({
  id: 123,                                  // feed ID
  quantity: 10,
  fields: ['productId', 'name', 'price', 'image']
});

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
  flow.
