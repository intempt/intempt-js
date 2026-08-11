# Next.js

**There is no `@intempt/next` package, and this is not one.** The SDK ships only as an IIFE
that installs itself on `window`, so there is nothing to `import` — this is an integration
guide, not an adapter. Read [REACT.md](REACT.md) first for the wrapper and hooks; this page
covers only what Next.js changes, which is mostly the two things that bite: **server
rendering** and **`next/script` load ordering**.

Covers the App Router (13.4+) and the Pages Router.

---

## 1. The SDK is client-only, and that is not negotiable

The install snippet touches `window` and `document.scripts` at module scope. In a Server
Component, during SSR, and during static generation, neither exists. So:

- Never import the wrapper into a Server Component's render path.
- Every file that calls `analytics.*` needs `'use client'`.
- Your wrapper must tolerate `typeof window === 'undefined'` — the one in
  [`examples/typescript/analytics.ts`](../../examples/typescript/analytics.ts) does, on
  purpose. Copy that behaviour rather than assuming a browser.

The wrapper returning a no-op on the server is what keeps `analytics.track(...)` callable from
shared code without a guard at every call site.

## 2. Loading the SDK: `next/script` with `beforeInteractive`

Two script tags, in order, and **the order is the whole point**: the stub must run before the
SDK so that calls made during hydration are buffered rather than lost.

### App Router — `app/layout.tsx`

```tsx
import Script from 'next/script';

const STUB = `
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
`;

const SDK_SRC =
  'https://cdn.intempt.com/v1/intempt.min.js' +
  '?organization=' +
  process.env.NEXT_PUBLIC_INTEMPT_ORG +
  '&project=' +
  process.env.NEXT_PUBLIC_INTEMPT_PROJECT +
  '&source=' +
  process.env.NEXT_PUBLIC_INTEMPT_SOURCE +
  '&key=' +
  process.env.NEXT_PUBLIC_INTEMPT_KEY;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Script
          id="intempt-stub"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: STUB }}
        />
        <Script id="intempt-sdk" src={SDK_SRC} strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
```

**`strategy="beforeInteractive"` for both.** With `afterInteractive` (the default) the stub can
land after your components have already mounted and called `analytics.track(...)`, and those
calls go to `undefined` — the wrapper no-ops them and the events are simply gone.
`beforeInteractive` is only honoured in `app/layout.tsx` or `pages/_document.tsx`; used
anywhere else Next.js downgrades it to `afterInteractive` and warns.

`lazyOnload` is wrong here for the same reason, plus it delays the automatic page view past
the point where most bounces have happened.

### Pages Router — `pages/_document.tsx`

Same two `<Script>` tags inside `<Head>`. `_document.tsx` renders once on the server, which is
exactly what you want for something that must be in the initial HTML.

## 3. The write key is public. Accept that, or do not use this SDK

`NEXT_PUBLIC_*` inlines the value into the client bundle, and the key is a query parameter on
a public script URL regardless. There is no server-side proxy option in the SDK today: the
credential is sent as an HTTP Basic header from the browser.

Practical consequences:

- Use a key scoped to one source, with write access only.
- Do not reuse a key that has read or admin scope anywhere else.
- Rotate it on the same schedule as any other public token.
- Putting it in `NEXT_PUBLIC_*` rather than hardcoding it buys you rotation without a code
  change. It does not make it secret.

## 4. Route changes: nothing to do, with one exception

The SDK patches `history.pushState`/`replaceState`, which is how both Next.js routers
navigate, so page views are automatic in the App Router and the Pages Router alike.

**Do not add a `usePathname`/`useSearchParams` effect that calls `track` on navigation.** You
will double-count every route change.

The exception is worth knowing about: Next.js uses `replaceState` in places you did not ask
for it, and **a `replaceState` to an unchanged URL emits a _Leave Page_ with no matching _View
Page_**. If your exit counts look inflated, that is where to look. There is no client-side fix
in the SDK today; deduplicate on the platform side.

## 5. Identify after auth resolves, not on first render

```tsx
'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import * as analytics from '@/analytics';

export function IntemptIdentity() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.id) return;
    analytics.identify({
      userId: session.user.id,
      eventTitle: 'Signed In',
      userAttributes: { email: session.user.email ?? undefined },
    });
  }, [status, session?.user?.id]);

  return null;
}
```

Render it once in the layout. Keying on `session?.user?.id` rather than the session object
avoids re-identifying on every token refresh.

`userAttributes` require an `eventTitle`; omitting the title throws.

## 6. What not to do

| Don't                                        | Why                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inject the SDK `<script>` from a `useEffect` | Effects run twice in dev Strict Mode. Two tags means two SDK instances and doubled page views.                                                                       |
| Call `analytics.*` from a Server Component   | No `window`. Best case it no-ops silently; worst case a bare `window.intempt` reference throws during SSR.                                                           |
| `strategy="afterInteractive"` on the stub    | Components can mount and call before the stub exists. Those events are lost.                                                                                         |
| Track route changes yourself                 | Already automatic through the History API patch.                                                                                                                     |
| Read `isUserOptIn()` during the first render | Through the queue stub it returns `undefined`, and `!undefined` reads as "opted out". Wait for readiness — see the consent hook in [REACT.md](REACT.md).             |
| Pin an SRI `integrity` hash on the CDN URL   | The `/v1/` path is mutable and republished in place, so the hash will start failing and silently disable your analytics. Self-host a versioned copy if you need SRI. |

## 7. Middleware, edge, and CSP

The SDK is browser-only, so nothing runs at the edge. If you set a CSP in `middleware.ts` or
`next.config.js`, it needs:

```
script-src 'self' https://cdn.intempt.com;
connect-src 'self' https://api.intempt.com;
```

If you use a nonce-based CSP, pass `nonce` to both `<Script>` tags. The SDK also applies DOM
changes for experiences, which needs `style-src` to allow whatever those experiences use — the
strictest workable setting depends on your experience content, so verify with the browser
console rather than assuming.

---

## What changes when the module build lands

A side-effect-free `createIntempt(config)` export, a public `.d.ts`, and the
`main`/`module`/`exports`/`types` fields are planned but **not shipped**. When they are, the
two `<Script>` tags collapse into an import in a client component, and configuration moves out
of `NEXT_PUBLIC_*` query parameters and into code. Until then the script tags are the install.

## See also

- [React](REACT.md) — the wrapper and hooks this page builds on
- [API reference](../API.md) · [TypeScript quickstart](../TYPESCRIPT.md) · [Migration guide](../MIGRATION.md)
