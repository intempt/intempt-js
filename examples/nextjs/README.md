# Next.js example

The App Router install. This is the one example that is not a single HTML file, because a
Next app has no HTML file to paste the snippet into.

| File                       | What it shows                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------- |
| `app/layout.tsx`           | The install — the loader as a `next/script` tag, and why `afterInteractive`         |
| `app/intempt/analytics.ts` | The wrapper. Guards `window` so a server-side call fails loudly instead of silently |
| `app/SignupForm.tsx`       | A client component calling it. Server components cannot: the SDK lives on `window`  |
| `app/intempt/intempt.d.ts` | The `window.intempt` surface, copied from [`../typescript`](../typescript)          |

## Run it

```bash
cd examples/nextjs
npm install
npm run dev
```

Then fill in your own `YOUR_ORG` / `YOUR_PROJECT` / `YOUR_SOURCE_ID` / `YOUR_KEY` in the
script URL in `app/layout.tsx`, exactly as the HTML examples do.

Type-checks on its own:

```bash
npm run typecheck
```

## Three things that will stop events flowing

1. **Placeholders.** The script URL ships with `YOUR_ORG` and friends. Nothing is sent
   until they are real.
2. **localhost is blocked by default.** The SDK refuses to track on `localhost` and
   `127.0.0.1`, so `npm run dev` sends nothing. Use a staging hostname.
3. **Server components.** `analytics.ts` throws if it is reached during server rendering.
   That is deliberate — the alternative is a call that silently does nothing.

## Why `afterInteractive`

The SDK captures page views on its own and does not need to run before hydration.
`beforeInteractive` would delay it for no benefit; `lazyOnload` would miss the first page
view. `afterInteractive` is the default for analytics tags and the right one here.
