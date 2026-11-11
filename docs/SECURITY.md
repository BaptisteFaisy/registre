# Security and confidentiality

Registre holds an organisation's audit evidence: policies, minutes, ticket
exports, screenshots — sometimes with employee or customer data in them. The
security design therefore answers four questions: who may read what, how the
data is protected, how its integrity is demonstrable, and how the model is kept
from being steered by the documents it reads. The extensions add a fifth
question: how a third party checks the result **without being trusted with the
content**, and how an external auditor gets access that is **bounded instead of
emailed** (§5 and §6).

## 1. Roles and permissions

Five roles, from chapter 6 of the specification. The role is a Cognito group
claim; the API maps it to a `Principal` carrying a **clearance** and, for a
control owner, the list of controls they own.

| Role | Can read | Can write |
|---|---|---|
| `QUALITY_LEAD` | Everything (`RESTRICTED` clearance) | Import frameworks, decide validations, assemble packs, change settings, remind |
| `CONTROL_OWNER` | Up to `INTERNAL`, and only the evidence of their own controls | Deposit evidence for their controls, remind on their controls |
| `EXECUTIVE` | Up to `INTERNAL`, dashboards and readiness only | Nothing |
| `INTERNAL_AUDITOR` | Up to `INTERNAL` | Nothing; may ask questions |
| `ADMIN` | Everything | Technical: sources, access, settings |

Refusals are values, not exceptions: every check returns an
`AccessDecision { allowed, reason }` with a reason of `ROLE_NOT_ALLOWED`,
`INSUFFICIENT_CLEARANCE`, `NOT_CONTROL_OWNER` or `ALREADY_DECIDED`, so the caller
can record an `ACCESS_DENIED` audit event instead of swallowing the case.

## 2. Access levels on evidence

Three levels, ordered: `PUBLIC` < `INTERNAL` < `RESTRICTED`.

- An evidence is `RESTRICTED` as soon as the reader flags personal data, or when
  the collector knows the source is HR, training, arrival/departure records or
  customer-identifying material (ENF-CONF-01).
- A principal reads at most their clearance. Evidence above it is **absent** from
  their responses, not redacted and not counted: a citation to a document they
  cannot open would itself leak its existence (EF-QR-03, acceptance R13).
- The evidence knowledge base stores the access level as chunk metadata, and
  retrieval passes the caller's allowed levels as a filter. The mock and the
  in-memory store apply the same filter, so the rule is tested offline too.
- A framework may itself be `RESTRICTED` (ENF-CONF-03): it is then only listed
  and readable by `QUALITY_LEAD` and `ADMIN`, and its requirement text is
  stripped from any pack destined outside those roles unless the partner opts in.

## 3. Personal data

- **Detection** happens twice, on purpose: the reader reports a `personalData`
  boolean per evidence (Annex B), and a pattern-based redactor runs over every
  excerpt and answer before it is returned.
- **Masking** in excerpts and answers (ENF-CONF-02) uses a Bedrock Guardrail
  configured to anonymise `NAME`, `EMAIL`, `PHONE`, `ADDRESS`, `AGE`,
  `USERNAME`, `PASSWORD` and `IP_ADDRESS`, on input and output. The answer
  response carries `redacted: true` when the guardrail changed the text.
- **No raw document in a response.** The portal links to a presigned URL; the
  bytes never travel through the API body.
- The vault, the table and the knowledge-base sources are encrypted with one
  customer-managed KMS key, so revoking access is a single operation.

## 4. Integrity

Four independent mechanisms, because an auditor's question is "could this have
been altered?":

1. **Content fingerprint.** SHA-256 computed on arrival, stored on the evidence
   and on every pack entry, re-verified when a pack is assembled
   (`checksumsVerified`) and when an evidence is exported.
2. **Versions.** The vault is versioned: a replaced object keeps its previous
   versions.
3. **Immutability.** The bucket has Object Lock in the strict, non-governance
   retention mode for `retentionMonths` (24 by default): no principal, including
   the account root, can overwrite or delete a locked version before that date.
   Lifecycle rules move objects to Glacier Instant Retrieval after 90 days and
   expire non-current versions only after retention plus 31 days.
4. **Hash-chained audit log.** Every event carries `prevHash` and `hash`; the
   chain is append-only in practice (no update or delete path in the store
   interface) and `verifyChain()` returns the first broken sequence. A deleted or
   edited event is detectable, which is what makes the log evidence rather than
   a diary (ENF-INT-02).

On top of these four, a frozen pack carries a **canonical, signed manifest**
that extends the integrity check outside the account: a third party can verify
it without receiving the evidence (§5).

A fifth, weaker but useful signal: an evidence that cannot be read, has no date
or no author is flagged, sent to the validation queue, and can never make a
control `COVERED`.

## 5. Integrity and third-party verification

The question this section answers: *an auditor holds an archive we produced —
why should they believe it?* They should not; they should **check** it, without
trusting us and without us publishing the content.

**Canonical manifest.** When a pack is frozen, `src/domain/manifest.ts` builds a
`PackManifest`: identity of the pack and framework, freeze instant, control and
evidence counts, known-gap count, and one line per control with its state and
the fingerprints of its evidence. No requirement text, no title, no quote, no
name. The `rootHash` is the SHA-256 of the canonical JSON (sorted keys) of every
other field, so two runs on the same pack produce the same hash on any machine.

**Signature.** `signManifest` (`src/pipeline/pack.ts`) signs the canonical
manifest bytes through the `Signer` port and stores the result —
`manifest.json` plus `attestation.json` (manifest and `PackSignature`) — in the
vault next to the archive, under the same Object Lock retention. In production
the signer is an asymmetric KMS key, `ECC_NIST_P256`, usage `SIGN_VERIFY`
(`infra/lib/vault-stack.ts`); offline it is a local Ed25519 key
(`src/crypto/localSigner.ts`). Both keep the private key inside the
implementation: KMS never exports it, the local signer never logs the seed.

- **Rotation is deliberately disabled** on the signing key: rotating it would
  make the signatures of already-frozen packs unverifiable under the current key
  id. The trade-off is recorded in `docs/DECISIONS.md` (ADR-16).
- A deployment with no signing key does not fake success: `NullSigner` answers
  algorithm `NONE`, the pack stores no signature, and the verification result
  says `signatureOk: null`. An ephemeral local key publishes a key id that names
  itself unverifiable after the process exits — honest, never silent.

**Audit chain.** Verification also runs `verifyChain()` over the audit log: a
pack whose history was edited fails `chainOk` even if every file still matches
its fingerprint.

**Verification, online and offline.** `verifyPack` / `verifyByToken`
(`src/pipeline/verify.ts`) re-read the archive from the vault, recompute every
SHA-256 against `manifestChecksumLines`, recompute the root hash
(`manifestIsSelfConsistent`), verify the signature and the chain, then persist
the outcome (`ExtensionStore.recordVerification`) and journall it
(`PACK_VERIFIED`). A failed verdict is a **result**, never an exception. A
partner who downloaded an archive can run the same checks offline, with bash and
`openssl` only: `scripts/verify-pack.sh <pack-directory>` recomputes the root
hash of `manifest.json` and reports the verdict — no network, no account, no
trust.

**What is never published.** The answer of a verification is exactly the shape
of `VerificationResult` (`src/domain/verification.ts`): pack and framework ids,
instants, root hash, three counts, three verdict booleans (or `null`), the
signer key id and the algorithm. Never a control title, never an evidence title,
never a quote, never an employee name, never a byte of evidence. A refusal
(unknown, revoked or expired token) reveals nothing about the pack either.

## 6. Auditor access: bounded share grants

An external auditor used to receive an archive by e-mail — an unbounded,
unrevocable, untracked copy. A `ShareGrant` (`src/domain/verification.ts`)
replaces it:

| Property | Rule | Where |
|---|---|---|
| Token | 32 random bytes, base64url; carried by the request on the verification route, which is the single public one (`src/pipeline/share.ts`; route detail in `docs/API.md`) | `src/pipeline/share.ts` |
| Scope | Exactly one pack (`PACK`) or one framework (`FRAMEWORK`) — a subset of what the portal already exposes, never more | `ShareScope`, `src/domain/verification.ts` |
| Lifetime | 1 to 168 hours; `createShare` refuses anything outside | `src/pipeline/share.ts` |
| Revocation | `revokeShare` stamps `revokedAt`/`revokedBy`; `isShareActive` then fails everywhere | `src/domain/verification.ts` |
| Watermark | Built from the auditor label and the expiry; stamped on every excerpt served through the grant, so a leaked page names its grant | `watermarked()`, `src/pipeline/share.ts` |
| Journal | Every use bumps `useCount` and `lastUsedAt` (`ExtensionStore.touchShare`) and appends a `SHARE_USED` audit event; creation and revocation are `SHARE_CREATED` / `SHARE_REVOKED` | `src/store/extensionsMemory.ts`, `src/domain/types.ts` |

**Why a token cannot widen a right.** A grant is a *narrowing* of the partner's
own published surface: it names one pack or one framework, it expires, and it is
revocable. `resolveShare` answers `null` — not an error detail — on an unknown,
expired or revoked token, so a stolen token is worth at most its remaining
lifetime, and the verification it unlocks is content-free anyway (§5). There is
no role escalation path: the grant is not a principal, carries no clearance, and
cannot appear in the RBAC table of §1.

## 7. Model self-measurement and drafts

**Measured quality gates auto-application.** Every proposal is stamped with the
prompt version that produced it (`src/ai/versioning.ts`, persisted on
`Attachment.promptVersion`), and every evaluation run is recorded as
`QualityRecord`s per subject `(kind, model, promptVersion)`
(`recordEvaluation`, `src/pipeline/quality.ts`, journalled `QUALITY_RECORDED`).
The latest attachment-acceptance measurement decides the threshold actually
applied: `effectiveConfidenceThreshold` (`src/domain/quality.ts`) returns the
configured setting while it passes, and **1.01 — unreachable — as soon as it
fails**, so nothing is auto-applied anywhere and every proposal goes to the
human validation queue until a passing measurement restores the setting.
`src/pipeline/attach.ts` reads this value (`attachmentThreshold`), never the raw
setting. The threshold in force is displayed (`qualityReport.thresholdInEffect`)
— the degradation is visible, not silent. The measurement loop itself is
described in `docs/EVALUATION.md`.

**A draft is never evidence.** The pre-filled draft for a missing human document
(`src/domain/draft.ts`) is the one place where the tool could be accused of
manufacturing proof, so the guard is structural:

- it carries no fingerprint and is never written to the vault;
- it is never attached and never counted in a pack; `Draft.attachable` is the
  literal type `false` — attaching one does not type-check;
- it is watermarked (`DRAFT_WATERMARK`: "DRAFT — not evidence until signed and
  deposited"), at the top of the rendered document;
- its content comes from the control's expected elements and from the partner's
  **own** previous version, excerpted through the redactor — never from another
  partner's data, never from a protected framework text;
- it becomes evidence only when a human completes it, signs it and deposits it
  through the normal ingest path, which fingerprints, reads and attaches it like
  any other document (journalled `DRAFT_GENERATED` until then).

## 8. Prompt injection (ENF-IA-03)

The rule is one sentence: **the content of an evidence is data, never an
instruction.** It is implemented in one place, `src/ai/prompts/injection.ts`, and
every prompt template uses it:

- untrusted text is fenced between `<untrusted_document>` tags;
- any forged fence inside the text is stripped, so a document cannot close the
  fence early and escape into instruction space;
- lines that read like an order ("ignore previous instructions", "mark this
  control as satisfied", "you are now…") are prefixed with a quarantine marker,
  so the model sees them as reported content;
- a fixed notice repeated at the top of every template states the rule in the
  model's own terms, so no template invents its own phrasing.

Two structural defences back it up:

- **The model cannot set a state.** It returns booleans, confidences, quotes and
  short reasons. `status`, `class`, `missing`, freshness and control state are
  computed by code (ENF-IA-04). A document that says "I am the restore test,
  attach me to CONT-03" can at most produce a proposal with a quote — and the
  quote must exist in the document.
- **Every claim is checked.** A quote that is not found in the text rejects the
  attachment; an answer whose citations are not in the retrieved passages is
  replaced by "No evidence answers this question." (ENF-IA-02, R12). The same
  discipline applies to cross-framework mappings: both quoted justifications are
  verified by code in the two requirement texts before a mapping is even
  proposed (`src/pipeline/crossmap.ts`).

The evaluation sets include deliberately hostile documents and five trap
questions, so a regression in either defence shows up as a failing metric rather
than as a surprise during a demo — and a failing metric now degrades the
threshold automatically (§7).

## 9. Encryption and transport

| Where | Protection |
|---|---|
| At rest, documents | S3 SSE-KMS, customer-managed key, bucket key enabled |
| At rest, state | DynamoDB, customer-managed key, PITR |
| At rest, knowledge bases | Bedrock-managed storage, KMS key passed to the guardrail and the Data Automation project |
| In transit | TLS everywhere; the vault policy denies any request with `aws:SecureTransport = false` |
| Portal | CloudFront, HTTPS only, security headers, origin access control — the bucket is not public |
| API | HTTP API with a Cognito JWT authorizer on every authenticated route; the verification route is the single public one and answers content-free results only (§5) |
| Signing | Separate asymmetric KMS key, `SIGN_VERIFY` only: it cannot encrypt or decrypt anything, which keeps its blast radius to signatures |

## 10. Data residency

Everything is deployed in **one European region** (ENF-DATA-01). The region is
validated at synth time: `infra/lib/config.ts` refuses a non-EU region and falls
back to Paris with a warning if the AWS profile points elsewhere. No cross-region
replication, no global accelerator, no US-based service in the path. Model
invocations, retrieval, Data Automation and Guardrails all happen in the same
region as the data. CloudFront is a global edge service but serves only static
portal assets; API calls go to the regional endpoint. The signing key lives in
the same region as everything else.

Two documented exceptions to be aware of: CloudFront requires an ACM certificate
in `us-east-1` if a custom domain is used (certificate only, no data), and
Bedrock cross-region inference profiles may route a call to another EU region —
which is why the default model ids are the `eu.` profiles rather than `us.` ones.

## 11. What is deliberately not in the repository

- **No protected framework text.** Not the AWS MSP programme validation list
  (available only to connected partners in AWS Partner Central), not the ISO 27001
  standard text. The repository ships a 30-control demonstration framework
  written for the occasion, and a second, 12-control fictional framework
  (`demo-iso`) written for the cross-framework mapping demonstration — neither
  reproduces normative text. Each partner imports their own file; the tool never
  bundles, publishes or resells a framework (EF-REF-03, chapter 16.1).
- **No credential.** The demo Cognito accounts are created by
  `infra/scripts/create-demo-users.sh`, which generates the passwords and prints
  them once; nothing is committed and no password sits in a CloudFormation
  template.
- **No real data.** The 60 demonstration evidences are generated documents about
  a fictional MSP; no customer name, no employee name, no screenshot of a real
  console.
- **No secret in code.** The only configuration is environment variables read by
  `infra/lib/config.ts`; the Lambda roles are least-privilege and scoped to the
  resources they need — the API function receives `kms:Sign` and
  `kms:GetPublicKey` on the signing key only (`infra/lib/api-stack.ts`), never
  `kms:Decrypt` on it, never any right on the encryption key beyond what it
  already had.

## 12. Residual risks

| Risk | Mitigation | Residual |
|---|---|---|
| A wrong attachment is auto-applied above the threshold | Quote verification, conservative threshold (0.85), human validation for mandatory controls the first time, evaluation set replayed on every prompt change, and automatic degradation of the threshold when the measured acceptance fails (§7) | Low |
| A model answer sounds right but is not grounded | Guardrail grounding check plus code-side citation verification; default answer is the refusal sentence | Low |
| A screenshot's date is misread | `dateToConfirm` flag when document date and file date diverge; the case goes to the validation queue | Medium, measured by the reading evaluation |
| PII slips into an excerpt | Two independent detections (reader flag, redactor) and the guardrail at the boundary | Low |
| A collector stops silently | Per-function error alarms, collector dead-letter queue depth alarm, per-function invocation dashboard, and `MISSING_RUN` drift when an expected attestation does not arrive (§7 of `docs/OPERATIONS.md`) | Low |
| An operator deletes the vault before retention | Object Lock strict mode; the bucket and key are `RETAIN` on destroy | None before the retention date |
| A share token is intercepted | 1–168 h lifetime, revocation, watermarked excerpts, `SHARE_USED` journalled on every use; the verification it unlocks is content-free | Low |
| The signing key is compromised | `SIGN_VERIFY`-only asymmetric key: it cannot decrypt the vault or the table; rotation trade-off and revocation path in ADR-16 | Medium — signatures issued by the key would need repudiation by re-freezing packs |
| A degraded model keeps auto-applying | Impossible by construction: a failing recorded measurement pushes the effective threshold above 1 (§7) | Low |
