# Data model

Nine persisted entities, plus settings and the audit trail, in **one DynamoDB
table**. Types live in `src/domain/types.ts` (the single source of truth); this
document explains the fields, the integrity rules and the physical layout.

## 1. Entities

### Framework

| Field | Type | Notes |
|---|---|---|
| `id` | string | Imported identity (`demo-msp`) |
| `name`, `version` | string | A new version is a new row; the previous one stays |
| `importedAt` | ISO-8601 | Set by the code, from the injected clock |
| `confidentiality` | `PUBLIC` / `INTERNAL` / `RESTRICTED` | Drives who may even list it (ENF-CONF-03) |
| `source` | string? | Free note on provenance, never the protected text |

### Control

| Field | Type | Notes |
|---|---|---|
| `id`, `frameworkId` | string | `CONT-03` |
| `domain` | string | governance, incidents, changes, continuity, security, customer |
| `title`, `requirement` | string | The partner's own wording of the requirement |
| `expectedEvidence` | string[] | What an evidence must contain; drives sufficiency (Annex D) |
| `periodicity` | ISO-8601 duration | `P30D`, `P3M`, `P1Y` |
| `owner` | string | Principal id reminded when the evidence ages |
| `mandatory` | boolean | A mandatory control needs a human validation the first time an evidence type is seen |

### Evidence

| Field | Type | Notes |
|---|---|---|
| `id` | `ev-…` | Derived deterministically from the content hash |
| `sha256` | hex string | Fingerprint of the bytes: the deduplication key |
| `revision` | integer | Incremented when the same content arrives again |
| `fields` | `EvidenceFields` | Annex B: type, title, document date, period, version, author, approver, approval date, client, summary, `personalData` |
| `flags` | `ReadFlags` | `unreadable`, `missingDate`, `missingAuthor`, `dateToConfirm` |
| `accessLevel` | `PUBLIC` / `INTERNAL` / `RESTRICTED` | Raised to `RESTRICTED` as soon as PII is detected |
| `locations` | `EvidenceLocation[]` | Every place the content was found: kind (`S3`, `MANUAL`, `ITSM`, `AWS_REPORT`), uri, collectedAt, `duplicate` |
| `textPages` | `{page, text}[]` | Extracted text, page by page — the material for quote verification |
| `sizeBytes`, `contentType` | number, string | — |
| `ingestedAt` | ISO-8601 | — |
| `reader` | string | Which adapter read it (`bedrock-data-automation`, `mock-scripted`) |
| `cost` | `CostRecord?` | usd, tokensIn, tokensOut, source |

### Attachment

| Field | Type | Notes |
|---|---|---|
| `id` | `at-…` | — |
| `evidenceId`, `controlId`, `frameworkId` | string | An evidence may support several controls and several frameworks (EF-RAT-04) |
| `supports` | boolean | The model's answer for this pair |
| `confidence` | 0..1 | Model output; compared to the threshold |
| `quote` | string | The passage that justifies the link (Annex C) |
| `quoteLocation` | `{page}` | Page number when the reader gives one |
| `reason` | string | One or two sentences |
| `status` | `PROPOSED` / `APPLIED` / `REJECTED` | **Set by code**, never by the model |
| `citationVerified` | boolean | Set by code after searching the quote in `textPages` |
| `rejectionReason` | `CITATION_NOT_FOUND` / `HUMAN_REJECTED` / `NO_SUPPORT` / `DUPLICATE`? | — |
| `autoApplied` | boolean | True when the threshold alone decided it |
| `model`, `createdAt` | string | Traceability of the proposal |
| `decidedBy`, `decidedAt`, `decidedNote` | string? | Who decided, when, why (EF-VAL-02) |

### Sufficiency

| Field | Type | Notes |
|---|---|---|
| `id`, `attachmentId`, `evidenceId`, `controlId` | string | One per attachment |
| `elements` | `{expected, present, quote}[]` | One row per expected element of the control |
| `class` | `COMPLETE` / `PARTIAL` / `TO_VERIFY` | **Computed by code** from `elements` (never the c-word, ENF-IA-01) |
| `missing` | string[] | The expected elements marked absent; echoed verbatim in reminders |
| `computedAt` | ISO-8601 | — |

### Control status

| Field | Type | Notes |
|---|---|---|
| `controlId`, `frameworkId` | string | — |
| `state` | `COVERED` / `TO_RENEW` / `TO_VERIFY` / `EXPIRED` / `NO_EVIDENCE` | Computed by code |
| `freshness` | `FRESH` / `TO_RENEW` / `EXPIRED` / `UNDETERMINED` | Freshness of the best evidence |
| `sufficiencyClass` | class or `null` | Of the best evidence |
| `bestEvidenceId` | string? | The evidence the state is based on |
| `expiresAt` | date? | Evidence date + control periodicity |
| `pendingProposals` | integer | Number of attachments awaiting a decision |
| `notes` | string[] | Machine-readable reasons, e.g. `mandatory-first-validation-required` |
| `computedAt` | ISO-8601 | — |

### Readiness snapshot and trend point

`ReadinessSnapshot` = framework id, computedAt, total, `counts` and `shares` per
state. `ReadinessTrendPoint` = framework id, at, counts. One trend point is
appended per recomputation so the portal can draw six months of history
(EF-FRA-04).

### Reminder

| Field | Type | Notes |
|---|---|---|
| `id`, `controlId`, `frameworkId`, `recipient` | string | — |
| `reason` | `EXPIRING_SOON` / `NO_EVIDENCE` / `MISSING_ELEMENTS` | — |
| `missing` | string[] | Echo of `Sufficiency.missing` when relevant |
| `message`, `channel` | string | Rendered text and channel (`ses`) |
| `createdAt`, `expiresAt` | ISO-8601 | — |
| `status` | `SENT` / `ACKNOWLEDGED` / `CLOSED` | — |

### Pack

| Field | Type | Notes |
|---|---|---|
| `id` | `pk-…` | — |
| `frameworkId`, `frozenAt` | string, ISO-8601 | `frozenAt` makes the pack reproducible (EF-DOS-03) |
| `index` | `PackIndexEntry[]` | Per control: state, then per evidence: title, date, sha256, sufficiency class, quote, page |
| `knownGaps` | `{controlId, state, detail}[]` | The gaps are part of the deliverable |
| `archive` | `{uri, sha256, sizeBytes}` | The zip in the vault |
| `checksumsVerified` | boolean | Recomputed at assembly |

### Validation item

`id`, `kind` (`ATTACHMENT` / `SUFFICIENCY` / `UNREADABLE_EVIDENCE`), optional
`attachmentId` / `evidenceId` / `controlId`, `reason`, `createdAt`, `status`
(`PENDING` / `DECIDED`), `decision` (`ACCEPT` / `REJECT` / `CORRECT`),
`decidedBy`, `decidedAt`, `note`.

### Audit event

| Field | Type | Notes |
|---|---|---|
| `seq` | integer | Monotonic, zero-padded in the sort key |
| `id` | `ae-…` | — |
| `at`, `actor` | ISO-8601, string | Who did what |
| `action` | `AuditAction` | 15 values: import, collect, read, duplicate, propose, apply, reject, decide, recompute, remind, ask, assemble, download, settings, access denied |
| `objectType`, `objectId` | string | The subject |
| `detail` | object | Free-form, no protected text |
| `prevHash`, `hash` | hex string | Hash chain (ENF-INT-02) |

## 2. Integrity rules

1. **Content identity.** The SHA-256 of the bytes is computed on arrival and
   re-verified on export. The same content under another name is one evidence
   with two locations; the second arrival never overwrites the first (R8).
2. **Versions are kept.** The vault is versioned and locked, so an evidence that
   is replaced stays readable for the retention period.
3. **A quote must exist.** `citationVerified` is set by searching the quote in
   the extracted text (whitespace-normalised, accent-insensitive). A quote that
   is not found rejects the attachment with `CITATION_NOT_FOUND` (R4).
4. **States are computed.** Freshness, state, sufficiency class, missing list,
   counts and shares are produced by `src/domain/**` from stored dates and
   periodicities. A model never returns a state (ENF-IA-04).
5. **Doubt goes down.** An unreadable date yields `UNDETERMINED` freshness, which
   cannot produce `COVERED`. A partial sufficiency yields `TO_VERIFY`.
6. **The log is append-only.** Each event hashes its predecessor; `verifyChain()`
   returns the first broken sequence.
7. **No protected text in exports.** A framework marked `RESTRICTED` has its
   requirement text stripped from any pack or API response that leaves the
   authorised roles, unless the partner explicitly opts in (ENF-CONF-03).

## 3. Physical layout (DynamoDB, single table)

Keys `pk` / `sk`, on-demand capacity, PITR on, deletion protection on,
customer-managed KMS key shared with the vault.

| `pk` | `sk` | Entity |
|---|---|---|
| `FRAMEWORK#<id>` | `META` | framework |
| `FRAMEWORK#<id>` | `CONTROL#<controlId>` | control |
| `FRAMEWORK#<id>` | `STATUS#<controlId>` | control status |
| `FRAMEWORK#<id>` | `TREND#<iso8601>` | readiness trend point |
| `EVIDENCE#<id>` | `META` | evidence |
| `EVIDENCE#<id>` | `ATTACH#<controlId>` | attachment |
| `EVIDENCE#<id>` | `SUFF#<attachmentId>` | sufficiency |
| `CONTROL#<id>` | `REMINDER#<iso8601>` | reminder |
| `VALIDATION#<status>` | `<createdAt>#<id>` | validation item |
| `PACK#<id>` | `META` | pack |
| `AUDITLOG` | `<zero-padded seq>` | audit event |
| `SETTINGS` | `META` | settings |

**gsi1** (`gsi1pk` / `gsi1sk`) answers two questions the pipeline asks on every
arrival: "is this hash already stored?" (`gsi1pk = HASH#<sha256>`) and
"everything belonging to one framework" (`gsi1pk = FRAMEWORK#<id>`). It projects
`sha256`, `frameworkId`, `controlId`, `status`, `accessLevel`, which is exactly
what those two reads need.

**gsi2** (`gsi2pk` / `gsi2sk`) answers the portal lists without a scan:
validation queue by status (`gsi2pk = VALIDATION#PENDING`), evidence by access
level (`gsi2pk = ACCESS#RESTRICTED`), statuses by state
(`gsi2pk = STATE#TO_VERIFY`). Keys only: the portal re-reads the item it needs.

Why one table: one backup policy, one key, one recovery point, and no
cross-table transaction for an operation (applying an attachment) that touches
an attachment, a sufficiency, a status, a trend point and an audit event.

## 4. Settings

Stored as one item: `confidenceThreshold` (0.85), `reminderLeadDays` (30),
`defaultPeriodicity` (`P1Y`), `region` (`eu-central-1` by default), `retentionMonths`
(24), `readerModel`, `reasoningModel`, `answerModel`, `guardrailId`,
`nightlyServiceTier` (`FLEX`). Every change is an audit event.

## 5. What is deliberately absent

- **No state named after the c-word.** `ControlState` and `SufficiencyClass`
  cannot express it; `src/domain/vocabulary.ts` rejects the wording in free text
  and CI enforces the ban (ENF-IA-01, R15).
- **No protected framework text.** The repository ships a demonstration
  framework written for the occasion; every partner imports their own file
  (EF-REF-03).
- **No raw document in the table.** Documents live in the vault; the table holds
  the metadata, the extracted pages used for quote checks, and the claims.
