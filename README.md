# Intempt Browser SDK

Client-side JavaScript SDK for the [Intempt](https://intempt.com) analytics platform. Automatic page tracking with custom event support.

## Installation

### Script Tag

```html
<script src="https://cdn.intempt.com/intempt.min.js"></script>
```

### npm

```bash
npm install intemptjs
```

## Quick Start

```javascript
const intempt = new IntemptJs({
  organization: 'my-org',
  project: 'my-project',
  sourceId: 'source-id',
  writeKey: 'key-id.key-secret',
  shopify: false,
  magento: false,
});

intempt.track('purchase', { amount: 99.99, currency: 'USD' });
intempt.identify('john@example.com');
```

## Methods

### Event Tracking

- `track(eventTitle, data)` - Send a custom event
- `identify(userId)` - Identify the current user
- `group(accountId, accountAttributes?)` - Associate user with an account

### Consent (GDPR/CCPA)

- `consent(action, category?, expirationTime?, email?, message?)` - Manage user consent

### Product Events

- `productAdd(productId, quantity)` - Track adding a product to cart
- `productView(productId)` - Track viewing a product
- `productOrdered(products)` - Track a completed order

### Experiments & Personalizations

- `chooseExperimentsByGroups(groups?)` - Select experiments by group
- `chooseExperimentsByNames(names?)` - Select experiments by name
- `choosePersonalizationsByGroups(groups?)` - Select personalizations by group
- `choosePersonalizationsByNames(names?)` - Select personalizations by name

### Privacy Controls

- `optIn()` - Opt the user into tracking
- `optOut()` - Opt the user out of tracking
- `isOptedIn()` - Check if the user is opted in

### Utility

- `getProfileId()` - Get the current profile identifier

## Auto-Tracking

The SDK automatically captures page views, clicks, scrolls, and form interactions.

## Integrations

Built-in support for Shopify and Magento via config flags.

## Development

```bash
npm install
npm run dev      # Vite dev server
npm run build    # Production build
```

## Documentation

Full documentation: [docs.intempt.com](https://docs.intempt.com/docs/javascript-sdk)

## License

MIT — see [LICENSE](LICENSE) for details.
