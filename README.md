# Intempt Browser SDK

Client-side JavaScript SDK for the [Intempt](https://intempt.com) platform.

Add one script tag and it tracks page views, sessions, clicks and form interactions on its
own. On top of that you get a small API for identifying users, sending custom events,
recording consent, commerce events, and fetching recommendations — and it can apply
on-page experiences (DOM changes) driven from your Intempt workspace.

Zero runtime dependencies, ~82 kB minified / ~23 kB gzipped, TypeScript source, MIT.

---

## Install

The SDK ships as a self-initialising bundle on the CDN. **`npm install` does not work yet** —
there is no module build and nothing to `import`. The script tag is the install. See
[Forthcoming](#forthcoming) for what changes.

Add both snippets to your `<head>`, **in this order**. The first is a queue stub so
`window.intempt.*` works immediately; the second loads the SDK asynchronously and replays
anything you queued.

```html
<!-- 1. Queue stub — buffers calls until the SDK is ready -->
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

<!-- 2. Load the SDK asynchronously -->
<script
  async
  src="https://cdn.intempt.com/v1/intempt.min.js?organization=my-org&project=my-project&source=web-source&key=username.password"
></script>
```

There is no constructor. Configuration goes in the script URL's query string:

| Parameter      | Description                                                             |
| -------------- | ----------------------------------------------------------------------- |
| `organization` | Organization identifier                                                 |
| `project`      | Project identifier                                                      |
| `source`       | Source ID (`sourceId`) you're sending data to                           |
| `key`          | API key, in `username.password` form                                    |
| `shopify`      | Shopify tracking — add `&shopify=1` to enable, omit to disable          |
| `magento`      | Magento product detection — add `&magento=1` to enable, omit to disable |

> **The `/v1/` path segment is required.** The SDK finds its own `<script>` tag by matching
> that URL. Without it, it reads an empty configuration and never starts — the console shows
> `CAN'T FIND SCRIPT`. If you are upgrading from a snippet without `/v1/`, see the
> [migration guide](docs/MIGRATION.md#1-add-v1-to-the-script-url).

> `shopify` and `magento` are enabled by **presence**: the parameter with any non-empty value
> turns it on. `&shopify=0` and `&shopify=false` both _enable_ it. To disable, leave it out.

## 30-second example

Every event method takes a single object.

```javascript
// Who they are — call this as soon as you know, and on every page load while signed in
window.intempt.identify({ userId: 'user_123' });

// What they did — both fields are required, and `data` must be non-empty
window.intempt.track({
  eventTitle: 'Purchase Completed',
  data: { amount: 99.99, currency: 'USD' },
});

// See what the SDK is sending, including the automatic events
window.addEventListener('intempt:event', (e) => console.log(e.detail.event));
```

Page views, sessions, clicks and form interactions need none of this — they are already being
captured.

**Two things that will confuse you if you don't know them:**

- **Tracking is blocked on `localhost` and `127.0.0.1`**, and for bot user agents, by design.
  Nothing is broken; use a real or staging hostname. [How to develop against
  it](examples/README.md#2-localhost-is-blocked-by-design).
- **Validation throws.** A missing required field or a [reserved event
  title](docs/API.md#reserved-event-titles) raises an `Error` on your own stack. Wrap calls if
  a bad payload must not break the page.

## Documentation

|                                                 |                                                                                                                                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[USAGE.md](USAGE.md)**                        | The guide, task by task. Start here.                                                                                                                                                                                                   |
| **[API reference](docs/API.md)**                | Every method, every validation rule, every error string, and the limitations                                                                                                                                                           |
| **Generated reference**                         | `npm run docs:api` — TypeDoc over the public class, from the types themselves. Complements the hand-written reference above rather than replacing it: this one cannot drift from a signature, that one explains what a signature means |
| **[examples/](examples/)**                      | Runnable pages: [basic](examples/basic-html/index.html), [consent](examples/consent-banner/index.html), [SPA routing](examples/spa/index.html), [commerce](examples/ecommerce/index.html), [TypeScript](examples/typescript/)          |
| **[TypeScript quickstart](docs/TYPESCRIPT.md)** | Declarations to copy, a typed wrapper, and the traps types can't catch                                                                                                                                                                 |
| **[Migration guide](docs/MIGRATION.md)**        | Upgrading an older integration, with a checklist                                                                                                                                                                                       |
| **Frameworks**                                  | [React](docs/integrations/REACT.md) · [Next.js](docs/integrations/NEXTJS.md) · [Vue](docs/integrations/VUE.md)                                                                                                                         |
| Platform docs                                   | [docs.intempt.com/js-sdk](https://docs.intempt.com/js-sdk)                                                                                                                                                                             |

The framework pages are integration **guides**, not adapter packages — without a module build
there is nothing for an adapter to wrap. Each is a script tag plus a typed wrapper you own.

## The API, in one screen

All on `window.intempt`. Full rules in the [API reference](docs/API.md).

```
identify({ userId, eventTitle?, userAttributes?, data? })   // userId must be truthy
group({ accountId, eventTitle?, accountAttributes? })       // associate with an account

track({ eventTitle, data })                                 // data required, non-empty
record({ eventTitle, userId?, accountId?, data?, ... })      // data optional

consent({ action, validUntil, email?, message?, category? }) // 'accept' | 'reject'
optIn() / optOut() / isUserOptIn()                          // on by default, persisted

productAdd({ productId, quantity? })                        // one object
productView(productId)                                      // a bare string
productOrdered([{ productId, quantity? }, ...])             // an array

logOut()                                                    // reset profile + session
recommendation({ id, quantity, fields })                    // async, returns a Promise
VERSION                                                     // e.g. '6.0.0'
```

## Auto-tracking

Page views (including SPA route changes via the History API), page exits with time-on-page,
sessions, clicks, form changes and form submits — no setup.

To keep sensitive on-screen text out of those events, add `doNotCapture` to an element and
its captured text is masked. Password inputs are masked automatically.

```html
<span doNotCapture>Balance: $12,500</span>
```

It masks the captured **text** only — not the element's tag, id or classes, and not values
submitted through a form.

## Integrations

- **Shopify** (`&shopify=1`) — automatic product view and add-to-cart tracking.
- **Magento** (`&magento=1`) — product detection for personalization.

On Shopify, calling `productAdd`/`productView` yourself as well will double-count.

## Known limitations

Stated up front, because finding them after you integrate is worse.

|                                        |                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **CDN install only**                   | No module build, no `import`, no published types                                                                  |
| **The CDN path is mutable**            | `/v1/intempt.min.js` is overwritten in place on release. Don't pin an SRI hash on it — self-host if you need SRI. |
| **No public ID getters**               | Profile/session/page IDs are internal. `getProfileId()` was removed.                                              |
| **Consent is origin-scoped**           | `localStorage`, so an opt-out doesn't cross subdomains                                                            |
| **`consent()` doesn't stop tracking**  | It records a decision. `optOut()` is the switch — and call `consent()` first, or it's dropped.                    |
| **`recommendation()` ignores opt-out** | It calls the API regardless. Gate it yourself.                                                                    |
| **The write key is in the page**       | Inherent to a browser SDK. Scope it to one source, write-only, and rotate it.                                     |

## Forthcoming

Planned, **not shipped** — don't write code against it yet: a module build exporting a
side-effect-free `createIntempt(config)`, the `main`/`module`/`exports`/`types` fields, a
published `.d.ts`, and a `CHANGELOG.md`. When it lands, `npm install intemptjs` plus an import
becomes a supported install; the script tag stays. Details in the
[migration guide](docs/MIGRATION.md#forthcoming-the-module-build).

To make that migration cheap, put a wrapper module between your app and `window.intempt`
now — [`examples/typescript/analytics.ts`](examples/typescript/analytics.ts).

## Contributing

```bash
npm ci
npm run build        # tsc + vite, production bundle
npm run test:unit    # vitest, jsdom
npm run test:e2e     # cypress
```

## License

MIT — see [LICENSE](LICENSE).
