# Intempt Browser SDK

Client-side JavaScript SDK for the [Intempt](https://intempt.com) platform. Add one
script tag and it automatically tracks page views, sessions, and user interactions, with
a simple API for identification, custom events, consent, commerce events, and
recommendations.

## Installation

Add **both** snippets to your page `<head>`, in this order. The first installs a small
queue stub so `window.intempt.*` calls work immediately; the second loads the SDK
asynchronously and replays anything that was queued. There's no constructor to call —
your account settings go in the SDK URL's query parameters.

```html
<!-- 1. Queue stub — buffers calls until the SDK is ready -->
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

| Parameter | Description |
|-----------|-------------|
| `organization` | Organization identifier |
| `project` | Project identifier |
| `source` | Source ID (`sourceId`) you're sending data to |
| `key` | API key, in `username.password` form |
| `shopify` | Shopify tracking — add `&shopify=1` to enable, omit to disable |
| `magento` | Magento product detection — add `&magento=1` to enable, omit to disable |

> `shopify` and `magento` are enabled by **presence**: including the parameter with any
> non-empty value turns it on. To disable, leave it out entirely (note that `=0` or
> `=false` will **not** disable it).

Once loaded, the SDK takes over `window.intempt`, replays any queued calls, and starts
auto-tracking. Because the SDK loads with `async`, it never blocks page rendering.

## Quick Start

All event methods take a single object argument:

```javascript
window.intempt.identify({ userId: 'user_123' });

window.intempt.track({
  eventTitle: 'Purchase Completed',
  data: { amount: 99.99, currency: 'USD' }
});
```

## Methods

Available on `window.intempt`:

### Identification
- `identify({ userId, eventTitle?, userAttributes?, data? })` — identify the current user
- `alias({ userId, anotherUserId })` — link two user IDs (e.g. anonymous → authenticated)
- `group({ accountId, eventTitle?, accountAttributes? })` — associate the user with an account

### Events
- `track({ eventTitle, data })` — send a custom event (`data` required, non-empty)
- `record({ eventTitle, userId?, accountId?, data?, ... })` — record an event with optional context

### Consent
- `consent({ action, validUntil, email?, message?, category? })` — record a consent decision (`action` is `'accept'` or `'reject'`)

### Commerce
- `productAdd({ productId, quantity? })` — track adding a product to cart
- `productView(productId)` — track viewing a product (takes a string)
- `productOrdered([{ productId, quantity? }, ...])` — track a completed order (takes an array)

### Privacy
- `optIn()` / `optOut()` — enable or disable tracking (on by default)
- `isUserOptIn()` — check whether tracking is currently enabled

### Session & Recommendations
- `logOut()` — reset session/profile state on user logout
- `recommendation({ id, quantity, fields })` — fetch recommendations (async, returns a `Promise`)

See [USAGE.md](USAGE.md) for the full guide with examples.

## Auto-Tracking

The SDK automatically captures page views, page exits, sessions, clicks, and form
interactions — no setup required. To keep sensitive on-screen text out of events, add
the `doNotCapture` attribute to an element (its captured text is masked); password
inputs are masked automatically.

## Integrations

- **Shopify** (`&shopify=1`) — automatic product view and add-to-cart tracking.
- **Magento** (`&magento=1`) — product detection for personalization.

## Local Development Note

By default, tracking is blocked on `localhost` / `127.0.0.1` and for bot/crawler user
agents. Use a real or staging domain to see events flow.

## Development

```bash
npm install
npm run dev      # Vite dev server
npm run build    # Production build
npm test         # Cypress tests
```

## Documentation

Full usage guide: [USAGE.md](USAGE.md) · Platform docs:
[docs.intempt.com/js-sdk](https://docs.intempt.com/js-sdk)

## License

MIT — see [LICENSE](LICENSE) for details.
