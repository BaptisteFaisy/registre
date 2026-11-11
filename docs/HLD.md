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
first time that evidence type is seen.

## 5. Architecture

The full deployment view and the processing sequence are in
[`ARCHITECTURE.md`](./ARCHITECTURE.md). In one paragraph: evidence lands in a
versioned S3 vault locked with Object Lock; a Step Functions chain fingerprints
it, reads it with Bedrock Data Automation, asks a Bedrock managed knowledge base
for candidate controls, asks a Bedrock model for attachments and sufficiency in
structured form, verifies every quote against the document text, recomputes
control states in code, and indexes the text into a second knowledge base. A
React portal served by CloudFront talks to an HTTP API behind Cognito. SES sends
reminders. Everything runs in one European region.

## 6. Data model

Nine entities, one DynamoDB table: framework, control, evidence, attachment,
sufficiency, control state, reminder, pack, audit event. Field-level detail and
the key layout are in [`DATA-MODEL.md`](./DATA-MODEL.md).

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

## 8. Security

Role-based access with five roles, access levels on every evidence, PII masked
in excerpts and answers, answers filtered by the reader's clearance, encryption
at rest and in transit, EU-only hosting, immutable audit trail. Evidence content
is treated as data, never as instructions (ENF-IA-03): prompts delimit it, and
the model is told that a document asking to be attached to a control is a
document, not an order. Detail in [`SECURITY.md`](./SECURITY.md).

## 9. Cost

The volumes are small: 150 controls and about a hundred new evidences a month
for a typical MSP. The expected run cost is a few tens of dollars per month,
dominated by Data Automation pages and model tokens; the base (S3, Lambda,
DynamoDB, Step Functions) is a few dollars. Nightly work runs on the Flex tier
with prompt caching. The hackathon period (60 evidences, repeated full runs,
evaluation jobs) is estimated at 30–80 USD, with an AWS Budgets alert at 80 % of
an 80 USD monthly limit. Per-evidence cost is measured and displayed in the
portal. Detail in [`OPERATIONS.md`](./OPERATIONS.md).

## 10. Operation

Nine CDK stacks deploy the whole product into a fresh account; the procedure is
`infra/README.md` and it is acceptance test R16. Every Lambda has an error alarm
and a throttle alarm; the state machine has a failure alarm; the collector
dead-letter queue has a depth alarm; one dashboard shows invocations, errors and
p95 duration side by side. A 1,000-document backfill is a single nightly run
(ENF-PERF-01), and each evidence is read and attached in under two minutes.

## 11. Scope of this submission

Included: one fictional MSP, one 30-control demonstration framework written for
the occasion, 60 generated evidences, four collectors, reading, attachment,
sufficiency, states, reminders, ask with citations, audit pack, validation
portal, evaluation harness, infrastructure as code.

Not included, by design: the auditor's judgment itself, writing the partner's
policies, remediating environments, and publishing or reselling any protected
framework.

After the hackathon: SharePoint/Confluence/Drive/OneDrive connectors, more AWS
collectors (backups, configuration, access), cross-framework mapping (one
evidence proposed for an equivalent control in another framework), assisted
drafting of missing evidence, and a read-only space for the external auditor.
