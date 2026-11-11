# Submission checklist and judging criteria

## 1. Devpost / AWS MSP checklist (chapter 19.1)

- [ ] **Track 1 selected** — "Run Your MSP Better"; AWS AI service declared:
      **Amazon Bedrock** (managed knowledge bases, Data Automation, structured
      outputs, Guardrails, evaluation tasks, Flex service tier, prompt caching).
- [ ] **English description** — features, problem, measured efficiency gains.
      Draft below in §2; the measured numbers come from `docs/EVALUATION.md` and
      the cost report of `docs/OPERATIONS.md`.
- [ ] **Public portal URL + demo credentials** in the testing instructions —
      `PortalUrl` output of `Registre-Portal`, plus the five accounts printed by
      `infra/scripts/create-demo-users.sh` (one per role).
- [ ] **Private repository shared** with `testing@devpost.com` and
      `aws-msp@amazon.com`.
- [ ] **The code really calls an AWS AI service at runtime** — the pipeline calls
      Bedrock Data Automation, a knowledge base, a model with structured output
      and the guardrail on every evidence; `docs/ARCHITECTURE.md` §4 maps each
      call to the function it uses.
- [ ] **Video ≈ 3 minutes**, public on YouTube, English, no third-party brand or
      music, no protected framework on screen — script and checklist in
      `docs/DEMO.md`.
- [ ] **Architecture diagram** — `docs/ARCHITECTURE.md` (two mermaid diagrams) and
      the image exported for the submission form.
- [ ] **High-level design document** — `docs/HLD.md`.
- [ ] **Solution stays online until 22 January 2027** — base kept with minimal
      traffic; the budget alert covers the post-hackathon period.

## 2. Description draft (paste into Devpost)

> **Registre — continuous audit-evidence registry for MSPs, on Amazon Bedrock.**
>
> Every MSP that wants the AWS MSP validation, or ISO 27001, spends weeks
> gathering evidence before each audit: a policy in a document store, a restore
> test report in a ticket, a certification list in a spreadsheet. AWS Audit
> Manager, which automated evidence collection for AWS resources, is closed to
> new customers — and an MSP audit is mostly about organisational documents,
> which it never covered.
>
> Registre works all year instead. It collects evidence from S3, a manual upload,
> an ITSM export and a dated AWS state report; reads each document with Amazon
> Bedrock Data Automation; attaches it to the controls it supports, quoting the
> passage that justifies the link; checks the quote against the document text in
> code; compares the evidence with what the control expects; recomputes control
> states from dates and periodicities; and reminds owners 30 days before expiry,
> saying exactly what is missing. Before an audit, one click assembles the pack:
> index per control, evidence, checksums, known gaps.
>
> It never says a control is satisfied in the auditor's sense. There is no such
> state in the data model, the wording is refused by the domain layer and by CI,
> and the judgment stays with the auditor. What the partner gets is a continuous,
> defensible answer to "do we have the evidence, is it fresh, and does it contain
> what is expected?".
>
> Bedrock is used for what each function does best: two managed knowledge bases
> (frameworks and evidence), Data Automation for reading, structured output for
> attachments and sufficiency, Guardrails for PII masking and grounded answers,
> evaluation tasks for prompt regression, the Flex tier and prompt caching for
> the nightly backfill. No framework is bundled: each partner imports their own.
>
> Measured on the 60-evidence demonstration set: over 90 % of fields read
> correctly, over 85 % of attachments accepted without correction, every seeded
> gap detected, over 90 % of answers with a verified citation, and no invented
> answer on the five trap questions.

## 3. The four judging criteria (25 % each)

### 3.1 Technical implementation — "Bedrock used deeply"

Each Bedrock function is used for what it is good at, and the reason is written
next to the call:

| Function | Evidence of use |
|---|---|
| Managed knowledge bases (×2) | `infra/lib/bedrock-stack.ts` creates both with S3 data sources; the pipeline queries the frameworks base for candidates; the ask endpoint searches the evidence base with an access-level filter |
| Data Automation | a project with document and image extraction, generative fields and bounding boxes; the reader maps its output onto the Annex B field plan |
| Structured outputs | Annex C and D shapes enforced by schema; the reasoner validates before the code stores anything |
| Guardrails | one guardrail, versioned, anonymising eight PII entity types on input and output, with contextual grounding filters that block an unanchored answer |
| Evaluation tasks | model-as-judge on attachments (custom metrics) and knowledge-base evaluation on questions, regenerated from the same catalogue the demo uses |
| Flex tier | nightly collectors, backfill and digest; interactive calls stay standard |
| Prompt caching | the stable framework + instruction prefix of the attachment prompt is reused across a batch |

Beyond Bedrock, the implementation shows: quote verification in code, a
hash-chained append-only audit log, Object Lock in strict retention mode, a
single-table DynamoDB design with documented access patterns, Step Functions
orchestration with per-step alarms, and infrastructure as code that synthesises
nine stacks offline.

### 3.2 Design

- **A claim is only made when it can be checked.** Every attachment carries a
  quote, and the code verifies the quote exists in the document; a missing quote
  cancels the attachment (R4).
- **The model proposes, the code decides.** States, dates, counts, sufficiency
  classes and missing lists are computed by `src/domain/**`. A model returning a
  state is a type error, not a policy (ENF-IA-04).
- **Doubt goes down, never up.** Uncertain → `TO_VERIFY`. No readable date →
  never `COVERED`. A mandatory control's first evidence of a type needs a human.
- **Evidence is immutable.** Versioned bucket, strict Object Lock for 24 months,
  SHA-256 verified at export, hash-chained log.
- **Reproducible in another partner's account.** Infrastructure as code, an
  imported framework, replaceable collectors, and an installation procedure that
  is itself an acceptance test (R16).
- **Honest deliverables.** The pack contains the known gaps; the API never
  returns a verdict; the wording ban is enforced in CI.

### 3.3 Impact

The problem is one every MSP candidate meets, and the product measures its own
effect:

| Metric | Before | With Registre |
|---|---|---|
| Person-days of audit preparation | Several weeks, concentrated before the audit | A few minutes a week; pack assembled in under 10 minutes on the demo data |
| Controls without fresh evidence | Unknown until the audit | Displayed continuously; every seeded case detected |
| Time to answer an auditor | Hours to days | Under a minute, with document, page and date |
| Human time per evidence | Minutes of filing and cross-checking | Under a minute of validation, and only for uncertain cases |
| Reuse across frameworks | The same document hunted twice | One attachment serves every framework it supports |

The Track 1 angle is explicit: this is internal MSP operations, not a customer
product. It replaces a service AWS closed to new customers, on the ground that
service never covered.

### 3.4 Innovation

- **Audit preparation becomes continuous monitoring.** The unit of work moves
  from "the week before the audit" to "the day a document arrives".
- **Evidence sufficiency, not just retrieval.** The tool does not stop at finding
  documents: it compares what a document contains with what the control expects,
  element by element, and turns the difference into a reminder that says what to
  provide.
- **A register that refuses to judge.** The refusal is designed, typed, tested
  and enforced in CI — a deliberate counter-position to tools that sell a green
  dashboard.
- **Quote-first linking.** The model must justify each link with a passage, and
  the code proves the passage exists; this is what makes an LLM acceptable in an
  audit context.
- **Bring-your-own framework.** No protected text ships, so the tool is usable by
  any partner for any framework, including the programme's own validation list
  that each partner downloads themselves.

## 4. Pre-submission checklist (technical)

- [ ] `npm run verify` green (typecheck, tests, size guard, wording guard).
- [ ] `cd infra && npm run typecheck && npm run synth` green.
- [ ] `npm run eval:local` meets the four targets.
- [ ] Demo run reproduces all sixteen acceptance scenarios (`docs/DEMO.md` §4).
- [ ] Fresh-account installation rehearsed once end to end (R16).
- [ ] No protected framework, no credential, no real data in the repository
      (`git grep -i` for the framework names, plus a manual read of `demo/`).
- [ ] Portal reachable, five demo accounts working, budget alert armed.
- [ ] Video uploaded and linked; repository shared with both AWS addresses.
