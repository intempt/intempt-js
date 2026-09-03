# React

**There is no `@intempt/react` package, and this is not one.** The SDK's only build output
is an IIFE that installs itself on `window`, so there is nothing to `import` and nothing for
a React adapter to wrap at module level. What follows is an integration guide: the script
tags go in your HTML shell, and you write a thin typed wrapper plus two hooks. That is about
60 lines and you own all of it.

If a published adapter package matters to you, it is blocked on the module build — see
[the end of this page](#what-changes-when-the-module-build-lands).

Assumes Vite or Create React App (a client-rendered app with an `index.html`). For Next.js,
see [NEXTJS.md](NEXTJS.md) — the script-injection story is different enough to need its own
page.

---

## 1. The script tags go in `index.html`, not in a component

```html
<!-- index.html -->
<head>
  <!-- Queue stub: buffers window.intempt.* calls until the SDK arrives -->
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

  <script
    async
    src="https://cdn.intempt.com/v1/intempt.min.js?organization=YOUR_ORG&project=YOUR_PROJECT&source=YOUR_SOURCE_ID&key=YOUR_KEY"
  ></script>
</head>
```

**Do not inject the SDK `<script>` from a `useEffect`.** The SDK locates its own tag by
searching `document.scripts` for a `src` containing its CDN URL, so an injected tag does work
— but under React 18 Strict Mode in development, effects run twice, and a second tag means a
second `IntemptJs` instance, a second set of auto-trackers, and doubled page views. The HTML
shell has none of that ambiguity.

The queue stub is what makes this work without a provider: a `track()` call from a component
that mounts before the SDK has downloaded is buffered and replayed in order.

**The `/v1/` path segment is required.** Without it the SDK cannot find its own tag, reads an
empty configuration, and never starts.

## 2. Declare the global

Copy [`examples/typescript/types/intempt.d.ts`](../../examples/typescript/types/intempt.d.ts)
into your project as `src/types/intempt.d.ts`. Nothing needs to import it.

## 3. One wrapper module

Copy [`examples/typescript/analytics.ts`](../../examples/typescript/analytics.ts) as
`src/analytics.ts`. Components import from that, never from `window`. It gives you a silent
no-op when the SDK is blocked (localhost, bots, ad blockers) and an error boundary around
validation, which otherwise throws inside your click handlers.

## 4. Route changes: usually nothing to do

The SDK patches `history.pushState`/`replaceState` and listens for `popstate`, so React
Router's default (`BrowserRouter`) already produces automatic page views. **Do not add a
`useEffect` that tracks route changes** — you will double-count.

Two exceptions:

- **`HashRouter` is not tracked.** The SDK does not listen for `hashchange`. Switch to
  `BrowserRouter`, or emit your own event:

  ```tsx
  import { useLocation } from 'react-router-dom';
  import { useEffect } from 'react';
  import * as analytics from './analytics';

  /** Only for HashRouter. With BrowserRouter this double-counts. */
  export function useHashRouteTracking() {
    const { hash } = useLocation();
    useEffect(() => {
      analytics.track('Route Changed', { path: hash });
    }, [hash]);
  }
  ```

- **`replaceState` for query-param syncing emits a spurious exit.** A `replaceState` to a URL
  that has not changed produces a _Leave Page_ with no matching _View Page_. If you keep
  filter state in the query string with `navigate(url, { replace: true })` on every keystroke,
  you will generate a stream of them. Debounce it, or keep that state out of the URL.

## 5. Identity

Call `identify` when auth state resolves, and on every reload while the user is signed in —
a client-side route change keeps the profile, a reload starts from storage.

```tsx
import { useEffect } from 'react';
import * as analytics from './analytics';

export function useIntemptIdentity(user: { id: string; email: string } | null) {
  useEffect(() => {
    if (!user) return;
    analytics.identify({
      userId: user.id,
      eventTitle: 'Signed In',
      // userAttributes require an eventTitle — omitting it throws.
      userAttributes: { email: user.email },
    });
  }, [user?.id]); // keyed on the id, so a re-rendered user object is not a re-identify
}
```

On sign-out call `analytics.logOut()`, which resets profile and session state. Without it,
the next person on a shared machine inherits the previous profile.

`user?.id` as the dependency is deliberate: a new object identity for the same user is
common in React and would otherwise re-identify on every render pass.

## 6. Consent

Two mechanisms, easily confused: `optOut()`/`optIn()` control whether anything is collected;
`consent()` records the visitor's decision as an event and **does not stop tracking**. A
reject flow needs both, in this order.

```tsx
import { useEffect, useState } from 'react';
import * as analytics from './analytics';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function useConsent() {
  // undefined = not known yet. Through the queue stub isUserOptIn() returns nothing, and
  // treating that as `false` paints the toggle wrong on first render.
  const [optedIn, setOptedIn] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    analytics.whenReady().then((ready) => {
      if (!cancelled) setOptedIn(ready ? analytics.isOptedIn() : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function accept() {
    // optIn() first: consent() is itself gated on the opt-out flag, so on a re-consent
    // the acceptance would otherwise be silently dropped.
    analytics.recordConsent('accept', Date.now() + ONE_YEAR_MS);
    setOptedIn(true);
  }

  function reject() {
    // recordConsent() sends the event before calling optOut(), for the same reason.
    analytics.recordConsent('reject', Date.now() + ONE_YEAR_MS);
    setOptedIn(false);
  }

  return { optedIn, accept, reject };
}
```

Note the opt-out flag is `localStorage`, so it is **origin-scoped**: an opt-out on
`www.example.com` does not carry to `shop.example.com`.

## 7. Events from components

```tsx
import * as analytics from './analytics';

export function ExportButton({ rows }: { rows: number }) {
  return (
    <button
      onClick={() =>
        analytics.track('Dashboard Exported', { format: 'csv', rows })
      }
    >
      Export
    </button>
  );
}
```

You do not need to track the click itself — the SDK captures clicks, form changes and submits
automatically, with the element's tag, id, classes, visible text and selector path. Use
`track` for the _meaning_ of an action, not its occurrence.

To keep sensitive on-screen text out of those automatic events, add `doNotCapture`:

```tsx
<span donotcapture="">{accountBalance}</span>
```

**Write it all-lowercase in JSX.** React warns about unrecognised camelCase DOM props and
tells you to lowercase them; the SDK checks with `hasAttribute('doNotCapture')`, and HTML
attribute names are case-insensitive, so `donotcapture` matches. The `=""` is only to keep
JSX happy about a valueless attribute.

It masks the captured **text**; it does not hide the element's tag or id, and it does not
strip values submitted through a form. Do not rely on it for whole-form secrecy.

## 8. Testing

Because everything goes through `analytics.ts`, mock that:

```ts
vi.mock('./analytics', () => ({
  track: vi.fn(),
  identify: vi.fn(),
  logOut: vi.fn(),
  whenReady: () => Promise.resolve(true),
  isOptedIn: () => true,
}));
```

Do not assert against `window.intempt` in tests. In JSDOM the SDK is never loaded, so the
wrapper's no-op path is all you would be exercising.

---

## What changes when the module build lands

A side-effect-free `createIntempt(config)` export, a hand-authored public `.d.ts`, and the
`main`/`module`/`exports`/`types` fields in `package.json` are planned. **None of it exists
today.** When it ships:

- `npm install intemptjs` plus an import replaces the script tags, so configuration moves out
  of a URL and into code.
- `types/intempt.d.ts` becomes unnecessary.
- A real `<IntemptProvider>` becomes possible — today a provider would have nothing to
  provide, since the instance installs itself on `window` regardless.

`analytics.ts` survives that change. Its value is the no-op and the error boundary, not the
typing.

## See also

- [API reference](../API.md) · [TypeScript quickstart](../TYPESCRIPT.md) · [Migration guide](../MIGRATION.md)
- [Next.js](NEXTJS.md) · [Vue](VUE.md)
