# Vue

**There is no `@intempt/vue` package, and this is not one.** The SDK's only build output is an
IIFE that installs itself on `window`, so there is nothing to `import` and nothing for a
plugin to instantiate. What follows is an integration guide: script tags in `index.html`, one
wrapper module, and a composable. About 50 lines you own.

Vue 3, Composition API. Notes for Nuxt are at [the end](#nuxt).

---

## 1. Script tags in `index.html`

```html
<!-- index.html -->
<head>
  <!-- Queue stub: buffers window.intempt.* calls until the SDK arrives -->
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

  <script
    async
    src="https://cdn.intempt.com/v1/intempt.min.js?organization=YOUR_ORG&project=YOUR_PROJECT&source=YOUR_SOURCE_ID&key=YOUR_KEY">
  </script>
</head>
```

The stub is what lets you skip a readiness gate everywhere: a `track()` from a component
created before the SDK finishes downloading is buffered and replayed in order.

**The `/v1/` path segment is required.** The SDK finds its own tag by matching that URL; without
it, it reads an empty configuration and never starts.

Do not inject the tag from `onMounted` — a second tag means a second SDK instance and doubled
page views, and you gain nothing over putting it in the HTML.

## 2. Declare the global, then wrap it

Copy [`examples/typescript/types/intempt.d.ts`](../../examples/typescript/types/intempt.d.ts)
as `src/types/intempt.d.ts`, and
[`examples/typescript/analytics.ts`](../../examples/typescript/analytics.ts) as
`src/analytics.ts`. Components import the wrapper, never `window`.

## 3. A plugin is optional, and mostly for `app.config.globalProperties`

There is no instance to inject, so a plugin buys you only template access:

```ts
// src/intempt.plugin.ts
import type { App } from 'vue';
import * as analytics from './analytics';

export const intemptPlugin = {
  install(app: App) {
    // Lets templates call $intempt.track(...) without an import.
    app.config.globalProperties.$intempt = analytics;
    // For composables and setup():
    app.provide('intempt', analytics);
  },
};
```

```ts
// src/main.ts
import { createApp } from 'vue';
import App from './App.vue';
import { intemptPlugin } from './intempt.plugin';

createApp(App).use(intemptPlugin).mount('#app');
```

For TypeScript in templates, augment the instance type:

```ts
// src/types/vue-intempt.d.ts
import type * as analytics from '../analytics';

declare module 'vue' {
  interface ComponentCustomProperties {
    $intempt: typeof analytics;
  }
}
```

Importing `analytics` directly in `<script setup>` works just as well and type-checks without
the augmentation. Skip the plugin unless you want the template shorthand.

## 4. Router: usually nothing to do

The SDK patches `history.pushState`/`replaceState` and listens for `popstate`, so
`createWebHistory()` produces automatic page views. **Do not add a
`router.afterEach(() => track(...))`** — you will double-count.

Two exceptions:

- **`createWebHashHistory()` is not tracked.** The SDK does not listen for `hashchange`. Either
  switch to `createWebHistory()`, or emit your own:

  ```ts
  // Only for createWebHashHistory(). With createWebHistory() this double-counts.
  router.afterEach((to) => {
    analytics.track('Route Changed', { path: to.fullPath });
  });
  ```

- **`router.replace()` to an unchanged URL emits a spurious *Leave Page*** with no matching
  *View Page*. Vue Router uses `replaceState` for `router.replace` and for query-param updates,
  so a filter UI that calls `router.replace({ query })` on each keystroke produces a stream of
  exit events. Debounce it, or keep that state out of the URL.

## 5. Identity

```ts
// src/composables/useIntemptIdentity.ts
import { watch, type Ref } from 'vue';
import * as analytics from '../analytics';

export function useIntemptIdentity(user: Ref<{ id: string; email: string } | null>) {
  watch(
    // Watch the id, not the object: a re-fetched user with the same id should not
    // re-identify.
    () => user.value?.id,
    (id) => {
      if (!id) return;
      analytics.identify({
        userId: id,
        eventTitle: 'Signed In',
        // userAttributes require an eventTitle — omitting it throws.
        userAttributes: { email: user.value!.email },
      });
    },
    { immediate: true },
  );
}
```

On sign-out call `analytics.logOut()`, which resets profile and session state. Skip it and the
next person on a shared machine inherits the previous profile.

## 6. Consent

`optOut()`/`optIn()` control collection. `consent()` records the visitor's decision as an event
and **does not stop tracking**. A reject flow needs both, in that order — `consent()` is itself
gated on the opt-out flag, so opting out first silently drops the record of the refusal.

```ts
// src/composables/useConsent.ts
import { ref, onMounted } from 'vue';
import * as analytics from '../analytics';

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function useConsent() {
  // undefined = not known yet. Through the queue stub isUserOptIn() returns nothing, and
  // rendering `!undefined` as "opted out" paints the toggle wrong on first paint.
  const optedIn = ref<boolean | undefined>(undefined);

  onMounted(async () => {
    const ready = await analytics.whenReady();
    optedIn.value = ready ? analytics.isOptedIn() : undefined;
  });

  function accept() {
    analytics.recordConsent('accept', Date.now() + ONE_YEAR_MS);
    optedIn.value = true;
  }

  function reject() {
    analytics.recordConsent('reject', Date.now() + ONE_YEAR_MS);
    optedIn.value = false;
  }

  return { optedIn, accept, reject };
}
```

The opt-out flag lives in `localStorage`, so it is **origin-scoped**: an opt-out on
`www.example.com` does not carry to `shop.example.com`.

## 7. Events from components

```vue
<script setup lang="ts">
import * as analytics from '../analytics';

const props = defineProps<{ rows: number }>();

function onExport() {
  analytics.track('Dashboard Exported', { format: 'csv', rows: props.rows });
}
</script>

<template>
  <button @click="onExport">Export</button>

  <!-- Masks this element's captured text in the SDK's automatic click/change events -->
  <span doNotCapture>{{ accountBalance }}</span>
</template>
```

The SDK already captures clicks, changes and submits with the element's tag, id, classes,
visible text and selector path. Use `track` for the *meaning* of an action, not its occurrence.

`doNotCapture` works as written in a template — Vue passes unknown attributes through and HTML
attribute names are case-insensitive. It masks the captured **text** only: the element's tag and
id still go out, and values submitted through a form are not stripped.

## 8. Testing

Mock the wrapper, not the global:

```ts
vi.mock('@/analytics', () => ({
  track: vi.fn(),
  identify: vi.fn(),
  logOut: vi.fn(),
  whenReady: () => Promise.resolve(true),
  isOptedIn: () => true,
}));
```

In JSDOM the SDK never loads, so asserting on `window.intempt` only exercises the wrapper's
no-op path.

---

## Nuxt

Nuxt renders on the server, which adds the same constraint Next.js has: the SDK is
browser-only.

- Put the two script tags in `nuxt.config.ts` under `app.head.script`, stub **first**. Order in
  that array is the order in the HTML, and it matters — a component that calls the wrapper
  before the stub exists loses the event.
- Any composable that touches `window.intempt` belongs in a `.client.ts` plugin, or behind
  `import.meta.client`.
- The wrapper in `examples/typescript/analytics.ts` already returns early when
  `typeof window === 'undefined'`, which is what makes it safe to import from shared code.
- Configuration goes in `runtimeConfig.public`. As with any browser SDK the write key ends up in
  the page — use a key scoped to one source with write access only, and rotate it like any other
  public token.

## What changes when the module build lands

A side-effect-free `createIntempt(config)` export, a public `.d.ts`, and the
`main`/`module`/`exports`/`types` fields are planned but **not shipped**. When they are, the
script tags become an import, a real Vue plugin can own an instance instead of a module of
functions, and `types/intempt.d.ts` becomes unnecessary.

## See also

- [API reference](../API.md) · [TypeScript quickstart](../TYPESCRIPT.md) · [Migration guide](../MIGRATION.md)
- [React](REACT.md) · [Next.js](NEXTJS.md)
