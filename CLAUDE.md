# intempt-js — repo instructions

## ⚑ Active work: SDK enterprise-hardening programme

There is an in-flight, multi-session programme on this repo. **Before doing any
work on branch `beso/sdk-enterprise-hardening`, read
[`docs/sdk-hardening/CHECKPOINT.md`](docs/sdk-hardening/CHECKPOINT.md) first.**

That file is the single source of truth for: what the programme is, which phase
is in progress, what the next concrete action is, and which decisions are already
settled (so they are not re-litigated). It is designed to be read cold, with no
prior conversation context.

**`docs/sdk-hardening/` is gitignored as of 2026-08-12 and is NOT in the repo.** It is
working state for the in-flight programme, kept on the machine doing the work rather
than shipped to everyone who clones. Consequences to know before relying on it:

- A fresh clone has none of these files. If you are reading this on a machine that
  never ran the programme, the paths below will not resolve and that is expected — ask
  for the files rather than assuming the programme never existed.
- `git log` still contains them up to `251a10a`, so nothing is lost.
- **`DEFECTS.md` and `BACKEND.md` are the two a non-programme reader is most likely to
  need** — the known-defect register and the ingest handover spec. If either is wanted
  by someone else, hand over the file rather than un-ignoring the directory.

Supporting documents:

- `docs/sdk-hardening/CHECKPOINT.md` — **state + next steps. Read this first.**
- `docs/sdk-hardening/AUDIT.md` — the full audit and 5-phase plan (reference; long).
- `docs/sdk-hardening/DECISIONS.md` — settled decisions with rationale.
- `docs/sdk-hardening/BACKLOG.md` — **everything deliberately parked**, with what
  unblocks each item and what leaving it parked costs. `CHECKPOINT.md` §0b is what
  _is_ being worked; this is the complement. If an item appears in both, §0b wins.
- `docs/sdk-hardening/DEFECTS.md` — 26 known, documented, deliberately unfixed
  defects, with a suggested fix order. Read before "fixing" surprising behaviour:
  much of it is asserted by a test on purpose.
- `docs/sdk-hardening/RELEASE-NOTES-DRAFT.md` — customer-facing wording for the one
  behaviour change in the programme (DNT/GPC honoured by default), held here until
  packaging provides a `CHANGELOG.md`.

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

`ci.yml` runs `unit`, `examples`, `static`, `build`, `audit` and `mutation` on every pull
request; `browser-tests.yml` runs the Playwright suite on pull requests too, across two
runners. Lint and typecheck live inside `static`, and `mutation` carries its own threshold.

Read `mutation`'s configured file list before treating it as coverage of your change: it
mutates a fixed set, so a green score can be silent about every line a PR adds.

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
