# Examples

Runnable pages. Four are a single self-contained HTML file with the real install snippet
in it — nothing bundled or built. Two are not: `typescript/` is declarations to copy, and
`nextjs/` is a real app, because a Next project has no HTML file to paste a snippet into.

| Example                                        | Shows                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [`basic-html/`](basic-html/index.html)         | The install snippet, `identify`, `track`, and a live log of everything the SDK sends                          |
| [`consent-banner/`](consent-banner/index.html) | `optIn`/`optOut` versus `consent`, and the order the two have to happen in                                    |
| [`spa/`](spa/index.html)                       | Automatic page views across a `pushState` router — how little you have to write                               |
| [`ecommerce/`](ecommerce/index.html)           | `productView`, `productAdd`, `productOrdered`                                                                 |
| [`typescript/`](typescript/)                   | Declarations for `window.intempt`, a typed wrapper, and the compile-time traps. Type-checks under `strict`    |
| [`nextjs/`](nextjs/)                           | The App Router install — `next/script`, and a wrapper that guards `window` so a server-side call fails loudly |

---

## Before you run anything: two things will stop events flowing

### 1. Fill in your own configuration

Every HTML example ships with placeholders in the script URL:

```
?organization=YOUR_ORG&project=YOUR_PROJECT&source=YOUR_SOURCE_ID&key=YOUR_KEY
```

Replace all four with values from your Intempt workspace. If any is left empty the SDK
logs `IntemptJs initialization failed: All config fields must be provided.` and
`window.intempt` stays a queue stub — your calls succeed and go nowhere.

Note the `key` is visible in the page. That is inherent to a browser SDK, not a mistake in
the example; use a write key scoped to one source.

### 2. `localhost` is blocked, by design

The SDK registers a guard that blocks tracking on `localhost`, `*.localhost` and
`127.0.0.1`, and a second one for bot and crawler user agents. So
`python3 -m http.server` at `http://localhost:8000` will load the SDK and then correctly
refuse to track. The page still works, the console says
`[Intempt] Tracking blocked by guard conditions`, and no event is sent.

There is no supported way to switch that off from the page. `window.__intemptGuardManager`
is exposed on `window`, but the guard decision is made in microtasks during the SDK's own
module evaluation — by the time a later `<script>` of yours runs, the decision is already
taken. Do not build on it.

**What works instead: serve the examples on a hostname that is not `localhost`.** Add a
line to your hosts file:

```
# /etc/hosts   (C:\Windows\System32\drivers\etc\hosts on Windows)
127.0.0.1   dev.example.test
```

Then serve the directory and open `http://dev.example.test:8000/`:

```bash
cd examples/basic-html
python3 -m http.server 8000
# or: npx serve -l 8000
```

Your LAN IP (`http://192.168.1.20:8000`) also works, since only the two literal localhost
names are blocked.

A staging domain is the other option, and the better one if you want the events to land in
a source you are willing to pollute.

---

## Reading the examples

Each file has the same three-part shape, in this order, in `<head>`:

1. **The queue stub.** Buffers `window.intempt.*` calls made before the SDK arrives, and
   the SDK replays them in order once it loads. This is why none of the examples wait for a
   ready callback.
2. **The SDK script**, `async`, with configuration in the query string. The `/v1/` path
   segment is required — the SDK locates its own `<script>` tag by matching that URL, and
   without it reads an empty configuration.
3. **Your code.**

Every example also listens for `intempt:event` and prints the payload on the page. That
listener is the fastest way to see whether a call was accepted, since it fires for
automatic events too — page views, clicks, form changes.

One caveat on that: `intempt:event` fires at **dispatch** time, before the event is
delivered to ingest. Seeing it in the log means the SDK accepted your call, not that the
event arrived.

## See also

- [API reference](../docs/API.md) — the exact validation rules and error strings
- [USAGE.md](../USAGE.md) — the narrative guide
- [React](../docs/integrations/REACT.md) · [Next.js](../docs/integrations/NEXTJS.md) · [Vue](../docs/integrations/VUE.md)
