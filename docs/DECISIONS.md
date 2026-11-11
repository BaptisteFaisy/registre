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
