# TypeScript example

Declarations and a typed wrapper for `window.intempt`, ready to copy into your project.

The SDK does not publish types — there is no module build to attach them to — so these are
declarations you maintain yourself. They are checked against the SDK source; see
[`docs/TYPESCRIPT.md`](../../docs/TYPESCRIPT.md) for the prose version.

| File | What it is |
|---|---|
| `types/intempt.d.ts` | The `window.intempt` surface. Copy this first. |
| `types/intempt-events.d.ts` | `WindowEventMap` augmentation so `e.detail` is typed in `intempt:*` listeners. |
| `analytics.ts` | A wrapper to put between your app and the global. This is the file worth copying. |
| `usage.ts` | Call sites for the wrapper, plus the runtime traps that compile cleanly. |
| `reservedTitles.ts` | Making the SDK's reserved event titles a compile error, and where that technique stops working. |
| `tsconfig.json` | Standalone, so this directory type-checks on its own. |

## Check it

```bash
npx tsc -p examples/typescript
```

Clean under `strict`, `noUnusedLocals` and `noUnusedParameters`. The three
`@ts-expect-error` lines in `reservedTitles.ts` are part of that check: if the conditional
type stopped rejecting reserved titles, `tsc` would fail on the unused suppressions.

This directory is not part of the repo's own `tsc` run — the root `tsconfig.json` includes
only `src`, `__tests__` and `tests`.

## Why `analytics.ts` exists

Three reasons, all of which cost you something if you skip it and call `window.intempt`
directly from components:

1. **The SDK may never appear.** It is blocked on `localhost`, on bot user agents, and by
   most ad blockers. Without a wrapper every call site needs `window.intempt?.…`, and the
   one that forgets throws in production.
2. **Validation throws on your stack.** A reserved title or an empty `data` raises an
   `Error` inside your click handler. `analytics.ts` catches those for tracking calls, and
   deliberately does *not* catch them for `optIn`/`optOut` — swallowing an error from a
   consent switch would leave you believing a visitor opted out when they did not.
3. **It is a seam for tests.** Mock one module instead of a global.

## Things the types cannot tell you

The declarations describe the shapes. They cannot describe the runtime guards, so these
compile and fail when they run:

- a [reserved event title](../../docs/API.md#reserved-event-titles) held in a `string`
  variable
- `track({ eventTitle: 'x', data: {} })` — `data` must be non-empty
- `identify({ userId: '' })` — `userId` must be truthy
- `consent({ action: 'accept', validUntil: 0 })` — compiles *and* succeeds;
  `validUntil` is never validated

`usage.ts` lists all four with the exact error each produces.

## What changes when the module build lands

A side-effect-free `createIntempt(config)` module build, a hand-authored public `.d.ts`, and
the `main`/`module`/`exports`/`types` fields are planned but **not shipped**. When they are,
`types/intempt.d.ts` here becomes unnecessary and the install becomes a real
`npm install` + `import`. `analytics.ts` stays useful: the wrapper's value is the no-op and
the error boundary, not the typing.
