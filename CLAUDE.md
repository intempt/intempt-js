# intempt-js — repo instructions

## ⚑ Active work: SDK enterprise-hardening programme

There is an in-flight, multi-session programme on this repo. **Before doing any
work on branch `beso/sdk-enterprise-hardening`, read
[`docs/sdk-hardening/CHECKPOINT.md`](docs/sdk-hardening/CHECKPOINT.md) first.**

That file is the single source of truth for: what the programme is, which phase
is in progress, what the next concrete action is, and which decisions are already
settled (so they are not re-litigated). It is designed to be read cold, with no
prior conversation context.

Supporting documents:

- `docs/sdk-hardening/CHECKPOINT.md` — **state + next steps. Read this first.**
- `docs/sdk-hardening/AUDIT.md` — the full audit and 5-phase plan (reference; long).
- `docs/sdk-hardening/DECISIONS.md` — settled decisions with rationale.

**Update `CHECKPOINT.md` in the same commit as the work it describes.** A
checkpoint that lags the code is worse than no checkpoint, because the next
session trusts it.

## Build & test

```bash
npm run build            # production (tsc && vite build --mode production)
npm run build:staging    # staging, unminified
npm run build:dev        # development, unminified
npm test                 # cypress run (14 specs, __tests__/**/*.cy.ts)
```

There is currently **no lint gate, no unit-test tier, and no typecheck gate
separate from `build`**. Adding them is Phase 2/5 of the programme above — do not
be surprised by their absence.

## Branch & deploy model

`feature branch` → `staging` → `main`. **Production deploys only from `main`**
(`.github/workflows/build.yaml`), which uploads `dist/intempt.min.js` to the
`/v1` CDN path on S3.

Consequences to respect:

- The deploy path is **mutable** — overwriting `/v1/intempt.min.js` is the live
  bundle for every customer, and there is no prior artifact to roll back to.
  This already caused one incident (`af1a16b`, reverted in `3dc3a54`).
- After any deploy, verify the value actually changed in the **live** bundle, and
  spot-check real host sites that embed the SDK. Do not infer success from a
  green workflow.
- Never push directly to `staging` or `main`.

## Repo conventions

- TypeScript, `strict: true`, `target: ES2020`. Keep TS — it costs ~0 bundle
  bytes (no downlevel helpers are emitted).
- Path style: `src/<area>/<module>/<name>.module.ts`, models in `models/`, types
  in `types/`, guards in `guards/`.
- Imports include the `.ts` extension (existing convention — match it).
- Env config flows through `src/shared/envConfig.ts` (`EnvConfig`); do not read
  `import.meta.env` directly elsewhere.
