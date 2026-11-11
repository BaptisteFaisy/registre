# High-level design

**Registre** — continuous audit-evidence registry for AWS MSP partners, built on
Amazon Bedrock. Hackathon AWS MSP AI, Track 1 ("Run Your MSP Better"), submitted
for the *Best Amazon Bedrock Application* prize.

## 1. Context

To be validated in the AWS MSP programme, a partner passes an audit run by an
independent third party. ISO 27001 certification works the same way. In both
cases the team spends weeks gathering evidence that is scattered across a
document store, a ticketing tool, a spreadsheet of certifications and a handful
of inboxes.

The problem is not that the evidence is missing. It is that:

- evidence lives in a dozen places and only one person knows where;
- nothing happens for eleven months, then several weeks of panic before the
  audit;
- expired evidence is discovered the day before the auditor arrives;
- the same document is hunted twice because two frameworks need it.

AWS Audit Manager, the service that automated AWS-resource evidence collection,
is closed to new customers. A partner starting today has no AWS evidence tool to
switch on — and an MSP audit is mostly about organisational documents
(policies, procedures, minutes, training records, customer satisfaction), which
is the ground Audit Manager never covered.

Reading a document and deciding which control it supports requires understanding
text. That is a language-model job, not a rule.

## 2. Goals

| Goal | Measure | Demo target |
|---|---|---|
| Cut audit-preparation effort | Person-days between start of preparation and a complete pack | Pack assembled in under 10 minutes on the demo data |
| Never discover a gap the day before | Controls with no fresh evidence, in number and share | Shown continuously; every seeded situation detected |
| Accept most proposals without correction | Proposed attachments accepted as-is | Over 85 % |
| Read evidence accurately | Extracted fields correct | Over 90 % |
| Answer an auditor fast | Request to evidence in hand | Under 1 minute |
| Spend little human time | Validation minutes per evidence | Measured, under 1 minute |

## 3. What the product does

1. **Collects** evidence from a document bucket, a manual upload, an ITSM export
   and a dated AWS state report.
2. **Reads** each evidence: type, date, covered period, version, author,
   approver, client, summary, whether it contains personal data.
3. **Attaches** it to the controls it supports, quoting the passage that
   justifies each link.
4. **Watches freshness**: every control has a periodicity, every evidence a date.
5. **Reports** controls without fresh evidence and reminds their owner, saying
   what is missing.
6. **Assembles** the audit pack on demand, with an index per control, the
   evidence, and the known gaps.

Three extensions and one bonus complete the product (§8): a frozen pack is
**signed and verifiable by a third party without exposing its content**, and an
external auditor receives a **bounded share token** instead of an archive by
e-mail; an attachment accepted for one framework is **proposed** on the
equivalent control of another framework through a human-validated mapping;
collectors produce **daily machine attestations** whose drift moves a control
within the day, and a missing human document gets a **pre-filled watermarked
draft** that is never evidence; finally the system **measures its own quality**
and stops auto-applying as soon as a measured metric fails its target.

## 4. What it never says

The tool never describes a control as satisfied in the auditor's sense. There is
no such state in the data model. `ControlState` has exactly five values:

| State | Meaning |
|---|---|
| `COVERED` | At least one applied evidence, fresh, and complete against the expected elements |
| `TO_RENEW` | The best evidence expires within 30 days |
| `TO_VERIFY` | Only proposed attachments, or a partial sufficiency |
| `EXPIRED` | Every applied evidence is older than the periodicity |
| `NO_EVIDENCE` | No applied evidence at all |

The wording ban is enforced in code (`src/domain/vocabulary.ts`), checked in CI
(`tools/quality/checkWording.ts`, ENF-IA-01) and tested (acceptance R15). When a
document is needed to explain the ban, this documentation uses "the c-word" and
cites ENF-IA-01.

Doubt always resolves downwards: an uncertain case becomes `TO_VERIFY`, never
`COVERED`. An evidence with no readable date can never make a control `COVERED`.
A complete sufficiency on a mandatory control requires a human validation the
first time that evidence type is seen. The same rule has a machine-enforced
form: when the measured attachment accuracy fails its target, the effective
confidence threshold rises above 1 and **everything** goes to a human
(`src/domain/quality.ts`, §8.4).

## 5. Architecture

The full deployment view and the processing sequences are in
[`ARCHITECTURE.md`](./ARCHITECTURE.md). In one paragraph: evidence lands in a
versioned S3 vault locked with Object Lock; a Step Functions chain fingerprints
it, reads it with Bedrock Data Automation, asks a Bedrock managed knowledge base
for candidate controls, asks a Bedrock model for attachments and sufficiency in
structured form, verifies every quote against the document text, recomputes
control states in code, and indexes the text into a second knowledge base. A
React portal served by CloudFront talks to an HTTP API behind Cognito. SES sends
reminders. Everything runs in one European region. The extensions add two ports
— a `Signer` (KMS asymmetric key in production, local Ed25519 offline) and an
`ExtensionStore` (shares, mappings, drifts, quality records, verification log)
in the same DynamoDB table — plus a public, content-free verification route and
the evaluation-recording loop.

## 6. Data model

Nine entities, one DynamoDB table: framework, control, evidence, attachment,
sufficiency, control state, reminder, pack, audit event. Field-level detail and
the key layout are in [`DATA-MODEL.md`](./DATA-MODEL.md). The extensions add
five persisted shapes behind the `ExtensionStore` port (`src/ports/index.ts`):
share grant, control mapping, drift event, quality record and verification
result — types in `src/domain/verification.ts`, `src/domain/mapping.ts` and
`src/domain/quality.ts`, storage in `src/store/extensionsMemory.ts` (offline)
and `src/store/extensionsDynamo.ts` (AWS).

Three properties carry most of the design weight:

- **Evidence is identified by its content.** The SHA-256 of the bytes is the
  deduplication key; the same file under two names is one evidence with two
  locations (R8).
- **An attachment is a claim with a quote.** It stores the quoted passage, the
  page, a confidence and a status. The code checks the quote exists; if it does
  not, the attachment is rejected with reason `CITATION_NOT_FOUND` (R4).
- **The audit log is append-only and hash-chained.** Each event carries the hash
  of the previous one, so a deleted or edited event breaks the chain and
  `verifyChain()` says where (ENF-INT-02).

## 7. Key decisions and trade-offs

| Decision | Alternative rejected | Why |
|---|---|---|
| Managed knowledge bases | Self-hosted vector store (OpenSearch + embeddings) | No index to operate, native connectors to where evidence lives, and the prize is about using Bedrock properly rather than rebuilding it. Cost: less control over chunking. |
| Code computes every state | Let the model judge the control | A model verdict is not reproducible and not defensible to an auditor. Code verdicts are testable and explainable (ENF-IA-04). |
| Quote verification in code | Trust the model's citation | A hallucinated quote is the one failure that would destroy trust in the whole register. One string search per attachment removes it (R4). |
| Confidence threshold with human validation | Auto-apply everything above 0.5 | A wrong attachment that nobody reviewed is worse than a queue of ten proposals. Threshold is a setting (default 0.85). |
| Single DynamoDB table | One table per entity | One backup, one key, one recovery story; the access patterns are known and documented. |
| Object Lock in strict mode | Governance mode, or no lock | An auditor's question is "could this have been altered?" — only the strict, non-governance mode answers it (ENF-INT-01). |
| Imported framework | Bundle a framework in the repository | Protected framework text must never ship: it is a licensing problem and a confidentiality problem (ENF-CONF-03, chapter 16). |
| Node 22 with native TypeScript | A bundler and a build step | Fewer moving parts, the same code runs in tests, in the Lambda and in the demo. |

## 8. Design decisions of the extensions

Four decisions shape the three extensions and the quality bonus. Each is
recorded as a short ADR in [`DECISIONS.md`](./DECISIONS.md) (ADR-16 to ADR-19);
this section states the reasoning, the contracts live in
`docs/CONTRACTS-EXT.md`.

### 8.1 A signing key separate from the encryption key, without rotation

The vault already has a customer-managed KMS key for encryption, with rotation
enabled. Signing reuses none of it: the pack manifest is signed by a **second,
asymmetric key** (`ECC_NIST_P256`, usage `SIGN_VERIFY`,
`infra/lib/vault-stack.ts`).

- **Separate key, because separate jobs.** The encryption key protects
  confidentiality and is used thousands of times a day by S3 and DynamoDB; the
  signing key authenticates a frozen artefact and is used once per pack. Sharing
  one key would mean one compromise or one policy change breaks both properties,
  and would put a `Decrypt`-capable key in the hands of the signing path. A
  `SIGN_VERIFY` key **cannot encrypt or decrypt anything**: its blast radius is
  signatures, full stop.
- **No rotation, because a signature outlives its day.** Rotating a signing key
  invalidates verification of packs frozen under the previous key id — exactly
  the artefacts an auditor will re-check months later, which is the whole point
  of the manifest. Confidentiality benefits from rotation; **verifiability of a
  frozen artefact requires stability**. The key is `RETAIN` on stack destroy, so
  it outlives the deployment like the vault it attests.
- **Offline twin.** The demo, the tests and a judge's laptop have no KMS: the
  same `Signer` port is implemented by a local Ed25519 signer
  (`src/crypto/localSigner.ts`) whose key comes from the environment, with an
  ephemeral fallback that declares itself unverifiable after the process exits.
  No key is never a fake signature: `signatureOk: null` says "not configured".

### 8.2 A mapping is a proposal, never a decision

An equivalence between two controls of two frameworks is exactly as fallible as
an attachment — more, because it links two abstractions instead of a document
and a control. So the discipline of attachments is applied to mappings, without
exception (`src/domain/mapping.ts`, `src/pipeline/crossmap.ts`):

- a proposed mapping carries **two quotes**, one from each requirement text, and
  **both are verified by code** before the mapping is persisted;
- a mapping is stored `PROPOSED` and stays that way until a human validates or
  rejects it (`decideMapping`, journalled `MAPPING_DECIDED`);
- a validated mapping **proposes** the equivalent attachment on the other
  framework — it never applies it: `propagateAttachment` creates `PROPOSED`
  attachments that go through the second framework's own validation queue, with
  its own threshold and its own quote check;
- similarity scoring is code (`similarity()` on requirement texts), so no new
  model call, no new hallucination surface.

Why not auto-apply? Because one wrong equivalence silently propagates to every
future audit of the second framework, and the auditor of that framework never
saw the first decision. Human validation is cheap — a few pairs a quarter — and
it is the only step that can say "these two controls really mean the same
thing".

### 8.3 A machine attestation has its own cadence

A collector statement ("last night's backups all succeeded") is evidence of a
different nature than a signed policy: it is produced daily, it is cheap, and it
goes stale in a day — while a policy is yearly. Judging a daily attestation by
the control's annual periodicity would hide a broken backup for eleven months.

So `Evidence.provenance` distinguishes `HUMAN_DOCUMENT` from
`MACHINE_ATTESTATION` (`src/domain/verification.ts`), and the freshness of an
attestation uses the **cadence** of its refresh policy — default 24 h plus 6 h
of grace (`DEFAULT_REFRESH_POLICY`, `src/domain/quality.ts`) — converted to an
ISO-8601 duration by `cadencePeriodicity()` and exposed as the single helper
`machinePeriodicityFor()` (`src/domain/freshness.ts`), which the state engine
uses (`src/domain/states.ts`). One freshness implementation, two periodicities:
the engine is not forked (ENF-IA-04). A missing run is itself information:
`MISSING_RUN` drift fires when no attestation arrived within cadence plus grace,
so a silent collector moves the control instead of freezing it in a reassuring
state. Drift kinds (`STATE_CHANGED`, `MISSING_RUN`, `THRESHOLD_CROSSED`,
`RECOVERED`) are detected by code comparing successive attestations
(`src/pipeline/drift.ts`), carried to the owner through the reminder that
already exists, and acknowledged by a human with author and date.

The same logic gives the pre-filled **draft** its scope (`src/domain/draft.ts`):
a missing human document is pre-filled from the control's expected elements and
the partner's own previous version — watermarked, never fingerprinted, never in
the vault, never attached, never counted (`attachable` is the literal type
`false`). Saving the owner the blank page must never let the tool manufacture
the proof.

### 8.4 Measured degradation beats a fixed threshold

A fixed confidence threshold (0.85) is a bet that the model, the prompt and the
corpus stay what they were when the threshold was chosen. They do not: prompts
change, models are versioned by their provider, corpora drift. The bonus axis
replaces the bet with a measurement:

- every proposal is stamped with its prompt version (`src/ai/versioning.ts`),
  so a metric is always attributable to a `(model, prompt version)` subject;
- every evaluation run — local scorer or Bedrock evaluation task — is recorded
  as `QualityRecord`s (`recordEvaluation`, `src/pipeline/quality.ts`), with its
  value, its target, its sample size and its verdict;
- the attachment pipeline reads `attachmentThreshold()`, which applies
  `effectiveConfidenceThreshold` (`src/domain/quality.ts`): the configured
  setting while the latest acceptance measurement passes, **1.01 — unreachable —
  while it fails**.

Why is that better than a fixed threshold? Because the failure mode of a fixed
threshold is silent: a degraded model keeps auto-applying until a human notices
a wrong link in a pack. The failure mode of measured degradation is noisy and
safe: the queue grows, the quality screen shows the threshold in force and the
failing metric, and nothing wrong is applied automatically in the meantime. The
degradation is automatic, the **recovery** is too — a passing measurement
restores the configured setting — and both are journalled (`QUALITY_RECORDED`),
so an auditor can see exactly when the tool stopped trusting itself and when it
started again.

## 9. Security

Role-based access with five roles, access levels on every evidence, PII masked
in excerpts and answers, answers filtered by the reader's clearance, encryption
at rest and in transit, EU-only hosting, immutable audit trail, signed packs
verifiable without exposing content, bounded revocable auditor shares. Evidence
content is treated as data, never as instructions (ENF-IA-03): prompts delimit
it, and the model is told that a document asking to be attached to a control is
a document, not an order. Detail in [`SECURITY.md`](./SECURITY.md).

## 10. Cost

The volumes are small: 150 controls and about a hundred new evidences a month
for a typical MSP. The expected run cost is a few tens of dollars per month,
dominated by Data Automation pages and model tokens; the base (S3, Lambda,
DynamoDB, Step Functions) is a few dollars. The extensions add one asymmetric
KMS signing key and a handful of sign/verify operations per pack — a few cents a
month. Nightly work runs on the Flex tier with prompt caching. The hackathon
period (60 evidences, repeated full runs, evaluation jobs) is estimated at
30–80 USD, with an AWS Budgets alert at 80 % of an 80 USD monthly limit.
Per-evidence cost is measured and displayed in the portal. Detail in
[`OPERATIONS.md`](./OPERATIONS.md).

## 11. Operation

Nine CDK stacks deploy the whole product into a fresh account; the procedure is
`infra/README.md` and it is acceptance test R16. Every Lambda has an error alarm
and a throttle alarm; the state machine has a failure alarm; the collector
dead-letter queue has a depth alarm; one dashboard shows invocations, errors and
p95 duration side by side. A 1,000-document backfill is a single nightly run
(ENF-PERF-01), and each evidence is read and attached in under two minutes. The
signing key, the share tokens, the drift watch and the quality loop have their
own routine in [`OPERATIONS.md`](./OPERATIONS.md) §7.

## 12. Scope of this submission

Included: one fictional MSP, one 30-control demonstration framework written for
the occasion, 60 generated evidences, four collectors, reading, attachment,
sufficiency, states, reminders, ask with citations, audit pack, validation
portal, evaluation harness, infrastructure as code — plus the three extensions
and the quality bonus of §8: signed and publicly verifiable packs, bounded
auditor shares, cross-framework mappings demonstrated against a second,
12-control fictional framework (`demo-iso`, `eval/catalogue-iso.ts`), machine
attestations with drift detection, pre-filled drafts, and the measured-quality
loop with automatic degradation.

Not included, by design: the auditor's judgment itself, writing the partner's
policies, remediating environments, and publishing or reselling any protected
framework.

After the hackathon: SharePoint/Confluence/Drive/OneDrive connectors, more AWS
collectors (backups, configuration, access) feeding the machine-attestation and
drift path, additional real frameworks for the mapping catalogue, and a
read-only space for the external auditor built on the share grants.
