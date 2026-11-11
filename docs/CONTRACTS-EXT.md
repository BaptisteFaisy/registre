# Extension contracts — axes 1, 2, 3 and the quality bonus

Read `CONTRACTS.md` first. This file only adds what is new; the hard rules there
still apply (files < 500 lines, functions < 50 lines, no duplication, no
`compliant` wording for a control, English code, no network in tests, relative
imports with `.ts`).

## 0. What already exists (do not redefine, do not rename)

| File | Content |
|---|---|
| `src/domain/verification.ts` | `PackManifest`, `PackSignature`, `SignatureAlgorithm`, `VerificationResult`, `ShareGrant`, `ShareScope`, `EvidenceProvenance`, `provenanceOf()`, `isShareActive()` |
| `src/domain/manifest.ts` | `buildManifest()`, `rootHashOf()`, `manifestIsSelfConsistent()`, `manifestChecksumLines()`, `checksumsHash()` |
| `src/domain/mapping.ts` | `ControlMapping`, `MappingStatus`, `MappingDirection`, `ReuseMetric`, `mappingId()` |
| `src/domain/quality.ts` | `DriftEvent`, `DriftKind`, `RefreshPolicy`, `DEFAULT_REFRESH_POLICY`, `cadencePeriodicity()`, `driftId()`, `QualityRecord`, `QualityMetric`, `QualitySubject`, `subjectKey()`, `effectiveConfidenceThreshold()`, `latestAttachmentAccuracy()` |
| `src/domain/draft.ts` | `Draft`, `DraftSection`, `DRAFT_WATERMARK`, `renderDraft()`, `draftId()` |
| `src/crypto/localSigner.ts` | `LocalSigner` (Ed25519), `NullSigner`, `signerFromEnv()` |
| `src/store/extensionsMemory.ts` | `MemoryExtensionStore` — implements the whole `ExtensionStore` port |
| `src/ports/index.ts` | `Signer`, `SignerOutput`, `ExtensionStore`; `Services` now carries `signer` and `extensions` |
| `src/pipeline/pack.ts` | writes `index.json`, `manifest.json`, `attestation.json`; `signManifest()`; the `Pack` now has `manifest` and `signature` |
| `src/domain/types.ts` | `Evidence.provenance?`, `Evidence.attestedState?`, `Attachment.promptVersion?`, `ValidationKind` includes `'MAPPING'` |

`copyWithEvent`, `canonicalJson`, `sha256Json`, `record()` (audit), `badRequest`,
`notFound`, `conflict`, `upstream` — all exist, reuse them.

## 1. Invariants that no extension may break

1. **States, dates and counts are computed by code** (ENF-IA-04). A model returns
   quotes, confidences, booleans and extracted fields — nothing else.
2. **A model never decides alone**: an attachment, a mapping or a draft needs
   either a verified quote or a human decision.
3. **No control is ever called compliant** (ENF-IA-01). Five states, nothing else.
4. **A draft is not evidence**: no fingerprint, no vault storage, never attached,
   never counted in a pack.
5. **A share grant never widens access**: it narrows it. Scope is one pack or one
   framework, it expires, it is revocable, and every use is journalled.
6. **Nothing in a verification result leaks content**: ids, hashes, counts,
   states, verdicts. Never a title, never a quote, never an employee name.
7. **Every write is journalled** through `record(...)` with an existing or new
   `AuditAction`. If you need a new action, add it to `AuditAction` in
   `src/domain/types.ts` — that file is owned by the pilot, ask for it in your
   report instead of editing it.

## 2. Axis 1 — verification and sharing

**Goal.** A third party checks a pack without trusting us, and an external
auditor gets a bounded, watermarked, revocable access instead of an archive by
e-mail.

Build:

- `src/pipeline/verify.ts`
  - `verifyPack(services, packId): Promise<VerificationResult>` — re-reads the
    archive from the vault, recomputes the checksums against the manifest
    (`manifestChecksumLines`), checks the root hash (`manifestIsSelfConsistent`),
    verifies the signature through `services.signer.verify()` on the canonical
    manifest bytes, checks the audit chain (`services.audit.verifyChain()`),
    records the result through `services.extensions.recordVerification()` and
    journalls it. Never throws on a failed verdict: a failed verdict is a result.
  - `verifyByToken(services, token): Promise<VerificationResult>` — resolves a
    share grant (see below) then verifies its pack.
- `src/pipeline/share.ts`
  - `createShare(services, input: { packId?, frameworkId, scope, ttlHours, by, watermarkLabel }): Promise<ShareGrant>`
    — token = 32 random bytes base64url, `expiresAt = now + ttlHours`, watermark
    built from the label and the expiry (`AUDITOR <label> · expires <date>`).
    Refuses `ttlHours > 168` (a week) and `< 1`.
  - `revokeShare(services, token, by): Promise<ShareGrant>`
  - `resolveShare(services, token, now): Promise<ShareGrant | null>` — `null`
    when unknown, revoked or expired; bumps the use counter on success.
  - `watermarked(share, text): string` — prefixes the watermark to an excerpt.
- `src/crypto/kmsSigner.ts` — `KmsSigner` on `@aws-sdk/client-kms`
  (`Sign`/`Verify`, `ECDSA_SHA_256`, `MessageType: 'RAW'`), SDK imported lazily,
  failures wrapped in `upstream(...)`. Add the ambient declarations for
  `@aws-sdk/client-kms` in `src/types/aws-sdk/kms.d.ts` and map it in
  `tsconfig.json` `paths` (both are yours).
- `scripts/verify-pack.sh` — bash, standard tools + `openssl`: takes a pack
  directory (`index.json`, `manifest.json`, `attestation.json`), recomputes the
  root hash of the manifest, checks it matches, and reports the verdict. Must
  work offline on the archive a partner downloaded.
- Tests `test/verify/**`: intact pack verifies; a tampered archive fails
  `checksumsOk`; a manifest whose root hash was edited fails
  `manifestIsSelfConsistent`; a signature from another key fails `signatureOk`;
  an expired grant resolves to `null`; a revoked grant resolves to `null`; a
  grant's watermark appears in the excerpt; a verification result contains no
  title, no quote, no e-mail (assert on the JSON string).

## 3. Axis 2 — one evidence serves every framework

**Goal.** A validated equivalence between two controls means an attachment
accepted once is *proposed* on the other framework, never applied.

Build:

- `eval/catalogue-iso.ts` + `eval/catalogue-iso/*.ts` — a **second, fictional**
  framework `demo-iso` (12 controls, 4 domains) whose text was written for this
  project (never ISO normative text). Each control declares `equivalents: string[]`
  naming the `demo-msp` controls it corresponds to. Export `ISO_CONTROLS`,
  `ISO_FRAMEWORK`, `toIsoFrameworkImport()`. Keep every file < 500 lines.
- `src/pipeline/crossmap.ts`
  - `proposeMappings(services, input: { sourceFrameworkId, targetFrameworkId, actor, limit? }): Promise<ControlMapping[]>`
    — for each source control, retrieve candidates from the target framework
    (use `services.controlRetriever` or a direct scan of the stored controls),
    ask `services.reasoner` nothing new: score by `similarity()` on requirement
    text, keep the best above a documented floor, and **verify both quotes by
    code** (`containsNormalized` on the two requirement texts). Persist as
    `PROPOSED`, never validated.
  - `decideMapping(services, mappingId, { decision: 'VALIDATE'|'REJECT', by, note? })`
    — records author/date/note, journalls.
  - `propagateAttachment(services, attachment): Promise<ControlMapping['id'][]>`
    — given an applied attachment on framework A, find validated mappings and
    create **`PROPOSED` attachments** on the mapped controls of framework B
    (never `APPLIED`), reusing the same quote. Returns nothing else.
  - `reuseMetric(services, frameworkId): Promise<ReuseMetric>` — computed from
    attachments and mappings; `avoidedDeposits` counts distinct evidence carried
    by a validated mapping; `reuseFactor` is `attachmentCount / evidenceCount`
    rounded to 2 decimals.
- Tests `test/mapping/**`: a proposed mapping that quotes a text absent from the
  control is refused; a validated mapping propagates as `PROPOSED` only; a
  rejected mapping propagates nothing; `reuseMetric` arithmetic on a hand-built
  store; the ISO catalogue has 12 controls, 4 domains, unique ids, and every
  `equivalents` entry exists in `demo-msp`.

## 4. Axis 3 — machine attestations, drift, and the pre-filled draft

**3a. Drift.**

- `src/pipeline/drift.ts`
  - `observeAttestation(services, input: { controlId, evidenceId, attestedState, actor }): Promise<DriftEvent[]>`
    — compares with the previous attestation of the same control; emits
    `STATE_CHANGED` when the attested state differs, `RECOVERED` when it returns
    to the earlier value after a change, `MISSING_RUN` when no attestation
    arrived within `cadence + grace` (call it from `runReminders`), and
    `THRESHOLD_CROSSED` when the attested state names a failed run.
  - `acknowledgeDrift(services, id, by)`.
- Collectors: `src/collectors/awsReport.ts` (and the other collectors where it
  makes sense) must produce evidence marked `provenance: 'MACHINE_ATTESTATION'`
  with an `attestedState` string; the freshness of such evidence uses
  `cadencePeriodicity()` rather than the control's periodicity. Put that rule in
  ONE exported helper (`machinePeriodicityFor(control)`) used by the state
  engine — do not fork `evaluateControl`.
- Tests: drift on a changed state, drift on a missing run, recovery, a machine
  attestation expiring after its cadence, acknowledgement keeping author and date.

**3b. Draft.**

- `src/pipeline/draft.ts`
  - `generateDraft(services, controlId, actor): Promise<Draft>` — sections come
    from `control.expectedEvidence`; for each element, look for the partner's own
    previous version (most recent applied evidence of that control, excerpt
    through `guardrail.redact`), fill it, otherwise mark `toComplete`. Renders
    with `renderDraft()`. Journalls `DRAFT_GENERATED`. **Never** writes to the
    vault, **never** creates an `Evidence`, **never** an `Attachment`.
- Tests: every expected element appears as a section; a missing element is
  `toComplete: true`; the watermark is present; `attachable === false`; the
  vault is untouched and no evidence was created.

## 5. Bonus — the system measures itself

- `src/pipeline/quality.ts`
  - `recordEvaluation(services, input: { subject, records }): Promise<QualityRecord[]>`
  - `qualityTrend(services, filter?): Promise<QualityTrendPoint[]>`
  - `attachmentThreshold(services): Promise<number>` — wraps
    `effectiveConfidenceThreshold(services.settings.confidenceThreshold, await services.extensions.listQuality())`.
    `src/pipeline/attach.ts` must use it instead of reading the setting directly
    (that file is yours in this axis).
- `src/ai/versioning.ts` — `PROMPT_VERSION` constant **per prompt family**
  (reading, attachment, sufficiency, answer), exported; the reasoner stamps
  `promptVersion` on every proposal it returns (that means touching
  `src/ai/mock/scriptedReasoner.ts` and `src/ai/bedrock/structuredReasoner.ts`,
  which are yours for this axis only, minimally).
- `tools/eval/runAndRecord.ts` — runs the local scorer on the four datasets,
  converts the six metrics into `QualityRecord`s and stores them through
  `recordEvaluation`. `--check` exits non-zero when a metric is below target.
- Tests: a failing measurement forces the threshold above 1 (everything to human)
  and a passing one restores it; the trend is ordered; `promptVersion` appears on
  proposals.

## 6. Reporting

Every agent reports: files created/modified with sizes, exact exported
signatures, results of `npm run typecheck | grep <your paths>`, `node --test`
on your own tests, `npm run check:sizes`, `npm run check:wording`, and anything
you had to leave open. Never modify another agent's paths; never run git.
