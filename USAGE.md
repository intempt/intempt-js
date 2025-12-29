# IntemptJS API Documentation

## Overview

IntemptJS is a JavaScript SDK for tracking user events, managing user identification, and handling consent management. This document describes all public methods available in the `IntemptJs` class.

## Initialization

### Constructor

```typescript
new IntemptJs(config: IntemptConfig)
```

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config.organization` | `string` | Yes | Organization identifier |
| `config.sourceId` | `string` | Yes | Source identifier |
| `config.project` | `string` | Yes | Project identifier |
| `config.writeKey` | `string` | Yes | Write key for authentication (format: `username.password`) |
| `config.shopify` | `boolean` | Yes | Enable Shopify integration |
| `config.magento` | `boolean` | Yes | Enable Magento integration |

**Example:**
```typescript
const intempt = new IntemptJs({
  organization: 'my-org',
  sourceId: 'web-source',
  project: 'my-project',
  writeKey: 'username.password',
  shopify: false,
  magento: false
});
```

**Validation:**
- All config fields must be provided (non-empty strings)
- Throws error if any required field is missing

---

## User Tracking Control Methods

### `getProfileId()`

Retrieves the current user's profile ID.

**Returns:** `string` - The profile ID

**Example:**
```typescript
const profileId = intempt.getProfileId();
console.log(profileId); // e.g., "prof_abc123"
```

---

### `optIn()`

Enables tracking for the current user.

**Returns:** `void`

**Example:**
```typescript
intempt.optIn();
```

---

### `optOut()`

Disables tracking for the current user.

**Returns:** `void`

**Example:**
```typescript
intempt.optOut();
```

---

### `isUserOptIn()`

Checks if the user has opted in to tracking.

**Returns:** `boolean` - `true` if tracking is enabled, `false` otherwise

**Example:**
```typescript
if (intempt.isUserOptIn()) {
  // User has consented to tracking
  intempt.track({ eventTitle: 'Button Click', data: { button: 'signup' } });
}
```

---

## User Identification Methods

### `identify(params: IdentifyParams)`

Identifies a user and associates them with a user ID. This method is used to link user actions to a specific user identity.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `params.userId` | `string` | Yes | Unique identifier for the user |
| `params.eventTitle` | `string` | No | Custom event title (default: "Identify") |
| `params.userAttributes` | `{[key: string]: any}` | No | User attributes object (requires `eventTitle` if provided) |
| `params.data` | `{[key: string]: any}` | No | Additional event data |

**Returns:** `void`

**Validation:**
- `userId` is required
- If `userAttributes` is provided, `eventTitle` must also be provided
- Forbidden event titles: `'auto-track'`, `'view page'`, `'leave page'`, `'change on'`, `'click on'`, `'submit on'`, `'identify'`, `'consent'`

**Example:**
```typescript
intempt.identify({
  userId: 'user123',
  eventTitle: 'User Registration',
  userAttributes: {
    email: 'user@example.com',
    name: 'John Doe',
    plan: 'premium'
  },
  data: {
    registrationSource: 'website',
    referrer: 'google'
  }
});
```

**Events Dispatched:**
- `intempt:identify` - Custom event with event name
- `intempt:event` - Event data payload

---

### `alias(params: AliasParams)`

Creates an alias between two user IDs. Used when a user is identified with different IDs (e.g., anonymous ID and authenticated ID).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `params.userId` | `string` | Yes | Primary user ID |
| `params.anotherUserId` | `string` | Yes | Secondary user ID to alias |

**Returns:** `void`

**Validation:**
- Both `userId` and `anotherUserId` are required

**Example:**
```typescript
intempt.alias({
  userId: 'anonymous_123',
  anotherUserId: 'authenticated_user456'
});
```

**Events Dispatched:**
- `intempt:alias` - Custom event with event name
- `intempt:event` - Event data payload

---

## Group/Account Methods

### `group(params: GroupParams)`

Associates a user with a group or account.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `params.accountId` | `string` | Yes | Unique identifier for the account/group |
| `params.eventTitle` | `string` | No | Custom event title (default: "Identify") |
| `params.accountAttributes` | `{[key: string]: any}` | No | Account attributes object (requires `eventTitle` if provided) |

**Returns:** `void`

**Validation:**
- `accountId` is required
- If `accountAttributes` is provided, `eventTitle` must also be provided
- Forbidden event titles: same as `identify` method

**Example:**
```typescript
intempt.group({
  accountId: 'company_abc',
  eventTitle: 'Account Created',
  accountAttributes: {
    name: 'Acme Corp',
    plan: 'enterprise',
    employees: 500
  }
});
```

**Events Dispatched:**
- `intempt:group` - Custom event with event name
- `intempt:event` - Event data payload

---

## Event Tracking Methods

### `track(params: TrackParams)`

Tracks a custom event with associated data.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `params.eventTitle` | `string` | Yes | Name of the event |
| `params.data` | `{[key: string]: any}` | Yes | Event data object (must not be empty) |

**Returns:** `void`

**Validation:**
- `eventTitle` is required
- `data` must be provided and non-empty
- Forbidden event titles: same as `identify` method

**Example:**
```typescript
intempt.track({
  eventTitle: 'Purchase Completed',
  data: {
    orderId: 'order_123',
    amount: 99.99,
    currency: 'USD',
    items: ['product1', 'product2']
  }
});
```

**Events Dispatched:**
- `intempt:track` - Custom event with event name
- `intempt:event` - Event data payload

---

### `record(params: RecordParams)`

Records an event with optional user and account information.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `params.eventTitle` | `string` | Yes | Name of the event |
| `params.accountId` | `string` | No | Account identifier |
| `params.userId` | `string` | No | User identifier |
| `params.accountAttributes` | `{[key: string]: any}` | No | Account attributes |
| `params.userAttributes` | `{[key: string]: any}` | No | User attributes |
| `params.data` | `{[key: string]: any}` | No | Additional event data |

**Returns:** `void`

**Validation:**
- `eventTitle` is required
- Forbidden event titles: same as `identify` method

**Example:**
```typescript
intempt.record({
  eventTitle: 'Feature Used',
  userId: 'user123',
  accountId: 'account456',
  data: {
    feature: 'analytics_dashboard',
    duration: 300
  },
  userAttributes: {
    role: 'admin'
  },
  accountAttributes: {
    plan: 'enterprise'
  }
});
```

**Events Dispatched:**
- `intempt:record` - Custom event with event name
- `intempt:event` - Event data payload

---

## Consent Management

### `consent(params: ConsentParams)`

Records user consent preferences.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `params.action` | `'accept' \| 'reject'` | Yes | Consent action |
| `params.validUntil` | `number` | Yes | Timestamp when consent expires |
| `params.email` | `string` | No | User email address |
| `params.message` | `string` | No | Consent message |
| `params.category` | `string` | No | Consent category |

**Returns:** `void`

**Validation:**
- `action` is required and must be either `'accept'` or `'reject'`
- `validUntil` is required (Unix timestamp)

**Example:**
```typescript
intempt.consent({
  action: 'accept',
  validUntil: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year from now
  email: 'user@example.com',
  category: 'analytics'
});
```

**Events Dispatched:**
- `intempt:consent` - Custom event with event name
- `intempt:event` - Event data payload

---

## Product Tracking Methods

### `productAdd(params: ProductParams)`

Tracks when a product is added to cart.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `params.productId` | `string` | Yes | Product identifier |
| `params.quantity` | `number` | No | Quantity added (default: 1) |

**Returns:** `void`

**Example:**
```typescript
intempt.productAdd({
  productId: 'prod_123',
  quantity: 2
});
```

**Events Dispatched:**
- `intempt:product` - Custom event with event name
- `intempt:event` - Event data payload

**Event Title:** `"Added to cart"`

---

### `productOrdered(params: ProductParams[])`

Tracks when products are ordered (purchased).

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `params` | `ProductParams[]` | Yes | Array of product objects |

**ProductParams:**
- `productId` (string, required): Product identifier
- `quantity` (number, optional): Quantity ordered

**Returns:** `void`

**Example:**
```typescript
intempt.productOrdered([
  { productId: 'prod_123', quantity: 2 },
  { productId: 'prod_456', quantity: 1 }
]);
```

**Events Dispatched:**
- `intempt:product` - Custom event with event name
- `intempt:event` - Event data payload

**Event Title:** `"Product ordered"`

---

### `productView(productId: string)`

Tracks when a product is viewed.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `productId` | `string` | Yes | Product identifier |

**Returns:** `void`

**Example:**
```typescript
intempt.productView('prod_123');
```

**Events Dispatched:**
- `intempt:product` - Custom event with event name
- `intempt:event` - Event data payload

**Event Title:** `"Product viewed"`

---

## Session Management

### `logOut()`

Handles user logout by refreshing the auto tracker and clearing session data.

**Returns:** `void`

**Example:**
```typescript
intempt.logOut();
```

**Events Dispatched:**
- `intempt:logOut` - Custom event with event name "Log Out"

**Note:** This method only executes if the user has opted in to tracking.

---

## Recommendation API

### `recommendation(params: RecommendationParams)`

Fetches product recommendations from the Intempt API.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `params.id` | `number` | Yes | Feed ID for recommendations |
| `params.quantity` | `number` | Yes | Number of recommendations to return |
| `params.fields` | `string[]` | Yes | Fields to include in the response |

**Returns:** `Promise<any>` - Recommendation data or `null` on error

**Example:**
```typescript
const recommendations = await intempt.recommendation({
  id: 123,
  quantity: 10,
  fields: ['productId', 'name', 'price', 'image']
});

if (recommendations) {
  console.log('Recommended products:', recommendations);
}
```

**API Details:**
- **Endpoint:** `{api}/{organization}/projects/{project}/feeds/{id}/data`
- **Method:** POST
- **Authentication:** Basic Auth (derived from `writeKey`)
- **Request Body:**
    - `profileId`: Current user's profile ID
    - `sourceId`: Source identifier from config
    - `limit`: Number of recommendations
    - `fields`: Array of field names
    - `productId`: Optional product ID from localStorage

**Error Handling:**
- Returns `null` if the request fails
- Uses `keepalive: true` for better reliability

---

## Common Behavior

### Opt-In Requirement

Most tracking methods (`identify`, `group`, `track`, `record`, `alias`, `consent`, `productAdd`, `productOrdered`, `productView`, `logOut`) will silently return without executing if the user has opted out of tracking. Use `isUserOptIn()` to check the current status.

### Automatic IDs

The following IDs are automatically included in all tracking events:
- `profileId`: Generated/retrieved from auto tracker
- `sessionId`: Current session identifier
- `pageId`: Current page identifier

### Event Dispatching

All tracking methods dispatch custom DOM events that can be listened to:
- Method-specific events: `intempt:identify`, `intempt:track`, `intempt:record`, etc.
- Generic event: `intempt:event` (dispatched by all methods)

**Example Event Listener:**
```typescript
window.addEventListener('intempt:event', (event) => {
  console.log('Intempt event:', event.detail);
});
```

### Forbidden Event Titles

The following event titles are forbidden and will throw an error:
- `'auto-track'`
- `'view page'`
- `'leave page'`
- `'change on'`
- `'click on'`
- `'submit on'`
- `'identify'`
- `'consent'`

---

## Type Definitions

### IntemptConfig
```typescript
{
  organization: string;
  sourceId: string;
  project: string;
  writeKey: string; // Format: "username.password"
  shopify: boolean;
  magento: boolean;
}
```

### IdentifyParams
```typescript
{
  userId: string; // Required
  eventTitle?: string;
  userAttributes?: {[key: string]: any};
  data?: {[key: string]: any};
}
```

### GroupParams
```typescript
{
  accountId: string; // Required
  eventTitle?: string;
  accountAttributes?: {[key: string]: any};
}
```

### TrackParams
```typescript
{
  eventTitle: string; // Required
  data: {[key: string]: any}; // Required, non-empty
}
```

### RecordParams
```typescript
{
  eventTitle: string; // Required
  accountId?: string;
  userId?: string;
  accountAttributes?: {[key: string]: any};
  userAttributes?: {[key: string]: any};
  data?: {[key: string]: any};
}
```

### AliasParams
```typescript
{
  userId: string; // Required
  anotherUserId: string; // Required
}
```

### ConsentParams
```typescript
{
  action: 'accept' | 'reject'; // Required
  validUntil: number; // Required (Unix timestamp)
  email?: string;
  message?: string;
  category?: string;
}
```

### ProductParams
```typescript
{
  productId: string; // Required
  quantity?: number;
}
```

### RecommendationParams
```typescript
{
  id: number; // Required
  quantity: number; // Required
  fields: string[]; // Required
}
```

---

## Error Handling

All validation errors throw exceptions with descriptive messages. Common errors include:

- **Configuration errors:** "IntemptJs initialization failed: All config fields must be provided."
- **Parameter validation errors:** "Parameters for the '{method}' method are required."
- **Field-specific errors:** "{Method} parameters are invalid: '{field}' is required."
- **Forbidden event titles:** "The '{eventTitle}' event title is forbidden"

Always wrap method calls in try-catch blocks when appropriate:

```typescript
try {
  intempt.identify({ userId: 'user123' });
} catch (error) {
  console.error('Tracking error:', error.message);
}
```

---

## Best Practices

1. **Initialize once:** Create a single `IntemptJs` instance and reuse it throughout your application.

2. **Check opt-in status:** Before tracking, check if the user has opted in:
   ```typescript
   if (intempt.isUserOptIn()) {
     intempt.track({ eventTitle: 'Action', data: {} });
   }
   ```

3. **Handle errors:** Wrap tracking calls in try-catch blocks for production code.

4. **Use meaningful event titles:** Choose descriptive event titles that clearly indicate what action occurred.

5. **Include relevant data:** Provide comprehensive data objects to enable better analytics.

6. **Consent management:** Always respect user consent preferences and use the `consent()` method to record consent decisions.

---

## Version Information

- **SDK Version:** 0.0.0 (from package.json)
- **Documentation Version:** 1.0.0
- **Last Updated:** 2024

