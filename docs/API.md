# API reference

Base URL: the `ApiUrl` output of the `Registre-Api` stack, for example
`https://abc123.execute-api.eu-central-1.amazonaws.com`.

All routes are authenticated with a Cognito JWT (`Authorization: Bearer <id_token>`).
The token's `cognito:groups` claim carries the role; the API maps it to a
`Principal` (id, name, email, role, clearance, owned controls) and every handler
applies the rules of [`SECURITY.md`](./SECURITY.md).

## Conventions

**Request bodies** are JSON (`content-type: application/json`) except
`POST /v1/evidence`, which accepts a multipart upload or a JSON envelope with
base64 bytes.

**Timestamps** are ISO-8601 with an offset (`2026-11-11T09:30:00+01:00`).
**Periodicities** are ISO-8601 durations (`P30D`, `P3M`, `P1Y`).

**Errors** share one shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "control CONT-99 does not exist", "detail": {} } }
```

| Code | HTTP | When |
|---|---|---|
| `BAD_REQUEST` | 400 | Malformed body, unknown field, invalid periodicity, forbidden wording in a free-text field (ENF-IA-01) |
| `FORBIDDEN` | 403 | Role not allowed, or access level above the principal's clearance |
| `NOT_FOUND` | 404 | Unknown framework, control, evidence, pack or validation |
| `CONFLICT` | 409 | Duplicate import, decision already recorded |
| `UNREADABLE` | 422 | Evidence cannot be read: corrupt file, unsupported type |
| `UPSTREAM` | 502 | Bedrock, DynamoDB or S3 failure |
| `CONFIG` | 502 | Missing environment variable or unusable setting |

**Roles**: `QL` = quality lead, `CO` = control owner, `EX` = executive,
`IA` = internal auditor, `AD` = admin. "Read" means the principal's clearance
covers the evidence access level.

## 1. `POST /v1/frameworks` — import a framework

Roles: `QL`, `AD`. Body: the import format of Annex A.

```json
{
  "framework": { "id": "demo-msp", "name": "Demonstration MSP framework",
                 "version": "1.0", "confidentiality": "INTERNAL" },
  "controls": [
    { "id": "CONT-03", "domain": "continuity",
      "title": "Backup restore test",
      "requirement": "Backups of managed environments are tested by a real restore, at a defined interval.",
      "expectedEvidence": ["Test date", "System or data set restored", "Measured recovery time", "Test result", "Signatory name"],
      "periodicity": "P3M", "owner": "ops.lead", "mandatory": true }
  ]
}
```

Response `201`:

```json
{ "framework": { "id": "demo-msp", "version": "1.0", "importedAt": "2026-11-11T09:30:00+01:00",
                 "confidentiality": "INTERNAL" },
  "controls": [ { "id": "CONT-03", "periodicity": "P3M", "mandatory": true } ],
  "diff": { "added": ["CONT-03"], "changed": [], "removed": [] } }
```

`diff` is `null` on the first import of a framework and compares against the
previous version otherwise (EF-REF-05). Errors: `BAD_REQUEST` (invalid
periodicity, empty expected evidence, duplicate control id), `CONFLICT` (same
version already imported), `FORBIDDEN` (role).

## 2. `GET /v1/frameworks` — list frameworks

Roles: all. Query: `?confidentiality=RESTRICTED` (optional).
Response `200`: `[{ "id", "name", "version", "importedAt", "confidentiality" }]`.
A framework marked `RESTRICTED` is only listed to `QL` and `AD`.

## 3. `GET /v1/frameworks/{id}/controls` — controls of a framework

Roles: all (read). Response `200`: array of controls with their current state:

```json
[ { "id": "CONT-03", "domain": "continuity", "title": "Backup restore test",
    "requirement": "...", "expectedEvidence": ["..."], "periodicity": "P3M",
    "owner": "ops.lead", "mandatory": true,
    "state": "TO_RENEW", "expiresAt": "2026-11-28", "pendingProposals": 1 } ]
```

Errors: `NOT_FOUND`, `FORBIDDEN` (restricted framework).

## 4. `GET /v1/frameworks/{id}/readiness` — readiness and trend

Roles: all (read). Query: `?trend=6` (number of trend points, default 6).

```json
{ "frameworkId": "demo-msp", "computedAt": "2026-11-11T09:30:00+01:00", "total": 30,
  "counts": { "COVERED": 17, "TO_RENEW": 4, "TO_VERIFY": 5, "EXPIRED": 2, "NO_EVIDENCE": 2 },
  "shares": { "COVERED": 0.5667, "TO_RENEW": 0.1333, "TO_VERIFY": 0.1667, "EXPIRED": 0.0667, "NO_EVIDENCE": 0.0667 },
  "trend": [ { "at": "2026-06-01T00:00:00+02:00", "counts": { "COVERED": 11 } } ] }
```

`shares` are fractions of `total`, rounded to four decimals. No field of this
response is named after the c-word (ENF-IA-01).

## 5. `POST /v1/evidence` — deposit an evidence

Roles: `QL`, `CO` (own controls), `AD`. Two forms:

*multipart*: `file` (the document), plus optional parts `frameworkId`,
`controlId` (suggested control), `collectedAt`.

*JSON*:

```json
{ "filename": "restore-test-2026-Q4.pdf", "contentType": "application/pdf",
  "contentBase64": "JVBERi0xLjQK...", "frameworkId": "demo-msp",
  "controlId": "CONT-03" }
```

Response `202` (pipeline started) or `200` (duplicate):

```json
{ "evidenceId": "ev-0417", "sha256": "9f2c...", "duplicate": false,
  "pipelineExecutionArn": "arn:aws:states:eu-central-1:...:execution:registre-pipeline:...",
  "accessLevel": "INTERNAL" }
```

A duplicate returns `200` with `duplicate: true` and the existing
`evidenceId`; the new location is appended to that evidence (R8). Errors:
`UNREADABLE` (empty file, unsupported type), `BAD_REQUEST` (filename missing),
`FORBIDDEN` (control owner depositing for a control they do not own).

## 6. `GET /v1/evidence/{id}` — evidence detail

Roles: all, subject to clearance. Query: `?include=text` adds `textPages`.

```json
{ "id": "ev-0417", "sha256": "9f2c...", "revision": 1,
  "fields": { "type": "MINUTES", "title": "Restore test 2026-Q4",
              "documentDate": "2026-10-14", "period": { "start": null, "end": null },
              "version": "1.0", "author": "L. Moreau", "approver": "L. Moreau",
              "approvalDate": "2026-10-14", "client": null,
              "summary": "Restore of the customer database into the test environment...",
              "personalData": true },
  "flags": { "unreadable": false, "missingDate": false, "missingAuthor": false, "dateToConfirm": false },
  "accessLevel": "INTERNAL",
  "locations": [ { "kind": "MANUAL", "uri": "s3://registre-vault-.../evidence/ev-0417/v1.pdf",
                   "collectedAt": "2026-11-11T09:30:00+01:00" } ],
  "sizeBytes": 48213, "contentType": "application/pdf", "ingestedAt": "...",
  "reader": "bedrock-data-automation", "cost": { "usd": 0.015, "tokensIn": 0, "tokensOut": 0,
                   "source": "bedrock-data-automation" } }
```

`RESTRICTED` evidence returns `403` to a principal without that clearance, and
its id never appears in another response (R13).

## 7. `GET /v1/controls/{id}` — control detail

Roles: all (read).

```json
{ "control": { "id": "CONT-03", "title": "Backup restore test", "periodicity": "P3M", "...": "..." },
  "status": { "controlId": "CONT-03", "state": "TO_RENEW", "freshness": "TO_RENEW",
              "sufficiencyClass": "PARTIAL", "bestEvidenceId": "ev-0417",
              "expiresAt": "2026-11-28", "pendingProposals": 1,
              "notes": ["missing-elements:Measured recovery time"],
              "computedAt": "2026-11-11T09:30:00+01:00" } }
```

## 8. `GET /v1/controls/{id}/evidence` — evidence of a control

Roles: all, subject to clearance. Query: `?status=APPLIED|PROPOSED|REJECTED`.

```json
[ { "attachmentId": "at-0031", "evidenceId": "ev-0417", "status": "APPLIED",
    "confidence": 0.91, "quote": "Restore of the customer database on 14 October 2026...",
    "quoteLocation": { "page": 2 }, "citationVerified": true,
    "reason": "The minutes describe a real restore of a backup, which the control requires.",
    "sufficiency": { "class": "PARTIAL", "missing": ["Measured recovery time"] },
    "title": "Restore test 2026-Q4", "documentDate": "2026-10-14" } ]
```

Evidence above the caller's clearance is silently omitted, not redacted.

## 9. `GET /v1/validations?status=pending` — validation queue

Roles: `QL`, `AD`; a `CO` sees only items about their own controls.

```json
[ { "id": "va-0007", "kind": "ATTACHMENT", "attachmentId": "at-0032",
    "evidenceId": "ev-0418", "controlId": "CONT-07",
    "reason": "confidence 0.62 below threshold 0.85", "createdAt": "...",
    "status": "PENDING" } ]
```

`kind` is `ATTACHMENT`, `SUFFICIENCY` or `UNREADABLE_EVIDENCE` (EF-VAL-01).

## 10. `POST /v1/validations/{id}/decision` — decide

Roles: `QL`, `AD`. Body:

```json
{ "decision": "ACCEPT", "note": "Correct control, quote matches page 2." }
```

`decision` is `ACCEPT`, `REJECT` or `CORRECT`; `CORRECT` requires
`controlId` (the right control). Response `200` returns the decided item with
`decidedBy`, `decidedAt` and the recomputed `state` of the affected control.
Every decision keeps its author, date and note (EF-VAL-02) and is appended to
the audit log. Errors: `CONFLICT` (already decided), `BAD_REQUEST` (`CORRECT`
without `controlId`), `FORBIDDEN`.

## 11. `POST /v1/ask` — natural-language question

Roles: all, subject to clearance. Body: `{ "question": "When was the security policy last reviewed?", "frameworkId": "demo-msp" }`.

```json
{ "question": "When was the security policy last reviewed?",
  "text": "The information security policy was reviewed on 3 November 2026 and approved by L. Moreau.",
  "citations": [ { "evidenceId": "ev-001", "title": "Information security policy",
                   "page": 1, "documentDate": "2026-11-03",
                   "quote": "Reviewed 3 November 2026. Approved: L. Moreau." } ],
  "noEvidence": false, "redacted": true, "passagesUsed": 4,
  "cost": { "usd": 0.004, "tokensIn": 2100, "tokensOut": 120, "source": "bedrock-converse" } }
```

When nothing grounds an answer, `text` is `"No evidence answers this question."`,
`citations` is empty and `noEvidence` is `true` (EF-QR-02, R12). A restricted
evidence is never cited to a principal without clearance (EF-QR-03, R13).

## 12. `POST /v1/frameworks/{id}/packs` — assemble an audit pack

Roles: `QL`, `AD`. Body (optional): `{ "freezeAt": "2026-11-11T09:30:00+01:00" }`.

```json
{ "id": "pk-0003", "frameworkId": "demo-msp", "frozenAt": "2026-11-11T09:30:00+01:00",
  "index": [ { "controlId": "CONT-03", "controlTitle": "Backup restore test",
               "state": "TO_RENEW",
               "evidence": [ { "evidenceId": "ev-0417", "title": "Restore test 2026-Q4",
                               "documentDate": "2026-10-14", "sha256": "9f2c...",
                               "sufficiencyClass": "PARTIAL",
                               "quote": "Restore of the customer database...", "page": 2 } ] } ],
  "knownGaps": [ { "controlId": "CONT-11", "state": "NO_EVIDENCE",
                   "detail": "No restore test recorded this quarter" } ],
  "archive": { "uri": "s3://registre-vault-.../packs/pk-0003/pack.zip",
               "sha256": "3a7f...", "sizeBytes": 8412003 },
  "checksumsVerified": true }
```

`knownGaps` is what makes the pack honest: the partner hands the auditor the
gaps as well as the evidence (EF-DOS-01). `frozenAt` pins the pack to an instant
so it can be reproduced (EF-DOS-03). Pack assembly takes seconds on the demo
data; on a real framework it is a few minutes.

## 13. `GET /v1/packs/{id}` — pack detail and download

Roles: `QL`, `AD`, `IA`. Response `200` is the pack object of §12 with an added
`downloadUrl` (a short-lived presigned URL, 15 minutes). Each download is
appended to the audit log as `PACK_DOWNLOADED`. Errors: `NOT_FOUND`,
`FORBIDDEN`.

## 14. `GET /v1/reminders` — reminders

Roles: `QL`, `AD`; a `CO` sees only their own. Query:
`?status=SENT|ACKNOWLEDGED|CLOSED&controlId=CONT-03`.

```json
[ { "id": "rm-0042", "controlId": "CONT-03", "recipient": "ops.lead",
    "reason": "MISSING_ELEMENTS", "missing": ["Measured recovery time"],
    "message": "The restore test of 14 October 2026 is missing the measured recovery time.",
    "createdAt": "2026-11-11T06:00:00+01:00", "expiresAt": "2026-11-28",
    "status": "SENT", "channel": "ses" } ]
```

`reason` is `EXPIRING_SOON`, `NO_EVIDENCE` or `MISSING_ELEMENTS` (EF-REL-01..02).

## 15. `POST /v1/controls/{id}/remind` — remind now

Roles: `QL`, `AD`, and the `CO` who owns the control. Body (optional):
`{ "reason": "EXPIRING_SOON" }`. Response `202` with the created `Reminder`.
The message always lists what to provide, taken from `Sufficiency.missing` when
the reason is `MISSING_ELEMENTS`. Errors: `FORBIDDEN` (not the owner), `CONFLICT`
(a reminder was already sent today for that control and reason).

## 16. `GET /v1/audit-log` — audit trail

Roles: `QL`, `AD`, `IA`. Query: `?limit=100&action=ATTACHMENT_APPLIED&objectId=ev-0417`.

```json
[ { "seq": 418, "id": "ae-0418", "at": "2026-11-11T09:31:02+01:00",
    "actor": "quality.lead", "action": "ATTACHMENT_APPLIED",
    "objectType": "attachment", "objectId": "at-0031",
    "detail": { "controlId": "CONT-03", "confidence": 0.91 },
    "prevHash": "b41c...", "hash": "77de..." } ]
```

Add `?verify=chain` to run `verifyChain()` and receive
`{ "ok": true, "brokenAt": null }`. A broken chain is the signal that the log was
tampered with (ENF-INT-02).

## Beyond the sixteen: settings

`GET /v1/settings` and `PUT /v1/settings` (roles `QL`, `AD`) expose the settings
of EF-ADM-01: `confidenceThreshold`, `reminderLeadDays`, `defaultPeriodicity`,
`region`, `retentionMonths`, `readerModel`, `reasoningModel`, `answerModel`,
`guardrailId`, `nightlyServiceTier`. A `PUT` is appended to the audit log as
`SETTINGS_UPDATED` and refuses a value that would make the tool describe a
control with the c-word (ENF-IA-01).
