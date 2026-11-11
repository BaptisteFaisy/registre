# Registre HTTP API — contract
This page is the contract between the Registre API and the programs that call
it. The reference consumer is the portal client (`portal/src/api/client.ts`),
whose types live in `portal/src/api/types.ts`: every shape named below is the
one the portal actually reads. When the two ever disagree, the client wins —
see ADR-14 in [`DECISIONS.md`](./DECISIONS.md). The machine-readable version
of this contract is served by the API itself at `GET /openapi.json`.

## 1. Overview
### 1.1 Base URL
| Where | Base URL |
|---|---|
| Local API (`node src/api/server.ts`) | `http://127.0.0.1:8787` |
| Deployed API | the `ApiUrl` output of the `Registre-Api` stack |
| Portal same-origin deployment | `/` (the portal prefixes `/v1/...`) |

All routes are prefixed with `/v1`. Two unauthenticated helpers sit outside that prefix: `GET /healthz` (liveness) and `GET /openapi.json`.

### 1.2 Authentication
Every route except the three authentication routes requires a session. The token is sent either as a header or as a cookie: `Authorization: Bearer <token>` or `Cookie: registre_session=<token>`; the bearer header wins when both are present. The token of the demonstration directory is `base64url(login:password)`; in a Cognito-backed deployment it is the identity provider's access token, and the same routes serve it.

`POST /v1/auth/session` exchanges a login and a password for a token and a principal. `POST /v1/auth/logout` closes the session and clears the cookie. `GET /v1/auth/accounts` is public and lists the accounts of the demonstration directory **without their passwords** — it is the reminder sheet of the judges' sign-in screen (EF-ADM-03). A missing or unknown token is `401`: it carries no justification and is not written to the audit trail.

### 1.3 Roles
| Code | Role | What it may do |
|---|---|---|
| `QL` | `QUALITY_LEAD` | Everything: readiness, validation queue, packs, settings |
| `CO` | `CONTROL_OWNER` | Own controls only: deposit evidence, read them, remind |
| `EX` | `EXECUTIVE` | Read-only: readiness, trends, evidence |
| `IA` | `INTERNAL_AUDITOR` | Read-only, asks questions, reads packs |
| `AD` | `ADMIN` | Everything, plus settings |

"Read" always means two things: the role is allowed on the route **and** the caller's clearance covers the access level of the evidence (`PUBLIC` < `INTERNAL` < `RESTRICTED`). A control owner sees only the controls it owns.

### 1.4 Errors
Every failure — domain or transport — leaves the API in one shape:
`{ "error": { "code": "NOT_FOUND", "message": "control CONT-99 does not exist", "detail": { "controlId": "CONT-99" } } }`

| Code | HTTP | When |
|---|---|---|
| `BAD_REQUEST` | 400 | Malformed body, unknown field, value out of range |
| `NOT_FOUND` | 404 | Unknown framework, control, evidence, pack or validation item |
| `CONFLICT` | 409 | Duplicate content, version already imported, item already decided, no reminder justified |
| `FORBIDDEN` | 403 | Role not allowed, or access level above the clearance (logged `ACCESS_DENIED`) |
| `UNREADABLE` | 422 | Evidence cannot be read: corrupt file, unsupported type |
| `UPSTREAM` | 502 | Bedrock, DynamoDB or S3 failure |
| `CONFIG` | 502 | Missing environment variable or unusable setting |

Three codes belong to the transport, not to the domain: `UNAUTHENTICATED`
(401, no detail), `METHOD_NOT_ALLOWED` (405) and `PAYLOAD_TOO_LARGE` (413).

### 1.5 Conventions
**Timestamps** are ISO-8601 instants with an offset (`2026-11-11T09:30:00+01:00`); **periods** are ISO-8601 durations (`P30D`, `P3M`, `P1Y`). **Request bodies** are JSON (`Content-Type: application/json`), except `POST /v1/evidence`, which also accepts a raw document (§3.9). **Lists are bare arrays:** a list route answers with the array itself, never with an envelope; the only filters are query parameters. **Identifiers** used in this page belong to the demonstration dataset: framework `demo-msp`, controls `CONT-01`…, evidence `ev-001`… In the examples below, `…` marks the fields elided for readability; §4 has the full shapes.

## 2. Route summary
One table, one truth. Every route below is described in §3.

| Method | Path | Roles | Requirement | Answers |
|---|---|---|---|---|
| `POST` | `/v1/auth/session` | public | EF-ADM-03 | `{ token, principal }` |
| `POST` | `/v1/auth/logout` | any signed-in role | EF-ADM-03 | `204`, cookie cleared |
| `GET` | `/v1/auth/accounts` | public | EF-ADM-03 | `[{ login, role, name }]` |
| `GET` | `/v1/frameworks` | QL, CO, EX, IA, AD | EF-REF-02 | `Framework[]` |
| `POST` | `/v1/frameworks` | QL, AD | EF-REF-01 | `Framework` (201) |
| `GET` | `/v1/frameworks/{id}/controls` | QL, CO, EX, IA, AD | EF-REF-01 | `Control[]` |
| `GET` | `/v1/frameworks/{id}/diff` | QL, CO, EX, IA, AD | EF-REF-05 | `{ added, changed, removed }` or `null` |
| `GET` | `/v1/frameworks/{id}/readiness` | QL, CO, EX, IA, AD | EF-FRA-03 | `ReadinessOverview` |
| `POST` | `/v1/evidence` | QL, CO, AD | EF-COL-02 | `Evidence` (201 new, 200 duplicate) |
| `GET` | `/v1/evidence/{id}` | QL, CO, EX, IA, AD | EF-LEC-03 | `Evidence` |
| `GET` | `/v1/controls/{id}` | QL, CO, EX, IA, AD | EF-FRA-02 | `ControlWithRelations` |
| `GET` | `/v1/controls/{id}/evidence` | QL, CO, EX, IA, AD | EF-RAT-02 | `Evidence[]` |
| `POST` | `/v1/controls/{id}/remind` | QL, CO, AD | EF-REL-01 | `Reminder` (201) |
| `GET` | `/v1/validations` | QL, CO, AD | EF-VAL-01 | `ValidationItem[]` |
| `POST` | `/v1/validations/{id}/decision` | QL, AD | EF-VAL-02 | `ValidationItem` |
| `POST` | `/v1/ask` | QL, CO, EX, IA, AD | EF-QR-01 | `Answer` |
| `POST` | `/v1/frameworks/{id}/packs` | QL, AD | EF-DOS-01 | `Pack` (201) |
| `GET` | `/v1/packs` | QL, IA, AD | EF-DOS-02 | `Pack[]` |
| `GET` | `/v1/packs/{id}` | QL, IA, AD | EF-DOS-02 | `Pack` + `downloadUrl` |
| `GET` | `/v1/packs/{id}/archive` | QL, IA, AD | EF-DOS-02 | zip stream |
| `GET` | `/v1/reminders` | QL, CO, IA, AD | EF-REL-01 | `Reminder[]` |
| `GET` | `/v1/audit-log` | QL, IA, AD | EF-ADM-02 | `AuditEvent[]` |
| `GET` | `/v1/settings` | QL, AD | EF-ADM-01 | `Settings` |
| `PUT` | `/v1/settings` | QL, AD | EF-ADM-01 | `Settings` |

---

## 3. Routes

### 3.1 `POST /v1/auth/session` — open a session
Public. Body `{ "login": string, "password": string }`. Answers `200` with `{ "token", "principal" }`; the token is `base64url(login:password)` for the demonstration directory, and is then sent back as `Authorization: Bearer <token>` or in the `registre_session` cookie.
```json
{ "token": "cXVhbGl0eS5sZWFkQGRlbW8tbXNwLmV4YW1wbGU6cXVhbGl0eS1kZW1v",
  "principal": { "id": "u-quality", "name": "Camille Roy", "email": "quality.lead@msp.demo",
                 "role": "QUALITY_LEAD", "clearance": "RESTRICTED", "ownedControls": [] } }
```
Errors: `401` (unknown login or password, no detail).

### 3.2 `POST /v1/auth/logout` — close a session
Any signed-in role. No body. Answers `204` with no content and clears the `registre_session` cookie.

### 3.3 `GET /v1/auth/accounts` — accounts of the demonstration directory
Public, no parameter. Answers the accounts that may sign in, **without their passwords** (EF-ADM-03): the passwords stay in [`DEMO.md`](./DEMO.md).
```json
[ { "login": "quality.lead@msp.demo", "role": "QUALITY_LEAD", "name": "Camille Roy" },
  { "login": "control.owner@msp.demo", "role": "CONTROL_OWNER", "name": "Louis Mercier" } ]
```

### 3.4 `GET /v1/frameworks` — list frameworks
All roles, no parameter. Answers a bare `Framework[]`.
```json
[ { "id": "demo-msp", "name": "AWS MSP demonstration framework", "version": "1.0",
    "importedAt": "2026-11-11T09:30:00+01:00", "confidentiality": "INTERNAL" } ]
```
Errors: `FORBIDDEN` (restricted framework), `UPSTREAM`.

### 3.5 `POST /v1/frameworks` — import a framework
`QL`, `AD`. Body: the import payload — `{ "framework": { id, name, version, confidentiality?, source? }, "controls": ControlInput[] }`. Answers `201` with the bare `Framework`; the version diff is a separate route (§3.7), so the import and the diff never travel together.
```json
{ "id": "demo-msp", "name": "AWS MSP demonstration framework", "version": "1.0",
  "importedAt": "2026-11-11T09:30:00+01:00", "confidentiality": "INTERNAL", "source": "demo/data/framework.json" }
```
Errors: `BAD_REQUEST` (invalid periodicity, empty expected evidence, duplicate control id), `CONFLICT` (same version already imported), `FORBIDDEN`.

### 3.6 `GET /v1/frameworks/{id}/controls` — controls of a framework
All roles. Path parameter `id`. Answers a bare `Control[]`, in the order of the framework.
```json
[ { "id": "CONT-01", "frameworkId": "demo-msp", "domain": "security",
    "title": "Information security policy reviewed at least once a year",
    "requirement": "The information security policy is reviewed and approved every year.",
    "expectedEvidence": ["Policy document", "Review date", "Approver name"],
    "periodicity": "P1Y", "owner": "quality.lead", "mandatory": true } ]
```
Errors: `NOT_FOUND` (unknown framework), `FORBIDDEN` (restricted framework).

### 3.7 `GET /v1/frameworks/{id}/diff` — version diff
All roles. Path parameter `id`. Answers the diff against the previous version of the framework (EF-REF-05): `{ added, changed, removed }`, each a list of control ids, or `null` when there is no previous version to compare with.
```json
{ "added": ["CONT-16"], "changed": ["CONT-01"], "removed": [] }
```
Errors: `NOT_FOUND`, `FORBIDDEN`.

### 3.8 `GET /v1/frameworks/{id}/readiness` — readiness of a framework
All roles. Path parameter `id`. One call feeds the whole dashboard: framework, snapshot, trend, state of every control, distribution per domain and cost per evidence.
```json
{ "framework": { "id": "demo-msp", "name": "AWS MSP demonstration framework", "version": "1.0", "…": "…" },
  "snapshot": { "frameworkId": "demo-msp", "computedAt": "2026-11-11T09:30:00+01:00", "total": 30,
                "counts": { "COVERED": 17, "TO_RENEW": 4, "TO_VERIFY": 5, "EXPIRED": 2, "NO_EVIDENCE": 2 },
                "shares": { "COVERED": 0.5667, "TO_RENEW": 0.1333, "TO_VERIFY": 0.1667, "EXPIRED": 0.0667, "NO_EVIDENCE": 0.0667 } },
  "trend": [ { "frameworkId": "demo-msp", "at": "2026-10-01T00:00:00+02:00", "counts": { "COVERED": 15, "…": "…" } } ],
  "statuses": [ { "controlId": "CONT-01", "frameworkId": "demo-msp", "state": "EXPIRED", "freshness": "EXPIRED",
                   "sufficiencyClass": "COMPLETE", "bestEvidenceId": "ev-001", "expiresAt": "2025-05-04",
                   "pendingProposals": 0, "notes": [], "computedAt": "2026-11-11T09:30:00+01:00" } ],
  "byDomain": { "security": { "total": 6, "counts": { "COVERED": 3, "TO_RENEW": 1, "TO_VERIFY": 1, "EXPIRED": 1, "NO_EVIDENCE": 0 } } },
  "costs": { "totalUsd": 0.42, "perEvidenceUsd": 0.007, "evidenceCount": 60, "bySource": { "bedrock-data-automation": 0.31 } } }
```
Errors: `NOT_FOUND`, `FORBIDDEN`, `UPSTREAM`.

### 3.9 `POST /v1/evidence` — deposit an evidence
`QL`, `CO` (own controls), `AD`. Two accepted forms. **JSON envelope** — `Content-Type: application/json`:
```json
{ "filename": "restore-test-2026-Q4.pdf", "contentType": "application/pdf",
  "contentBase64": "JVBERi0xLjQK...", "fileDate": "2026-10-14", "controlId": "CONT-16" }
```
**Raw document** — the bytes are the body, the document's own `Content-Type` is the request content type, the name travels in `?filename=` or in the `X-File-Name` header. Answers `201` with the bare `Evidence` when the content is new, `200` with the existing `Evidence` when the fingerprint is already known (the new location is then appended to it, R8).
```json
{ "id": "ev-033", "sha256": "9f2c4e7b1a...", "revision": 1,
  "fields": { "type": "REPORT", "title": "Restore test 2026-Q4", "documentDate": "2026-10-14", "…": "…" },
  "flags": { "unreadable": false, "missingDate": false, "missingAuthor": false, "dateToConfirm": false },
  "accessLevel": "INTERNAL", "locations": [ { "kind": "MANUAL", "uri": "manual://restore-test-2026-Q4.pdf", "collectedAt": "2026-11-11T09:30:00+01:00" } ],
  "textPages": [], "sizeBytes": 48213, "contentType": "application/pdf", "ingestedAt": "2026-11-11T09:30:00+01:00",
  "reader": "bedrock-data-automation", "cost": { "usd": 0.015, "tokensIn": 0, "tokensOut": 0, "source": "bedrock-data-automation" } }
```
Errors: `UNREADABLE` (empty or unsupported file), `BAD_REQUEST` (no name, no content), `FORBIDDEN` (a control owner depositing for a control it does not own), `UPSTREAM`.

### 3.10 `GET /v1/evidence/{id}` — evidence detail
All roles, subject to the clearance. Path parameter `id`. Answers the bare `Evidence`, with `textPages`: the excerpts, personal data masked, fully replaced by the restriction marker when the access level is above the caller's clearance (ENF-CONF-01/02, EF-QR-03).
```json
{ "id": "ev-045", "sha256": "5b81d0c3a...", "revision": 1,
  "fields": { "type": "MINUTES", "title": "Incident review 2026-09", "documentDate": "2026-09-18", "…": "…" },
  "flags": { "unreadable": false, "missingDate": false, "missingAuthor": true, "dateToConfirm": false },
  "accessLevel": "RESTRICTED", "locations": [ { "kind": "MANUAL", "uri": "manual://incident-review-2026-09.pdf", "collectedAt": "2026-09-18T14:00:00+02:00" } ],
  "textPages": [ { "page": 1, "text": "[restricted: excerpt not available at this clearance]" } ],
  "sizeBytes": 91204, "contentType": "application/pdf", "ingestedAt": "2026-09-18T14:02:11+02:00", "reader": "bedrock-data-automation" }
```
Errors: `NOT_FOUND`, `FORBIDDEN`.

### 3.11 `GET /v1/controls/{id}` — control and its relations
All roles. Path parameter `id`. Answers a `ControlWithRelations`: the control, its state, its attachments, its sufficiency records and its evidence.
```json
{ "control": { "id": "CONT-16", "frameworkId": "demo-msp", "domain": "continuity", "title": "Backup restore tested on the defined interval",
               "requirement": "Backups of managed environments are tested by a real restore.",
               "expectedEvidence": ["Test date", "System or data set restored", "Measured recovery time"],
               "periodicity": "P3M", "owner": "ops.lead", "mandatory": true },
  "status": { "controlId": "CONT-16", "frameworkId": "demo-msp", "state": "TO_RENEW", "freshness": "TO_RENEW",
              "sufficiencyClass": "PARTIAL", "bestEvidenceId": "ev-033", "expiresAt": "2026-11-28", "pendingProposals": 1,
              "notes": ["missing-elements:Measured recovery time"], "computedAt": "2026-11-11T09:30:00+01:00" },
  "attachments": [ { "id": "at-0031", "evidenceId": "ev-033", "controlId": "CONT-16", "frameworkId": "demo-msp",
                     "supports": true, "confidence": 0.91, "quote": "Restore of the customer database on 14 October 2026",
                     "quoteLocation": { "page": 2 }, "reason": "A real restore is described.", "status": "APPLIED",
                     "citationVerified": true, "autoApplied": true, "model": "bedrock-anthropic.claude", "createdAt": "2026-11-11T09:31:02+01:00" } ],
  "sufficiencies": [ { "id": "su-0031", "attachmentId": "at-0031", "evidenceId": "ev-033", "controlId": "CONT-16",
                       "elements": [ { "expected": "Test date", "present": true, "quote": "14 October 2026" },
                                     { "expected": "Measured recovery time", "present": false, "quote": null } ],
                       "class": "PARTIAL", "missing": ["Measured recovery time"], "computedAt": "2026-11-11T09:31:03+01:00" } ],
  "evidence": [ { "id": "ev-033", "sha256": "9f2c4e7b1a...", "revision": 1, "fields": { "type": "REPORT", "…": "…" },
                  "flags": { "unreadable": false, "missingDate": false, "missingAuthor": false, "dateToConfirm": false },
                  "accessLevel": "INTERNAL", "locations": [], "textPages": [], "sizeBytes": 48213,
                  "contentType": "application/pdf", "ingestedAt": "2026-11-11T09:30:00+01:00", "reader": "bedrock-data-automation" } ] }
```
Errors: `NOT_FOUND`, `FORBIDDEN` (control of another owner).

### 3.12 `GET /v1/controls/{id}/evidence` — evidence of a control
All roles, subject to the clearance. Path parameter `id`. Answers a bare `Evidence[]`: the evidence attached to the control. Evidence above the caller's clearance is omitted from the array, never redacted.
```json
[ { "id": "ev-033", "sha256": "9f2c4e7b1a...", "revision": 1,
    "fields": { "type": "REPORT", "title": "Restore test 2026-Q4", "documentDate": "2026-10-14", "…": "…" },
    "flags": { "unreadable": false, "missingDate": false, "missingAuthor": false, "dateToConfirm": false },
    "accessLevel": "INTERNAL", "locations": [], "textPages": [], "sizeBytes": 48213, "contentType": "application/pdf",
    "ingestedAt": "2026-11-11T09:30:00+01:00", "reader": "bedrock-data-automation" } ]
```
Errors: `NOT_FOUND`, `FORBIDDEN`.

### 3.13 `POST /v1/controls/{id}/remind` — send a reminder now
`QL`, `AD`, and the `CO` who owns the control. No body, or an optional `{ "reason": "EXPIRING_SOON" }` to pick the reason. Answers `201` with the bare `Reminder` that was created.
```json
{ "id": "rm-0042", "controlId": "CONT-16", "frameworkId": "demo-msp", "recipient": "ops.lead",
  "reason": "MISSING_ELEMENTS", "missing": ["Measured recovery time"],
  "message": "The restore test of 14 October 2026 is missing the measured recovery time.",
  "createdAt": "2026-11-11T06:00:00+01:00", "expiresAt": "2026-11-28", "status": "SENT", "channel": "ses" }
```
Errors: `NOT_FOUND` (unknown control), `FORBIDDEN` (not the owner), `CONFLICT` (no reminder is justified for this control).

### 3.14 `GET /v1/validations` — validation queue
`QL`, `CO` (own controls only), `AD`. Query parameter `status`, `pending` or `decided` (`pending` by default). Answers a bare `ValidationItem[]`.
```json
[ { "id": "va-0007", "kind": "ATTACHMENT", "attachmentId": "at-0032", "evidenceId": "ev-034", "controlId": "CONT-16",
    "reason": "confidence 0.62 below threshold 0.85", "createdAt": "2026-11-11T09:31:04+01:00", "status": "PENDING" } ]
```
Errors: `BAD_REQUEST` (unknown status), `FORBIDDEN`.

### 3.15 `POST /v1/validations/{id}/decision` — decide an item
`QL`, `AD`. Body `{ "decision": "ACCEPT" | "REJECT" | "CORRECT", "note": string }`; the note is mandatory for `CORRECT`. Answers the bare decided `ValidationItem`, with its author, its date and its reason (EF-VAL-02).
```json
{ "id": "va-0007", "kind": "ATTACHMENT", "attachmentId": "at-0032", "evidenceId": "ev-034", "controlId": "CONT-16",
  "reason": "confidence 0.62 below threshold 0.85", "createdAt": "2026-11-11T09:31:04+01:00", "status": "DECIDED",
  "decision": "ACCEPT", "decidedBy": "u-quality", "decidedAt": "2026-11-11T10:02:19+01:00",
  "note": "The quote matches page 2 of the restore report." }
```
Errors: `BAD_REQUEST` (unknown decision, `CORRECT` without a note), `NOT_FOUND`, `CONFLICT` (already decided), `FORBIDDEN`.

### 3.16 `POST /v1/ask` — ask a question
All roles, subject to the clearance. Body `{ "question": string }`. Answers an `Answer`.
```json
{ "question": "When was the information security policy last reviewed?",
  "text": "The information security policy was reviewed on 3 November 2026 and approved by Camille Roy.",
  "citations": [ { "evidenceId": "ev-001", "title": "Information security policy", "page": 1, "documentDate": "2026-11-03",
                   "quote": "Reviewed 3 November 2026. Approved: Camille Roy." } ],
  "noEvidence": false, "redacted": true, "passagesUsed": 4,
  "cost": { "usd": 0.004, "tokensIn": 2100, "tokensOut": 120, "source": "bedrock-converse" } }
```
When no evidence answers the question, `noEvidence` is `true`, `citations` is empty and `text` is exactly `No evidence answers this question.` (EF-QR-02). An evidence above the caller's clearance is never cited (EF-QR-03).
Errors: `BAD_REQUEST` (empty question), `FORBIDDEN`, `UPSTREAM`.

### 3.17 `POST /v1/frameworks/{id}/packs` — assemble an audit pack
`QL`, `AD`. Path parameter `id`; optional body `{ "freezeAt": instant }`. Answers `201` with the bare `Pack`.
```json
{ "id": "pk-0003", "frameworkId": "demo-msp", "frozenAt": "2026-11-11T09:30:00+01:00",
  "index": [ { "controlId": "CONT-16", "controlTitle": "Backup restore tested on the defined interval", "state": "TO_RENEW",
               "evidence": [ { "evidenceId": "ev-033", "title": "Restore test 2026-Q4", "documentDate": "2026-10-14",
                               "sha256": "9f2c4e7b1a...", "sufficiencyClass": "PARTIAL",
                               "quote": "Restore of the customer database on 14 October 2026", "page": 2 } ] } ],
  "knownGaps": [ { "controlId": "CONT-16", "state": "TO_RENEW", "detail": "Measured recovery time is missing from the restore report." } ],
  "archive": { "uri": "s3://registre-vault/packs/pk-0003/pack.zip", "sha256": "3a7f9c2e...", "sizeBytes": 8412003 },
  "checksumsVerified": true }
```
`knownGaps` hands the gaps to the auditor as well as the evidence (EF-DOS-01), and `frozenAt` pins the pack to an instant (EF-DOS-03).
Errors: `NOT_FOUND`, `BAD_REQUEST` (invalid `freezeAt`), `FORBIDDEN`, `UPSTREAM`.

### 3.18 `GET /v1/packs` — list packs
`QL`, `IA`, `AD`. Optional query parameter `frameworkId`. Answers a bare `Pack[]`.
```json
[ { "id": "pk-0003", "frameworkId": "demo-msp", "frozenAt": "2026-11-11T09:30:00+01:00", "index": [], "knownGaps": [],
    "archive": { "uri": "s3://registre-vault/packs/pk-0003/pack.zip", "sha256": "3a7f9c2e...", "sizeBytes": 8412003 },
    "checksumsVerified": true } ]
```
Errors: `FORBIDDEN`.

### 3.19 `GET /v1/packs/{id}` — pack detail
`QL`, `IA`, `AD`. Path parameter `id`. Answers the bare `Pack` with one extra field, `downloadUrl`: the path of the archive stream (§3.20).
```json
{ "id": "pk-0003", "frameworkId": "demo-msp", "frozenAt": "2026-11-11T09:30:00+01:00", "index": [], "knownGaps": [],
  "archive": { "uri": "s3://registre-vault/packs/pk-0003/pack.zip", "sha256": "3a7f9c2e...", "sizeBytes": 8412003 },
  "checksumsVerified": true, "downloadUrl": "/v1/packs/pk-0003/archive" }
```
Errors: `NOT_FOUND`, `FORBIDDEN`.

### 3.20 `GET /v1/packs/{id}/archive` — download the archive
`QL`, `IA`, `AD`. Path parameter `id`. Answers `200` with the zip stream (`Content-Type: application/zip`), not JSON. Every download is written to the audit trail as `PACK_DOWNLOADED`.
```http
HTTP/1.1 200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="registre-pk-0003.zip"
X-Checksum-Sha256: 3a7f9c2e...
```
Errors: `NOT_FOUND`, `FORBIDDEN`, `UPSTREAM`.

### 3.21 `GET /v1/reminders` — reminders
`QL`, `CO` (own controls only), `IA`, `AD`. Optional query parameters `status` (`SENT`, `ACKNOWLEDGED`, `CLOSED`) and `controlId`. Answers a bare `Reminder[]`, newest first.
```json
[ { "id": "rm-0042", "controlId": "CONT-16", "frameworkId": "demo-msp", "recipient": "ops.lead",
    "reason": "MISSING_ELEMENTS", "missing": ["Measured recovery time"],
    "message": "The restore test of 14 October 2026 is missing the measured recovery time.",
    "createdAt": "2026-11-11T06:00:00+01:00", "expiresAt": "2026-11-28", "status": "SENT", "channel": "ses" } ]
```
Errors: `BAD_REQUEST` (unknown status), `FORBIDDEN`.

### 3.22 `GET /v1/audit-log` — audit trail
`QL`, `IA`, `AD`. Query parameters `limit` (page size) and `action` (one `AuditAction`). Answers a bare `AuditEvent[]`, newest first.
```json
[ { "seq": 418, "id": "ae-0418", "at": "2026-11-11T09:31:02+01:00", "actor": "u-quality", "action": "ATTACHMENT_APPLIED",
    "objectType": "attachment", "objectId": "at-0031", "detail": { "controlId": "CONT-16", "confidence": 0.91 },
    "prevHash": "b41c8d...", "hash": "77de10..." } ]
```
The events are hash-chained: `hash` covers the previous event, and a broken chain is the signal that the log was tampered with (ENF-INT-02).
Errors: `BAD_REQUEST` (unknown action), `FORBIDDEN`.

### 3.23 `GET /v1/settings` — current settings
`QL`, `AD`. No parameter. Answers the full `Settings`.
```json
{ "confidenceThreshold": 0.85, "reminderLeadDays": 14, "defaultPeriodicity": "P3M", "region": "eu-central-1",
  "retentionMonths": 24, "readerModel": "bedrock-data-automation", "reasoningModel": "bedrock-anthropic.claude",
  "answerModel": "bedrock-anthropic.claude", "guardrailId": null, "nightlyServiceTier": "FLEX" }
```
Errors: `FORBIDDEN`.

### 3.24 `PUT /v1/settings` — update the settings
`QL`, `AD`. The body is a **partial patch**: only the fields to change are sent, the others keep their value. The answer is the complete new `Settings`, not the patch (EF-ADM-01). Every change is written to the audit trail as `SETTINGS_UPDATED`.
```json
{ "confidenceThreshold": 0.9, "reminderLeadDays": 21 }
```
Errors: `BAD_REQUEST` (value out of range, invalid periodicity, unknown service tier), `FORBIDDEN`.

## 4. Shapes

The reference of the consumer. These are the shapes of `portal/src/api/types.ts`, field for field, packed a few fields per line so that this page stays readable.

```ts
export type Confidentiality = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
export type AccessLevel = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
export type Role = 'QUALITY_LEAD' | 'CONTROL_OWNER' | 'EXECUTIVE' | 'INTERNAL_AUDITOR' | 'ADMIN';

export interface Framework {
  id: string; name: string; version: string; importedAt: string; confidentiality: Confidentiality; source?: string;
}

export interface Control {
  id: string; frameworkId: string; domain: string; title: string; requirement: string;
  expectedEvidence: string[]; periodicity: string; owner: string; mandatory: boolean;
}

export interface EvidenceLocation { kind: 'S3' | 'MANUAL' | 'ITSM' | 'AWS_REPORT'; uri: string; collectedAt: string; duplicate?: boolean; }
export interface EvidencePeriod { start: string | null; end: string | null; }
export interface EvidenceFields {
  type: 'POLICY' | 'PROCEDURE' | 'MINUTES' | 'REPORT' | 'EXPORT' | 'SCREENSHOT' | 'LIST' | 'ATTESTATION' | null;
  title: string | null; documentDate: string | null; period: EvidencePeriod; version: string | null;
  author: string | null; approver: string | null; approvalDate: string | null; client: string | null;
  summary: string | null; personalData: boolean;
}
export interface ReadFlags { unreadable: boolean; missingDate: boolean; missingAuthor: boolean; dateToConfirm: boolean; }
export interface TextPage { page: number; text: string; }
export interface CostRecord { usd: number; tokensIn: number; tokensOut: number; source: string; }

export interface Evidence {
  id: string; sha256: string; revision: number; fields: EvidenceFields; flags: ReadFlags; accessLevel: AccessLevel;
  locations: EvidenceLocation[]; textPages: TextPage[]; sizeBytes: number; contentType: string; ingestedAt: string;
  reader: string; cost?: CostRecord;
}

export interface Attachment {
  id: string; evidenceId: string; controlId: string; frameworkId: string; supports: boolean; confidence: number;
  quote: string; quoteLocation: { page: number | null }; reason: string; status: 'PROPOSED' | 'APPLIED' | 'REJECTED';
  citationVerified: boolean; rejectionReason?: 'CITATION_NOT_FOUND' | 'HUMAN_REJECTED' | 'NO_SUPPORT' | 'DUPLICATE';
  autoApplied: boolean; model: string; createdAt: string; decidedBy?: string; decidedAt?: string; decidedNote?: string;
}

export interface SufficiencyElement { expected: string; present: boolean; quote: string | null; }
export interface Sufficiency {
  id: string; attachmentId: string; evidenceId: string; controlId: string; elements: SufficiencyElement[];
  class: 'COMPLETE' | 'PARTIAL' | 'TO_VERIFY'; missing: string[]; computedAt: string;
}

export interface ControlStatus {
  controlId: string; frameworkId: string; state: 'COVERED' | 'TO_RENEW' | 'TO_VERIFY' | 'EXPIRED' | 'NO_EVIDENCE';
  freshness: 'FRESH' | 'TO_RENEW' | 'EXPIRED' | 'UNDETERMINED';
  sufficiencyClass: 'COMPLETE' | 'PARTIAL' | 'TO_VERIFY' | null; bestEvidenceId: string | null;
  expiresAt: string | null; pendingProposals: number; notes: string[]; computedAt: string;
}

export interface ReadinessSnapshot { frameworkId: string; computedAt: string; total: number; counts: Record<string, number>; shares: Record<string, number>; }
export interface ReadinessTrendPoint { frameworkId: string; at: string; counts: Record<string, number>; }
export interface ReadinessOverview {
  framework: Framework; snapshot: ReadinessSnapshot; trend: ReadinessTrendPoint[]; statuses: ControlStatus[];
  byDomain: Record<string, { total: number; counts: Record<string, number> }>; costs: CostReport;
}

export interface ControlWithRelations {
  control: Control; status: ControlStatus; attachments: Attachment[]; sufficiencies: Sufficiency[]; evidence: Evidence[];
}

export interface ValidationItem {
  id: string; kind: 'ATTACHMENT' | 'SUFFICIENCY' | 'UNREADABLE_EVIDENCE'; attachmentId?: string; evidenceId?: string;
  controlId?: string; reason: string; createdAt: string; status: 'PENDING' | 'DECIDED';
  decision?: 'ACCEPT' | 'REJECT' | 'CORRECT'; decidedBy?: string; decidedAt?: string; note?: string;
}

export interface Reminder {
  id: string; controlId: string; frameworkId: string; recipient: string;
  reason: 'EXPIRING_SOON' | 'NO_EVIDENCE' | 'MISSING_ELEMENTS'; missing: string[]; message: string;
  createdAt: string; expiresAt: string | null; status: 'SENT' | 'ACKNOWLEDGED' | 'CLOSED'; channel: string;
}

export interface Pack {
  id: string; frameworkId: string; frozenAt: string;
  index: Array<{ controlId: string; controlTitle: string; state: string;
    evidence: Array<{ evidenceId: string; title: string | null; documentDate: string | null; sha256: string;
      sufficiencyClass: 'COMPLETE' | 'PARTIAL' | 'TO_VERIFY' | null; quote: string; page: number | null }> }>;
  knownGaps: Array<{ controlId: string; state: string; detail: string }>;
  archive: { uri: string; sha256: string; sizeBytes: number }; checksumsVerified: boolean;
}

export interface AnswerCitation { evidenceId: string; title: string | null; page: number | null; documentDate: string | null; quote: string; }
export interface Answer {
  question: string; text: string; citations: AnswerCitation[]; noEvidence: boolean; redacted: boolean;
  passagesUsed: number; cost?: CostRecord;
}

export interface AuditEvent {
  seq: number; id: string; at: string; actor: string;
  action: 'FRAMEWORK_IMPORTED' | 'EVIDENCE_COLLECTED' | 'EVIDENCE_READ' | 'EVIDENCE_DUPLICATE'
    | 'ATTACHMENT_PROPOSED' | 'ATTACHMENT_APPLIED' | 'ATTACHMENT_REJECTED' | 'VALIDATION_DECIDED'
    | 'STATE_RECOMPUTED' | 'REMINDER_SENT' | 'QUESTION_ASKED' | 'PACK_ASSEMBLED' | 'PACK_DOWNLOADED'
    | 'SETTINGS_UPDATED' | 'ACCESS_DENIED';
  objectType: string; objectId: string; detail: Record<string, unknown>; prevHash: string; hash: string;
}

export interface Settings {
  confidenceThreshold: number; reminderLeadDays: number; defaultPeriodicity: string; region: string;
  retentionMonths: number; readerModel: string; reasoningModel: string; answerModel: string;
  guardrailId: string | null; nightlyServiceTier: 'FLEX' | 'STANDARD';
}

export interface CostReport { totalUsd: number; perEvidenceUsd: number; evidenceCount: number; bySource: Record<string, number>; }
```

Two values are part of the contract and are worth repeating here: the no-evidence answer of §3.16 is exactly `No evidence answers this question.`, and the marker that replaces an excerpt the caller may not read is `[restricted: excerpt not available at this clearance]`.

## 5. Demonstration credentials
The accounts of the demonstration directory, their roles and their passwords
are documented in [`DEMO.md`](./DEMO.md). They are not repeated here, and
`GET /v1/auth/accounts` never returns a password.

---

## 6. Changes from the first revision
The first revision of this contract answered lists and reads with envelopes.
Every envelope is gone; the answer is now the object or the array the caller
asked for.

| First revision | Now | Why |
|---|---|---|
| `{ "frameworks": [...], "total": n }` | `Framework[]` | One contract, the one the portal client reads |
| `{ "controls": [...], "total": n }` | `Control[]` | Same |
| `{ "attachments": [...], "controlId": "...", "total": n }` | `Evidence[]` | The client reads evidence, not attachment rows |
| `{ "items": [...], "total": n, "status": "PENDING" }` | `ValidationItem[]` | Same |
| `{ "reminders": [...], "total": n }` | `Reminder[]` | Same |
| `{ "events": [...], "total": n, "limit": n, "offset": n, "nextOffset": n }` | `AuditEvent[]` | The page is the array; the size is a query parameter |
| `{ "packs": [...], "total": n }` | `Pack[]` | Same |
| `{ "control": {...}, "status": {...} }` | `ControlWithRelations` | One named shape, not two loose keys |
| `{ "framework": {...}, "controls": [...], "diff": {...} }` | `Framework`, then `GET /v1/frameworks/{id}/diff` | The import and the diff are two questions |
| `{ "evidenceId": "...", "duplicate": false, ... }` | `Evidence` | The caller wants the evidence, not a receipt |
| `{ "item": {...}, "controls": [...] }` | `ValidationItem` | The decision answers with the decided item |
| `{ "controlId": "...", "sent": 1, "reminders": [...] }` (202) | `Reminder` (201) | One reminder, one object |
| `{ "status": "PENDING", "total": n, "items": [...] }` | `ValidationItem[]` | Same as above |

The reason is singular: a portal client consumes objects, not wrappers. Every
extra envelope was a second shape to keep in step, and the first revision
already had two of them — `{ items }` in one route and `{ events }` in
another. One contract, one shape per route, and the portal client is the
reference.
