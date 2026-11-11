# Registre portal

The web portal of Registre: a continuous, traceable register of audit evidence
for AWS MSP partner programmes. This directory is a **standalone package** — it
has its own `package.json`, its own dependencies and its own build. Nothing in
the root `package.json` is touched.

## Stack

- Vite 6 + React 18 + TypeScript (strict), no UI framework, hand-written CSS.
- No router dependency: `src/lib/router.ts` drives the URL with
  `history.pushState` and `useSyncExternalStore`.
- No state library: React context (`src/state/app.tsx`) plus small hooks.

## Commands

```bash
cd portal
npm install
npm run typecheck     # tsc -p tsconfig.json --noEmit
npm test              # node --test src/lib/ src/mocks/
npm run build         # vite build
npm run dev           # dev server on :5173
npm run check:sizes   # every file < 500 lines, every function < 50 lines
npm run check:wording # ENF-IA-01: no forbidden wording in src/
npm run check         # all of the above, in order
```

## Offline demonstration mode

The portal runs **without any backend**: `src/mocks/` holds the demo tenant
(one framework, 30 controls over six domains, 60 evidence files, a validation
queue, reminders, a frozen audit pack and a hash-chained audit trail) and
implements the same `RegistreApi` interface as the HTTP client.

The mode is chosen at build time:

| Variable | Effect |
|---|---|
| `VITE_USE_MOCKS=1` | the portal uses the offline mock (demo build) |
| `VITE_USE_MOCKS=0` | the portal calls the API |
| unset | the mock is used unless `VITE_API_URL` points at an API |

```bash
npm run build:demo   # build with VITE_USE_MOCKS=1 (.env.demo)
npm run dev:demo     # same, for the dev server
```

In HTTP mode the base URL comes from `VITE_API_URL` (default `/`, same origin).

### Demonstration accounts (EF-ADM-03)

| Login | Password | Role |
|---|---|---|
| `quality@northwind.example` | `demo-quality` | Quality lead (everything) |
| `owner@northwind.example` | `demo-owner` | Control owner (continuity controls) |
| `executive@northwind.example` | `demo-executive` | Executive (dashboards only) |
| `auditor@northwind.example` | `demo-auditor` | Internal auditor (asks questions) |
| `admin@northwind.example` | `demo-admin` | Administrator (settings) |

## Layout

```
src/
  api/          types.ts (mirror of the backend entities) and client.ts (16 endpoints)
  components/   shared presentation: cards, tables, badges, charts, forms
  lib/          states.ts (wording + colours), format.ts, router.ts, access.ts, redact.ts
  mocks/        offline tenant: framework, evidence, engine, activity, ask, client
  screens/      one folder or file per screen
  state/        session, app context, data hooks
  styles/       theme.css, layout.css, components.css, screens.css
scripts/        check-sizes.mjs, check-wording.mjs (CI guards)
```

## Wording

A control is never described with the word "compliant" (ENF-IA-01). The portal
only states what evidence exists, whether it is fresh and whether it carries
every expected element: **Covered**, **To renew**, **To verify**, **Expired**,
**No evidence**. The wording and the colours live in `src/lib/states.ts`, the
single source used by every screen.

## What still has to be wired to the real backend

- `POST /v1/auth/session` (Cognito) is assumed by the HTTP sign-in path.
- `GET /v1/settings` / `PUT /v1/settings` are an extension of chapter 15
  (EF-ADM-01) and must exist in the API.
- `GET /v1/frameworks/{id}/readiness` must return `statuses`, `byDomain`,
  `trend` and `costs` in the shape of `ReadinessOverview` (chapter 15).
- The archive of a pack is opened by its S3 URI; in production the API should
  return a signed URL instead.
