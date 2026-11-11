# Submission texts — ready to paste

English texts for the hackathon submission form. Every number below comes from a
real run of the offline demonstration on the current `main`
(`node tools/demo/main.ts --json`, frozen clock `2026-11-11T09:00:00Z`). Anything
that still has to be measured on a live AWS deployment is marked
**[to measure on the deployed run]** — do not present it as measured.

---

## 1. Short description (~200 words)

Registre keeps an MSP audit-ready all year, instead of in a panic the week before
the audit.

Evidence lives everywhere: a policy in a document space, a restore-test report in
a ticket, a certification list in a spreadsheet. Before every AWS MSP validation
audit or ISO 27001 audit, the team spends weeks collecting it again. AWS Audit
Manager automated part of that, but it is closed to new customers and it looked
at AWS resources, while an MSP audit is mostly about documents.

Registre collects evidence, reads it with Amazon Bedrock Data Automation,
attaches it to the controls it supports with a quoted passage, checks that the
quote really exists, compares the document against what the control expects,
computes freshness and expiry, reminds the owner before the evidence goes stale,
answers the auditor's questions with citations, and assembles the audit pack on
demand.

It never says a control is compliant. It says whether evidence exists, whether it
is fresh, and whether it contains what was expected. The judgement stays with the
auditor.

Each partner deploys it in their own AWS account and imports their own framework.
No protected framework text ships with the project.

## 2. Long description (~500 words)

**The problem.** To be validated in the AWS MSP programme, a partner passes an
audit run by an independent third party. ISO 27001 works the same way. Each time,
the same weeks are lost: finding a policy in a document space, a restore-test
report in a ticket, a certification list in a spreadsheet, and discovering the
night before the audit that a policy has not been reviewed for eighteen months.
AWS Audit Manager automated part of this, but it is no longer open to new
customers, and it collected evidence about AWS resources while an MSP audit is
mostly about documents — policies, procedures, minutes, exports, training records.

**What Registre does.** One agent, running continuously:

1. **Collects** evidence from an S3 bucket, manual deposits, ticket exports and
   dated AWS state reports, fingerprinting every file so a duplicate is recorded
   once with two locations.
2. **Reads** each document with Bedrock Data Automation against a field blueprint:
   type, title, document date, covered period, version, author, approver, client,
   summary, personal data. Unreadable or undated documents are flagged, never
   guessed.
3. **Attaches** each document to the controls it supports. The knowledge base
   over the frameworks returns candidates; a structured model call returns a
   confidence, a quoted passage and a reason. **Our code then verifies that the
   quote exists in the document** — a quote that is not found cancels the
   attachment. Above the confidence threshold the attachment is applied; below
   it, it waits for a human.
4. **Assesses sufficiency** element by element against what the control expects,
   and lists what is missing.
5. **Computes states** — covered, to renew, to verify, expired, no evidence —
   from the periodicity of the control and the date of the evidence. States,
   dates and counts are computed by code; the model computes none of them.
6. **Reminds** the owner thirty days before expiry, saying what to provide, and
   sends the quality lead a weekly digest.
7. **Answers** questions with citations — document, page, date — behind
   Guardrails, and says "no evidence answers this question" rather than inventing
   one.
8. **Assembles** the audit pack: index by control, evidence with fingerprints,
   known gaps, verified checksums.

**Bedrock, feature by feature.** Managed knowledge bases (one for frameworks, one
for evidence), Data Automation for document reading, structured output for
attachment and sufficiency, Guardrails for PII redaction and answer grounding,
evaluation jobs for non-regression of the attachment and answer quality, the Flex
service tier for nightly batches, and prompt caching for the long repeated
candidate list.

**Reproducible by design.** Nothing is hard-coded to one partner: the framework
is imported from a file, collectors are pluggable behind one interface, the whole
stack is CDK, and each partner runs it in their own account with their own data.
An offline mode with deterministic stand-ins runs the entire product with no AWS
account, which is how the CI, the tests and the demonstration work.

**What it never does.** It never judges compliance, never writes policies in the
partner's place, never remediates an environment, and never ships or displays a
protected framework.

## 3. Measured efficiency gains

From the demonstration run (30 controls, 6 domains, 60 documents, frozen clock):

| Measure | Value on the demonstration set | Production target |
|---|---|---|
| Audit pack assembled | in the same run as the ingestion, seconds, index of 30 controls, checksums verified | < 10 minutes |
| Controls with no fresh evidence | 22 of 30 shown continuously (14 to verify, 8 expired), including all six seeded cases | < 5 % at any time |
| Duplicate documents | 1 detected, recorded once with two locations | detected on ingest |
| Attachments proposed | 66 supporting attachments over 60 documents | — |
| Attachments accepted without correction | 11 proposals accepted by the quality lead during the run, 38 items left in the queue for review | > 85 % **[to measure on the deployed run]** |
| Fields read correctly | — | > 90 % **[to measure on the deployed run]** |
| Answer to a question with evidence | cited with document, page and date | < 1 minute |
| Answer to a question with no evidence | refused: "No evidence answers this question." | 0 invented answers |
| Reminders generated | 7, each naming what the owner must provide | sent 30 days ahead |
| Cost per evidence | $0.0197 (total $1.18 for the run, offline price list) | measured and displayed |

Engineering measures, from CI on the current `main`:

| Measure | Value |
|---|---|
| Automated tests | 677 green, plus 15 contract tests that drive the real portal client against the real HTTP API |
| Type check | 8 seconds |
| CI verdict | under 5 minutes, on self-hosted runners, five parallel jobs |
| Infrastructure | 9 CDK stacks, `cdk synth` green |
| Quality guards | file and function size limits, and a wording guard that fails the build if a control is ever called compliant |

Baseline to state honestly in the form: the "several weeks per audit" starting
point is our working hypothesis, not a measured figure. **[to confirm with the
partner's own history before submission]**

## 4. Test instructions for the judges

Prerequisites: Node.js 22 or later, and `git`. No AWS account is needed for the
offline path.

```bash
git clone https://github.com/BaptisteFaisy/registre.git
cd registre
npm ci                          # ~5 s
node tools/demo/generate.ts     # writes the 60 demonstration documents
npm run demo                    # the whole chain, offline, deterministic
```

Expected on the demonstration run: 30 controls across 6 domains, 60 documents
ingested, 1 duplicate detected, states 5 covered / 3 to renew / 14 to verify /
8 expired, 7 reminders, an assembled pack with verified checksums, one answered
question with citations and one refused question. `demo-out/report.md` holds the
full report.

To drive the product through its HTTP API and portal:

```bash
node src/api/server.ts          # API on http://127.0.0.1:8787
cd portal && npm ci && npm run dev:demo   # portal in offline mode
```

Demonstration credentials are in `docs/DEMO.md` (four roles: quality lead,
control owner, internal auditor, administrator). The API contract is served live
at `http://127.0.0.1:8787/openapi.json` and documented in `docs/API.md`.

To verify the tests and the guards:

```bash
npm test                # 677 tests
npm run check:sizes     # files < 500 lines, functions < 50 lines
npm run check:wording   # no control is ever called compliant
```

To deploy in your own account (EU region required; Bedrock Data Automation is
available in `eu-central-1` and `eu-west-1`), follow `infra/README.md`, then set
`REGISTRE_PROVIDER=bedrock` as described in `docs/OPERATIONS.md`.

Suggested reading order: `README.md` → `docs/HLD.md` → `docs/ARCHITECTURE.md` →
`docs/SECURITY.md` → `docs/EVALUATION.md`.

## 5. The four judging criteria

**Technical implementation.** Bedrock is used for what each capability does best,
not as a single chat call: managed knowledge bases for retrieval over frameworks
and evidence, Data Automation with a custom field blueprint for reading
documents, structured output for attachment and sufficiency, Guardrails for PII
redaction and grounding, evaluation jobs for non-regression, the Flex tier and
prompt caching for the nightly batch. Adapters are behind ports, so the same
product runs offline in CI and on AWS in production.

**Design.** Every claim is anchored: a quoted passage is verified in the document
by code before an attachment is applied, and an answer whose citations do not
check out is replaced by a refusal. Doubt always resolves to "to verify", never
to "covered". Evidence is stored with a fingerprint, in versions, under a
retention lock; the audit log is hash-chained. The framework is imported, never
embedded, and access is by role and clearance with every denial journalled.

**Impact.** Every partner aiming at MSP validation meets this problem, and the
same evidence serves several frameworks. Three measures carry the claim: time to
assemble the audit pack, controls without fresh evidence visible at all times
instead of discovered the night before, and time to answer an auditor.

**Innovation.** Audit preparation stops being a project and becomes a continuous
control. The project also picks up where a closed AWS service left off: Audit
Manager automated evidence about AWS resources and is closed to new customers,
while an MSP audit is mostly about documents — which is exactly what Data
Automation and knowledge bases are for.

## 6. Mandatory statement on protected frameworks

> This repository contains no AWS MSP programme validation checklist and no
> ISO 27001 normative text. The demonstration framework (`demo-msp`, 30 controls
> across 6 domains) and its 60 evidence documents were written for this project
> and describe a fictional managed service provider. Each partner imports their
> own framework from a file, in their own account; the tool stores and processes
> it but never publishes or resells it.
