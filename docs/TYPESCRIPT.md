# TypeScript quickstart

The SDK is written in TypeScript, but **it does not publish types yet**. There is no
`.d.ts` in the package and no `types` field in `package.json`, because there is nothing
importable to attach them to — the only build output is an IIFE that installs itself on
`window`.

So you declare the surface yourself. This page gives you a declaration file to copy, a
typed wrapper worth putting between your app and `window.intempt`, and the four type-level
traps in the current API.

Everything on this page is copied from
[`examples/typescript/`](../examples/typescript/), which type-checks clean under
`strict: true`:

```bash
npx tsc -p examples/typescript
```

---

## 1. Declare `window.intempt`

Drop this in your project as `types/intempt.d.ts` (any path covered by your `tsconfig`
`include` works — it needs no import to take effect).

```ts
// types/intempt.d.ts
export type ConsentAction = 'accept' | 'reject';

export interface IdentifyParams {
  userId: string;
  eventTitle?: string;
  userAttributes?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface GroupParams {
  accountId: string;
  eventTitle?: string;
  accountAttributes?: Record<string, unknown>;
}

export interface TrackParams {
  eventTitle: string;
  data: Record<string, unknown>;
}

export interface RecordParams {
  eventTitle: string;
  accountId?: string;
  userId?: string;
  accountAttributes?: Record<string, unknown>;
  userAttributes?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

export interface AliasParams {
  userId: string;
  anotherUserId: string;
}

export interface ConsentParams {
  action: ConsentAction;
  validUntil: number;
  email?: string;
  message?: string;
  category?: string;
}

export interface ProductParams {
  productId: string;
  quantity?: number;
}

export interface RecommendationParams {
  id: number;
  quantity: number;
  fields: string[];
}

export interface Intempt {
  /** Present only on the real SDK — `undefined` while the queue stub is in place. */
  readonly VERSION?: string;
  /** `true` while the queue stub is in place. */
  readonly _isStub?: boolean;

  identify(params: IdentifyParams): void;
  group(params: GroupParams): void;
  track(params: TrackParams): void;
  record(params: RecordParams): void;
  alias(params: AliasParams): void;
  consent(params: ConsentParams): void;

  productAdd(product: ProductParams): void;
  productView(productId: string): void;
  productOrdered(products: ProductParams[]): void;

  optIn(): void;
  optOut(): void;
  /** Returns `undefined` if called through the queue stub. */
  isUserOptIn(): boolean | undefined;
  logOut(): void;

  recommendation(params: RecommendationParams): Promise<unknown>;
}

declare global {
  interface Window {
    /** Absent until the install snippet has run. */
    intempt?: Intempt;
  }
}
```

Two deliberate choices in there:

- **`window.intempt` is optional.** It genuinely is absent before the snippet runs, and
  typing it as always-present is how you get a `Cannot read properties of undefined` in
  production.
- **`isUserOptIn()` returns `boolean | undefined`.** Through the queue stub it returns
  `undefined`, not `false`. Typing it `boolean` hides a real case: `!isUserOptIn()` is
  `true` for an _un-loaded_ SDK, which reads as "opted out" when it means "not ready".
- **Attribute bags are `Record<string, unknown>`, not `any`.** The SDK's own internal type
  is `{[key: string]: any}`; `unknown` gives you the same freedom on the way in without
  poisoning inference on the way out.

## 2. Wrap it

Do not call `window.intempt` from your components. One module in the middle buys you a
no-op when the SDK is blocked (localhost, bots, ad blockers), one place to catch validation
errors, and a seam for tests.

```ts
// analytics.ts
import type { IdentifyParams, TrackParams, Intempt } from './types/intempt';

/** Set from your own build config. Controls only whether swallowed errors are logged. */
const DEBUG = false;

function sdk(): Intempt | undefined {
  return typeof window === 'undefined' ? undefined : window.intempt;
}

/** True once the real SDK has replaced the queue stub. */
export function isReady(): boolean {
  const s = sdk();
  return s !== undefined && s._isStub !== true;
}

/**
 * Validation throws on your own stack. In an analytics call that is almost never
 * what you want — a mistyped event should not take down a checkout.
 */
function safely(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (DEBUG) console.warn('[analytics]', err);
  }
}

export function track(eventTitle: string, data: Record<string, unknown>): void {
  const s = sdk();
  if (!s) return;
  safely(() => s.track({ eventTitle, data } satisfies TrackParams));
}

export function identify(params: IdentifyParams): void {
  const s = sdk();
  if (!s) return;
  safely(() => s.identify(params));
}

export function optOut(): void {
  sdk()?.optOut();
}

export function optIn(): void {
  sdk()?.optIn();
}

/** `undefined` means "cannot tell yet", which is not the same as opted out. */
export function isOptedIn(): boolean | undefined {
  return sdk()?.isUserOptIn();
}

export async function recommend(
  id: number,
  quantity: number,
  fields: string[],
): Promise<unknown | null> {
  const s = sdk();
  if (!s) return null;
  // A non-JSON response body rejects rather than resolving to null — see docs/API.md.
  try {
    return (await s.recommendation({ id, quantity, fields })) ?? null;
  } catch {
    return null;
  }
}
```

Note `safely` wraps the tracking calls but **not** `optIn`/`optOut`. Swallowing an error
from a consent switch would leave you believing a visitor opted out when they did not.

## 3. Type the DOM events

The SDK broadcasts every event on `window` as a `CustomEvent`. Typing the map is what makes
`e.detail` usable.

```ts
// types/intempt-events.d.ts
interface IntemptEventDetail {
  eventName: string;
}
interface IntemptPayloadDetail {
  event: unknown;
}

declare global {
  interface WindowEventMap {
    'intempt:event': CustomEvent<IntemptPayloadDetail>;
    'intempt:track': CustomEvent<IntemptEventDetail>;
    'intempt:identify': CustomEvent<IntemptEventDetail>;
    'intempt:group': CustomEvent<IntemptEventDetail>;
    'intempt:record': CustomEvent<IntemptEventDetail>;
    'intempt:alias': CustomEvent<IntemptEventDetail>;
    'intempt:consent': CustomEvent<IntemptEventDetail>;
    'intempt:product': CustomEvent<IntemptEventDetail>;
    'intempt:logOut': CustomEvent<IntemptEventDetail>;
    'intempt:page': CustomEvent<IntemptEventDetail>;
    'intempt:session': CustomEvent<IntemptEventDetail>;
    'intempt:html': CustomEvent<IntemptEventDetail>;
    'intempt:shopify': CustomEvent<IntemptEventDetail>;
  }
}
```

```ts
window.addEventListener('intempt:event', (e) => {
  // e.detail.event is typed
  myLogger.debug(e.detail.event);
});
```

`event` is `unknown` because the payload shape is internal and has changed within the 6.x
line. Narrow it in your own code if you depend on a field, and expect to revisit that
narrowing.

## 4. Traps the type system will not catch for you

Types describe the declaration above; they cannot describe the runtime guards. These four
compile cleanly and fail at runtime:

| Compiles                                                        | Fails because                                                                      |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `track({ eventTitle: 'Click On', data: { a: 1 } })`             | `click on` is a [reserved title](API.md#reserved-event-titles). Case-insensitive.  |
| `track({ eventTitle: 'Signup', data: {} })`                     | `data` must be **non-empty**.                                                      |
| `identify({ userId: '' })`                                      | `userId` must be truthy — `''` is rejected.                                        |
| `consent({ action: 'accept' as ConsentAction, validUntil: 0 })` | Compiles _and_ runs; `validUntil` is never validated, so `0` is accepted and sent. |

If reserved titles matter in your codebase, make them unrepresentable:

```ts
type ReservedTitle =
  | 'auto-track'
  | 'view page'
  | 'leave page'
  | 'change on'
  | 'click on'
  | 'submit on'
  | 'identify'
  | 'consent';

/** `never` for a reserved title in any casing, otherwise `T` itself. */
type AllowedTitle<T extends string> =
  Lowercase<T> extends ReservedTitle ? never : T;

export function trackSafe<T extends string>(
  eventTitle: AllowedTitle<T>,
  data: Record<string, unknown>,
): void {
  window.intempt?.track({ eventTitle, data });
}
```

`trackSafe('Click On', {...})` and `trackSafe('identify', {...})` are both compile errors;
`trackSafe('consent banner shown', {...})` is not, matching the runtime guard's exact-match
rule. Those three cases are asserted with `@ts-expect-error` in
[`examples/typescript/reservedTitles.ts`](../examples/typescript/reservedTitles.ts).

The technique has a hard limit: a title held in a `string` variable has no literal type left
to test, so it compiles and is caught only at runtime. This helper is a convenience. The
guard in the SDK is the contract.

## 5. `tsconfig` notes

Nothing special is required. The declaration file above needs:

- `"lib"` including `"DOM"` — for `Window` and `CustomEvent`.
- `"skipLibCheck"` is not needed.
- If you use `isolatedModules` or `verbatimModuleSyntax`, keep `import type` on the type
  imports as shown.

If your bundler tree-shakes aggressively, note there is nothing to tree-shake: the SDK is
never part of your bundle. It arrives over the CDN at runtime, which also means **your
build cannot verify that the version you typed against is the version on the page**. The
`/v1/` CDN path is mutable — it is overwritten on release. Check `window.intempt.VERSION`
at runtime if a behaviour difference matters.

---

## When the module build lands

**Forthcoming — do not write this yet.** A module build exporting a side-effect-free
`createIntempt(config)` is planned, along with a hand-authored public `.d.ts` and the
`main`/`module`/`exports`/`types` fields. When it ships, the install story becomes
`npm install intemptjs` plus an import, the declaration file on this page becomes
unnecessary, and the `window.intempt` global becomes one option rather than the only one.
It is **not available today**; see [MIGRATION.md](MIGRATION.md) for what will change.

## See also

- [API reference](API.md) — the runtime contract these types describe
- [examples/typescript/](../examples/typescript/) — these files, ready to copy
- [React](integrations/REACT.md) · [Next.js](integrations/NEXTJS.md) · [Vue](integrations/VUE.md)
