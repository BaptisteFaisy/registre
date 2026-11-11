# Portal ↔ API integration

How the web portal (`portal/`) is wired to the Registre API. The contract
itself — routes, roles, shapes, errors — lives in [`API.md`](./API.md); this
page is the operating manual: which variables choose the mode, how a session
is obtained, how to run both sides locally, how to load the demonstration
dataset, and which test proves the wiring.

---

## 1. Two modes, one interface

The portal talks to a single interface, `RegistreApi`
(`portal/src/api/client.ts`), implemented twice:

| Implementation | File | When |
|---|---|---|
| `HttpRegistreApi` | `portal/src/api/client.ts` | the portal calls the real API |
| `MockRegistreApi` | `portal/src/mocks/client.ts` | the portal runs offline, on the built-in demonstration tenant |

The choice happens once, at start-up, in `portal/src/state/app.tsx`. Every
screen uses the injected client and therefore behaves the same in both modes.

## 2. Environment variables

Both variables are read at build time by Vite (`import.meta.env`), so they must
be present when the dev server or the build starts.

| Variable | Values | Effect |
|---|---|---|
| `VITE_USE_MOCKS` | `1` / `true` | force the offline mock |
| | `0` / `false` | force the HTTP client |
| | unset | the mock is used, **unless** `VITE_API_URL` is set |
| `VITE_API_URL` | absolute base URL, or `/` | base URL of the API; `/` means same origin |

`VITE_USE_MOCKS` wins when it is set. Reference files: `portal/.env.example`
(the HTTP mode) and `portal/.env.demo` (the offline build, used by
`npm run dev:demo` and `npm run build:demo`).

To talk to a local API:

```bash
VITE_API_URL=http://127.0.0.1:8787 VITE_USE_MOCKS=0 npm run dev
```

## 3. Session: how the portal gets a token

1. The sign-in screen hands the credentials to `SessionFlow.signIn`
   (`portal/src/state/auth.ts`), which calls the identity client `AuthApi`:
   `HttpAuthApi` in HTTP mode (`portal/src/api/auth.ts`), `MockAuthApi` in the
   offline mode. `HttpAuthApi` posts to `POST /v1/auth/session` through the
   same `HttpClient` as the business routes.
2. The API answers `{ "token": "...", "principal": { ... } }` and sets the
   `registre_session` cookie.
3. Both are kept in `sessionStorage` (`portal/src/state/session.ts`, keys
   `registre.token` and `registre.principal`), so a page reload does not sign
   the judges out.
4. Every later call carries `Authorization: Bearer <token>`; `HttpClient`
   adds the header from the injected `TokenProvider`. The API also accepts the
   same token in the `registre_session` cookie.
5. Sign-out calls `POST /v1/auth/logout`, which clears the cookie server-side;
   the flow then drops the stored principal and token. A failed logout is
   tolerated — the local session ends anyway, so the portal always reaches the
   sign-in screen.

A `401` from any route means the session is gone: `HttpClient` calls the
`onUnauthorized` hook, wired to `SessionFlow.endSession()`, which drops back to
the sign-in screen; `ApiError.isUnauthorized` is what the screens test.

The token of the demonstration directory is `base64url(login:password)`, which
makes it easy to build one by hand for a `curl` call:

```bash
TOKEN=$(printf '%s' '<login>:<password from docs/DEMO.md>' | base64 | tr '+/' '-_' | tr -d '=\n')
```

## 4. Run the API locally

```bash
node src/api/server.ts          # or: npm run api
```

The server binds `127.0.0.1:8787` (`PORT` and `HOST` override it), prints the
served route table, and serves `GET /healthz` and `GET /openapi.json` without
authentication. With no AWS credentials it falls back to the offline service
bundle (`src/api/demoServices.ts`: in-memory store, mock Bedrock, local
vault), so the API answers with no account and no network.

CORS is open by default (`access-control-allow-origin: *`, allowed headers
`authorization`, `content-type`, `x-request-id`), which is what makes the
cross-origin dev setup work: portal on `:5173`, API on `:8787`. For a
deployment, pass `corsOrigins` to `createServer` and list the portal origin.

## 5. Load the demonstration dataset

```bash
node tools/demo/generate.ts     # writes demo/data/framework.json and demo/data/evidence/*
node tools/demo/generate.ts --check   # verify the SHA-256 of what is on disk (CI)
```

The generator is deterministic: it reads the shared catalogue
(`eval/catalogue.ts`) and writes one framework import payload and the sixty
evidence documents. The same catalogue feeds the evaluation harness, so the
demo and the metrics cannot drift apart.

A freshly started API has an empty store: load the dataset **through the
contract**, which is also the cheapest end-to-end check of it.

```bash
BASE=http://127.0.0.1:8787
curl -s -X POST "$BASE/v1/frameworks" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' --data-binary @demo/data/framework.json

for file in demo/data/evidence/*; do
  curl -s -X POST "$BASE/v1/evidence?filename=$(basename "$file")" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/octet-stream' \
    --data-binary @"$file" > /dev/null
done

curl -s "$BASE/v1/frameworks/demo-msp/readiness" -H "Authorization: Bearer $TOKEN"
```

The framework import is `POST /v1/frameworks` (§3.5 of `API.md`), each deposit
uses the raw-document form of `POST /v1/evidence` (§3.9), and the last call
recomputes the dashboard in one request. `node tools/demo/main.ts`
(`npm run demo`) runs the same flow in-process, without HTTP, and writes
`demo-out/report.md`.

## 6. Run the portal against it

```bash
cd portal
npm install                     # once
VITE_API_URL=http://127.0.0.1:8787 VITE_USE_MOCKS=0 npm run dev
```

The dev server listens on `:5173`. Sign in with one of the demonstration
accounts of [`DEMO.md`](./DEMO.md); the portal exchanges the credentials for a
token (§3) and every screen then calls the API. `npm run check` in `portal/`
runs the portal's own typecheck, tests and size/wording guards.

## 7. The test that proves the wiring

`test/contract/api-portal.test.ts`, run by the root `npm test`:

```bash
npm test                                        # every test, the contract test included
node --test test/contract/api-portal.test.ts     # the contract test alone
```

It boots the real server (`src/api/server.ts`) on an ephemeral loopback port,
seeds it with the demonstration set (`seedDemoData` from
`tools/demo/main.ts`), and drives **the real `HttpRegistreApi`** over HTTP as
two different identities (a quality lead and an internal auditor). It asserts,
among others:

- `POST /v1/auth/session` returns a usable token, and `GET /v1/auth/accounts`
  lists the identities without any password;
- the list routes answer bare arrays — frameworks, controls, evidence,
  validations, reminders, audit events, packs;
- `GET /v1/frameworks/{id}/readiness` carries the whole dashboard in one call;
- `POST /v1/evidence` accepts base64 bytes and `GET /v1/evidence/{id}` returns
  the excerpts;
- `POST /v1/ask` answers with citations, and refuses with the exact
  no-evidence sentence when nothing answers;
- a `RESTRICTED` evidence is refused to the internal auditor (R13);
- every path the portal calls appears in the generated `GET /openapi.json`.

No network outside `127.0.0.1`, no AWS account, no fixed port, no sleeps: the
test is the executable form of ADR-14 ("the portal client is the API
contract").

## 8. Portal screen → routes called

| Screen (file) | Routes |
|---|---|
| Sign-in (`screens/Login.tsx`, `state/app.tsx`) | `POST /v1/auth/session`; `GET /v1/auth/accounts` for the judges' reminder sheet; `POST /v1/auth/logout` on sign-out |
| Readiness (`screens/Readiness.tsx`, `state/useData.ts`) | `GET /v1/frameworks`; `GET /v1/frameworks/{id}/readiness` |
| Controls (`screens/Controls.tsx`, `screens/controls/useControlsList.ts`) | `GET /v1/frameworks/{id}/controls`; the states come from the readiness call |
| Control detail (`screens/ControlDetail.tsx`) | `GET /v1/controls/{id}` |
| Remind (`screens/control/ReminderAction.tsx`) | `POST /v1/controls/{id}/remind` |
| Evidence (`screens/Evidence.tsx`) | `GET /v1/evidence/{id}` |
| Deposit (`components/UploadModal.tsx`) | `POST /v1/evidence` |
| Validation queue (`screens/Validation.tsx`, `screens/validation/*`) | `GET /v1/validations?status=pending`; `POST /v1/validations/{id}/decision`; `GET /v1/evidence/{id}` for the titles |
| Queue badge (`components/Sidebar.tsx`) | `GET /v1/validations?status=pending` |
| Ask (`screens/Ask.tsx`) | `POST /v1/ask` |
| Packs (`screens/Packs.tsx`, `screens/packs/usePacks.ts`) | `GET /v1/packs?frameworkId=`; `POST /v1/frameworks/{id}/packs`; `GET /v1/packs/{id}`; the download link points at `GET /v1/packs/{id}/archive` |
| Reminders (`screens/Reminders.tsx`, `screens/reminders/useReminders.ts`) | `GET /v1/reminders`; `POST /v1/controls/{id}/remind` |
| Audit log (`screens/AuditLog.tsx`) | `GET /v1/audit-log?limit=&action=` |
| Settings (`screens/Settings.tsx`) | `GET /v1/settings`; `PUT /v1/settings` |
| Framework import (administration) | `POST /v1/frameworks`; `GET /v1/frameworks/{id}/diff` for the version comparison |

## 9. Known gaps of the wiring

Documented so that nobody rediscovers them at the worst moment:

- **`GET /v1/auth/accounts` has no client.** The session and the logout are
  served by `AuthApi`, but the accounts route is not: the sign-in screen still
  renders the mock account list (`portal/src/mocks/principals.ts`) in both
  modes, so in HTTP mode it offers logins the API does not know. The route is
  public and never returns a password — reading it is what makes the judges'
  reminder sheet real (EF-ADM-03).
- **Two envelope fields the API ignores.** `buildEvidencePayload`
  (`portal/src/api/evidencePayload.ts`) sends `sizeBytes` and `accessLevel`
  beside the documented `filename`, `contentType`, `contentBase64`, `fileDate?`
  and `controlId?`. The API derives the size from the bytes and the access
  level from what the reader finds in the document, so the level chosen in the
  deposit form has no effect today.
- **Browser uploads and `X-File-Name`.** The CORS policy allows
  `authorization`, `content-type` and `x-request-id` only, so a browser must
  name the file with `?filename=` rather than with the `X-File-Name` header
  (a preflight would refuse it). Server-side callers may use either.
