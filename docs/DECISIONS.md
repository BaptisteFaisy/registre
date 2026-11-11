# Decision log (short ADRs)

One page per decision, in the order they were taken. Format: context, decision,
consequences, alternatives rejected. Everything here is enforced somewhere in the
code or the infrastructure — a decision that is not enforced would be a wish.

---

## ADR-01 — Bedrock managed knowledge bases instead of a self-hosted vector store

**Context.** Attachment needs candidate controls for an evidence; the ask
endpoint needs passage search over evidence.

**Decision.** Two Bedrock managed knowledge bases (frameworks, evidence) with S3
data sources.

**Consequences.** No index to operate, native connectors to where evidence
actually lives (S3 today, SharePoint/Confluence/Drive/OneDrive next), and the
Bedrock usage is real rather than decorative. Cost: less control over chunking
and over metadata filtering; the evidence knowledge base stores the access level
as metadata, and if filtering is not available the adapters post-filter (the mock
already does).

**Rejected.** OpenSearch Serverless + a custom embedding pipeline: more moving
parts, a second index to back up, and no benefit for 150 controls.

---

## ADR-02 — The code computes every state; the model only reads

**Context.** A model could plausibly output "this control is fine". That output
would not be reproducible, not testable, and not defensible.

**Decision.** `src/domain/**` computes freshness, control state, sufficiency
class, missing list, readiness counts and shares, from stored dates and
periodicities. The model returns booleans, confidences, quotes, short reasons
and extracted fields — nothing else.

**Consequences.** ENF-IA-04 becomes a type-level fact, not a convention. The
engine is unit-testable without a network. The prompt can be swapped without
touching the state machine.

**Rejected.** Letting the model return a state and "validating" it: validation
would need the same code anyway, and the model's answer would remain an
unexplainable input.

---

## ADR-03 — A quote must be found in the document, or the attachment is cancelled

**Context.** The single failure that would destroy trust in the register is a
fabricated citation.

**Decision.** After the model proposes an attachment, the code searches the
quoted passage in the extracted text (whitespace-normalised, accent-insensitive).
Not found → status `REJECTED`, reason `CITATION_NOT_FOUND`, and the case is
queued for a human.

**Consequences.** One string search per attachment, a hard guarantee, acceptance
test R4. The reader must therefore keep page-level text (`textPages`), which
costs storage and is worth it.

**Rejected.** Trusting the model, or checking only that the page number is in
range.

---

## ADR-04 — Confidence threshold with a human validation queue

**Context.** Auto-applying every proposed attachment saves time; one wrong
auto-applied link costs more than ten queued proposals.

**Decision.** Attachments at or above `confidenceThreshold` (default 0.85) are
`APPLIED` with `autoApplied: true`; below it they are `PROPOSED` and appear in
the validation queue. A mandatory control's first evidence of a given type always
needs a human validation, whatever the confidence.

**Consequences.** The queue is the human's job, a few items a week. The threshold
is a setting, auditable and changeable, and a change is an audit event.

**Rejected.** A single global auto-apply, or a threshold that varies silently by
evidence type.

---

## ADR-05 — One DynamoDB table

**Context.** Nine entities with known access patterns.

**Decision.** One table, `pk`/`sk`, two GSIs (`gsi1` for hash lookup and
framework scoping, `gsi2` for the portal lists), on-demand capacity, PITR,
customer-managed key.

**Consequences.** One backup story, one key, one recovery point, and no
cross-table transaction for an operation that touches an attachment, a
sufficiency, a status, a trend point and an audit event. The cost is that the key
design must be documented — it is, in `docs/DATA-MODEL.md` §3.

**Rejected.** One table per entity: five writes across five tables per evidence.

---

## ADR-06 — The vault is immutable in strict retention mode

**Context.** ENF-INT-01 asks for storage that cannot be altered or deleted before
the retention date. An auditor will ask exactly that question.

**Decision.** S3 with versioning, Object Lock enabled, default retention in the
strict (non-governance) mode for `retentionMonths` (24 by default), SSE-KMS with
a customer-managed key, public access blocked, TLS enforced by bucket policy.

**Consequences.** Nobody, including the account root, can delete a locked version
before the date. Stack destroy keeps the bucket and the key (`RETAIN`). The
retention period is a parameter, so a partner with a longer audit cycle can raise
it — lowering it later does not shorten what is already locked.

**Rejected.** Governance mode (removable by a privileged user), or no lock at
all. Note that the CDK API for strict mode is called
`ObjectLockRetention.compliance(...)`; the name refers to S3's retention mode,
not to the wording banned by ENF-IA-01.

---

## ADR-07 — Append-only, hash-chained audit log

**Context.** ENF-INT-02: the action log must not be modifiable.

**Decision.** Every event carries `seq`, `prevHash` and `hash`; the store
interface exposes `append` and `list` only, no update, no delete; `verifyChain()`
returns the first broken sequence.

**Consequences.** A deletion or edit is detectable, and the portal can prove the
chain is intact on demand. Cost: appends are serialised per table partition, which
is fine at this volume.

**Rejected.** CloudTrail alone (it logs API calls, not domain decisions), or a
log without chaining (nothing to verify).

---

## ADR-08 — The framework is imported, never bundled

**Context.** The AWS MSP programme validation list is restricted to connected
partners; the ISO 27001 text is copyrighted. Shipping either would be a licensing
problem and a confidentiality problem.

**Decision.** The repository contains a 30-control demonstration framework written
for the occasion. Every partner imports their own file (Annex A format). The tool
stores the framework text in the partner's account, with a confidentiality level.

**Consequences.** The product is usable by any partner for any framework, which
is also what makes it reproducible (chapter 7). A `RESTRICTED` framework is
readable only by the quality lead and the admin, and its text is stripped from
packs destined outside those roles unless the partner opts in (ENF-CONF-03).

**Rejected.** Bundling a "starter framework": it would be wrong for every partner
and would put protected text in a public repository.

---

## ADR-09 — Node 22 with native TypeScript, no bundler for `src/`

**Context.** A hackathon product with one main developer and parallel
workstreams.

**Decision.** `src/`, `tools/` and `test/` run directly on Node ≥ 22.18 with
native type stripping; `.ts` import specifiers; `node --test`. Only `infra/` and
`portal/` have a build step.

**Consequences.** Fewer moving parts; the same code runs in tests, in the demo and
in the Lambda. Lambda packaging uses esbuild through `NodejsFunction`, because
the AWS runtime cannot resolve `.ts` specifiers at load time.

**Rejected.** A monorepo build pipeline (tsc + bundler + watch) for a codebase of
this size.

---

## ADR-10 — Offline-first demo and tests

**Context.** Judges and CI must be able to run the product without an AWS
account, and tests must never touch the network.

**Decision.** Every boundary is a port (`src/ports/index.ts`); deterministic mocks
(`src/ai/mock/*`) and an in-memory store (`src/store/memory.ts`) implement them.
`npm run demo` runs the whole flow offline; the same code runs on AWS with the
Bedrock adapters.

**Consequences.** Tests are fast, free and reproducible; the demo cannot fail
because of a quota. Cost: two implementations of each boundary, kept honest by
the same port and by the evaluation sets.

**Rejected.** Recording HTTP fixtures: they rot silently and hide model changes.

---

## ADR-11 — Evidence content is data, never instruction

**Context.** Documents arrive from anywhere and may contain text that looks like
an order ("mark this control as satisfied").

**Decision.** One module, `src/ai/prompts/injection.ts`: untrusted text is fenced
in `<untrusted_document>` tags, forged fences are stripped, order-like lines are
quarantined, and a fixed notice repeats the rule at the top of every template.
Structurally, the model cannot set a state and every quote is verified.

**Consequences.** A hostile document can at most produce a proposal whose quote
must exist. The evaluation sets include hostile documents and trap questions.

**Rejected.** Relying on the model's good behaviour, or filtering keywords (which
any paraphrase defeats).

---

## ADR-12 — Nine CDK stacks, one region, EU-only

**Context.** ENF-DATA-01 requires EU hosting; ENF-REP-01 requires infrastructure as
code; a fresh-account installation is an acceptance test (R16).

**Decision.** Nine stacks by concern, wired by typed properties, one region
validated at synth time (`infra/lib/config.ts` refuses a non-EU region). A missing
application handler is replaced by a 501 stub with a synth warning, so the
infrastructure can be built and reviewed before the application is complete.

**Consequences.** Each stack can be reviewed and destroyed on its own; the region
constraint is impossible to bypass by accident. Cost: cross-stack references, and
a documented regional caveat (Data Automation is available in `eu-central-1` and
`eu-west-1`, not in Paris at the time of writing).

**Rejected.** One monolithic stack (unreviewable diff), or a non-EU region for
convenience.

---

## ADR-13 — Reminders carry the missing list

**Context.** "Please renew your evidence" produces a generic document; the tool
already knows exactly which expected element was absent.

**Decision.** A reminder's `missing` field echoes `Sufficiency.missing`, and the
message names the elements to provide. Reasons are `EXPIRING_SOON`,
`NO_EVIDENCE` and `MISSING_ELEMENTS`.

**Consequences.** The owner can act on the first try, which is the difference
between a reminder and a notification. The weekly digest reuses the same text
builder, so there is one phrasing to maintain.

**Rejected.** A generic reminder with a link to the control.

---

## ADR-14 — The portal client is the API contract

**Context.** The API and the portal were written in parallel, and each kept its
own copy of the shapes: `src/api/views.ts` on the producer side,
`portal/src/api/types.ts` on the consumer side. The first revision of
`docs/API.md` described what the producer happened to send — envelopes, mixed
reads, a diff glued to the import — and the portal read none of it. One of the
two had to become the reference.

**Decision.** The portal client is the contract. `portal/src/api/types.ts`
names the shapes, `portal/src/api/client.ts` names the routes, and the API
adapts to them — never the other way round. `docs/API.md` §3 documents one
route per client method and §4 restates the shapes field by field. The route
table in `src/api/routes/table.ts` and the OpenAPI document are generated from
the same source, and `test/contract/api-portal.test.ts` drives the real client
against the real server.

**Consequences.** One shape per route, no adapter layer in the portal, and the
offline mock (`portal/src/mocks/client.ts`) and the HTTP client implement the
same `RegistreApi` interface, so every screen runs both ways. The cost is that
the API loses the freedom to answer with richer payloads: anything the portal
does not read is not part of the contract, and adding it means a new field in
`types.ts` plus a client method, not a server-side extra. The second cost is
that `types.ts` became a shared artefact — changing it is a contract change and
is documented here, not slipped into a feature branch.

**Rejected.** (a) The API defines the contract and the portal adapts: the
portal would then need an adapter per route and the mock would drift from the
HTTP client, which is exactly the two-copies problem this decision removes.
(b) An OpenAPI-first codegen pipeline: for twenty-four routes the generator
would own the shapes and the mock would have to be generated too — more moving
parts than value.

---

## ADR-15 — Bare arrays instead of envelopes

**Context.** The first revision answered lists with envelopes: `{frameworks,
total}`, `{controls, total}`, `{items, total, status}`, `{reminders, total}`,
`{events, total, limit, offset, nextOffset}`, `{attachments, controlId, total}`;
and reads with mixed objects: `{control, status}`, `{framework, controls,
diff}`, `{item, controls}`, `{controlId, sent, reminders}`. Two of the list
envelopes already disagreed with each other (`{items}` on one route, `{events}`
on another), which is the usual beginning of a drift nobody owns.

**Decision.** A list route answers with the array itself, a read route answers
with the object itself, and paging or filtering happens through query
parameters (`?limit=`, `?action=`, `?status=`, `?frameworkId=`, `?controlId=`).
Where a screen genuinely needs several entities at once, the answer is one
named shape — `ReadinessOverview`, `ControlWithRelations` — rather than loose
keys in an object.

**Consequences.** The client writes `await api.listFrameworks()` and receives
`Framework[]`: nothing to unwrap, no `total` to keep in step with the array, no
`nextOffset` arithmetic. The cost is that there is no place left for pagination
metadata: a caller that needs more asks for a bigger `limit`, and a real cursor
would mean a new route rather than a new field on an existing one. The second
cost is visible on `GET /v1/audit-log`, which can no longer carry the
chain-verification report beside the events — that report now has its own
question.

**Rejected.** Keeping envelopes "for future pagination": a wrapper nobody reads
today is a shape to maintain today, and the portal is the only consumer. Also
rejected, a hybrid where reads keep envelopes and lists do not — it would
reintroduce two shapes per route and the drift that comes with them.

## ADR — the conflict agent runs on InferHub

**Date.** 2026-11-11. **Status.** accepted.

**Context.** The pull-request conflict agent (`.github/fireworks/conflict_agent.py`,
called by the `pr-auto-merge` sweep when a rebase fails) was wired to Fireworks.
The rest of the tooling already runs on InferHub, so two model providers had to
be provisioned, two keys rotated, and two failure modes watched.

**Decision.** InferHub is the provider: `https://api.inferhub.dev/v1/chat/completions`
(OpenAI-compatible) with the meta-router model `combo/cheap`. Resolution order in
the agent is `INFERHUB_API_KEY` → `FIREWORKS_API_KEY`, `INFERHUB_MODEL` →
`FIREWORKS_MODEL` → `combo/cheap`, `INFERHUB_BASE_URL` → `FIREWORKS_BASE_URL` →
the InferHub endpoint. An empty GitHub variable falls back exactly like an
absent one, so a half-configured repository degrades to the previous provider
instead of sending an empty model name.

**Consequences.** One secret and one model to operate. The directory keeps its
`fireworks/` name because three workflows reference those paths; renaming it is
cosmetic and would touch guarded files for no behavioural gain. The kill switch
is `INFERHUB_AGENT_RESOLVE=0`. Without any key the agent skips cleanly and the
pull request waits for a human rebase — it never merges on its own.

---

## ADR-16 — The pack signing key is separate from the encryption key, and does not rotate

**Date.** 2026-11-11. **Status.** accepted.

**Context.** A frozen audit pack must stay verifiable by a third party months
after it was assembled (`docs/SECURITY.md` §5). The vault already has a
customer-managed symmetric KMS key for encryption, with rotation enabled.

**Decision.** A second, asymmetric KMS key signs pack manifests:
`ECC_NIST_P256`, usage `SIGN_VERIFY`, `enableKeyRotation: false`, `RETAIN` on
stack destroy (`infra/lib/vault-stack.ts`). `signManifest` (`src/pipeline/pack.ts`)
signs the canonical manifest bytes through the `Signer` port (`src/ports/index.ts`);
production uses `REGISTRE_SIGNER=kms` with `REGISTRE_SIGNING_KEY_ARN`
(`infra/lib/api-stack.ts`, granting `kms:Sign` and `kms:GetPublicKey` only), the
offline demo and the tests use a local Ed25519 key (`src/crypto/localSigner.ts`,
`REGISTRE_SIGNING_KEY` / `REGISTRE_SIGNING_KEY_FILE`).

**Consequences.** A `SIGN_VERIFY` key cannot encrypt or decrypt anything: its
blast radius is signatures, and a policy change on the encryption key never
touches verification. No rotation means a pack frozen today verifies under the
same key id in five years — verifiability of a frozen artefact requires key
stability, while confidentiality benefits from rotation; the two goals get two
keys. A deployment without a key is honest rather than fake: `NullSigner`
returns algorithm `NONE`, no signature is stored, and `signatureOk` is `null`;
an ephemeral local key publishes a key id that says it cannot be verified after
the process exits. Cost: one asymmetric KMS key more (§7 of
`docs/OPERATIONS.md`).

**Rejected.** (a) Reusing the symmetric vault key: one compromise or one policy
change would break both confidentiality and authenticity, and a key that can
decrypt the vault would sit in the signing path. (b) Automatic rotation: it
would orphan the signatures of every pack frozen under the previous key — the
exact artefacts an auditor re-checks later. (c) Signature-only-in-the-portal:
an offline archive must be verifiable with `scripts/verify-pack.sh`, without our
API.

---

## ADR-17 — Mappings are proposals, never decisions

**Date.** 2026-11-11. **Status.** accepted.

**Context.** An MSP passes several audits a year; the same evidence supports
equivalent controls of different frameworks. Letting the tool carry an
attachment across frameworks by itself would multiply the reach of one wrong
equivalence — and the second framework's auditor never saw the first decision.

**Decision.** A cross-framework mapping (`src/domain/mapping.ts`) is persisted
`PROPOSED` with **two quotes**, one per requirement text, **both verified by
code**; a human validates or rejects it (`decideMapping` in
`src/pipeline/crossmap.ts`, journalled `MAPPING_DECIDED`). A validated mapping
only **proposes**: `propagateAttachment` creates `PROPOSED` attachments on the
mapped controls of the other framework — never `APPLIED` — reusing the same
verified quote, and those proposals go through that framework's own validation
queue. Candidate pairs are scored by the code-side `similarity()` of
`src/support/normalize.ts`; no new model call is introduced.

**Consequences.** The discipline of attachments (ADR-03, ADR-04) extends
unchanged to equivalences: quote verified by code, human decides, doubt resolves
downwards. Reuse stays measurable: `reuseMetric` reports evidence carried,
attachments proposed and deposits avoided, computed by code from stored
mappings and attachments. The demonstration target is a second, 12-control
fictional framework written for this project (`eval/catalogue-iso.ts`), never a
protected standard. Cost: a few human validations per quarter — the cheap side
of the trade.

**Rejected.** Auto-applying propagated attachments above a confidence threshold:
an equivalence links two abstractions, is harder to spot-check than a quote in a
document, and an error would propagate silently into every future audit of the
second framework.

---

## ADR-18 — Machine attestations have their own cadence

**Date.** 2026-11-11. **Status.** accepted.

**Context.** Collectors can produce a dated statement about a real state every
day (last night's backups, this month's access review). Judging such a statement
by the control's annual periodicity would hide a broken backup for eleven
months; reusing the control's periodicity for everything was the status quo.

**Decision.** An evidence carries `provenance: 'HUMAN_DOCUMENT' |
'MACHINE_ATTESTATION'` and, for attestations, an `attestedState`
(`src/domain/types.ts`, `src/domain/verification.ts`). Freshness of an
attestation uses the refresh **cadence**, not the control periodicity:
`DEFAULT_REFRESH_POLICY` is 24 h plus 6 h of grace, and `cadencePeriodicity()`
converts it to an ISO-8601 duration, exposed as the single helper
`machinePeriodicityFor()` (`src/domain/freshness.ts`) that the state engine
uses (`src/domain/states.ts`) — one freshness implementation, two
periodicities. Successive attestations are compared by code:
`STATE_CHANGED`, `MISSING_RUN` (nothing arrived within cadence plus grace,
scanned by the drift watch — `missingRuns`, `src/pipeline/drift.ts`),
`THRESHOLD_CROSSED` and `RECOVERED` drift events
move the control within the day and ride the existing reminder to the owner, who
acknowledges with author and date (`src/pipeline/drift.ts`, journalled
`DRIFT_DETECTED` / `DRIFT_ACKNOWLEDGED`).

**Consequences.** A silent collector becomes visible as a `MISSING_RUN` drift
instead of freezing a control in a reassuring state; a state change is reflected
the day it is observed, not at the next audit. Drift kinds and dates are computed
by code (ENF-IA-04) and the deterministic `driftId` keeps one drift per control,
kind and day. A missing human document gets a pre-filled **draft** built from the
expected elements and the partner's own previous version — watermarked, never
fingerprinted, never attached (`attachable: false` at type level,
`src/domain/draft.ts`): the cadence of machines must not become a way for the
tool to write the proof itself.

**Rejected.** (a) One periodicity per control for every evidence: wrong by a
factor of 365 for daily attestations. (b) A forked `evaluateControl` for machine
evidence: two freshness engines would drift apart — the cadence is expressed in
the same ISO-8601 vocabulary instead.

---

## ADR-19 — Measured quality overrides the configured threshold

**Date.** 2026-11-11. **Status.** accepted.

**Context.** The confidence threshold (ADR-04, default 0.85) assumes the model
and the prompt stay what they were when it was chosen. Prompts change, providers
version models, corpora drift. A fixed threshold fails silently: a degraded
model keeps auto-applying until a human spots a wrong link in a pack.

**Decision.** Every proposal is stamped with its prompt version
(`PROMPT_VERSIONS` per family in `src/ai/versioning.ts`, persisted on
`Attachment.promptVersion`). Every evaluation run — local scorer or Bedrock
evaluation task — is recorded as `QualityRecord`s per subject
`(kind, model, promptVersion)` by `recordEvaluation` (`src/pipeline/quality.ts`,
journalled `QUALITY_RECORDED`, conversion in `tools/eval/lib/qualityRecords.ts`,
runner `tools/eval/runAndRecord.ts` with a `--check` gate). The attachment
pipeline reads `attachmentThreshold()`, which applies
`effectiveConfidenceThreshold` (`src/domain/quality.ts`): the configured setting
while the latest `ACCEPTED_WITHOUT_CORRECTION` measurement passes, **1.01 —
unreachable — while it fails**, so nothing is auto-applied and everything goes
to the human validation queue until a passing measurement restores the setting.

**Consequences.** Degradation is automatic, noisy and safe: the queue grows, the
quality report displays the threshold in force (`qualityReport.thresholdInEffect`)
and the trend per subject shows which metric fell. Recovery is automatic too.
The tool never claims an accuracy it cannot prove — the claim on screen is the
measurement. The two zero-target metrics (`WRONG_HIGH_CONFIDENCE`,
`INVENTED_ANSWERS`) keep their absolute meaning: any occurrence is a failure.
Cost: evaluation runs must be repeated after every prompt or model change — the
discipline `docs/EVALUATION.md` already required, now with teeth.

**Rejected.** (a) A fixed threshold with periodic manual review: the review is
the silent failure this removes. (b) Lowering or raising the configured setting
by hand when quality moves: unauditable and reversible by accident; the override
is computed, journalled and self-restoring.

