# Operations

How the product is run, watched and paid for. The installation procedure is
`infra/README.md`; this document is about the life after deployment. The
extensions (signing, shares, drift, measured quality) have their own routines
in §7.

## 1. Daily rhythm

| When | What runs | Where |
|---|---|---|
| 01:00 Europe/Paris | S3 collector: new documents from the partner bucket | `Registre-Collectors` |
| 02:00 | ITSM collector: incidents, changes, problems for the period | `Registre-Collectors` |
| 03:00 on the 1st | AWS state report (e.g. backup coverage) | `Registre-Collectors` |
| Nightly | Machine attestations refreshed by the collectors; on arrival, drift detection compares each attested state with the previous one (`observeAttestation` via the ingest path, `src/pipeline/drift.ts`, cadence in §7.5) | `Registre-Collectors`, `Registre-Pipeline` |
| On every upload or collection | Pipeline: fingerprint → dedupe → read → candidates → attach → sufficiency → states → index | `Registre-Pipeline` |
| 06:00 daily | Expiry reminders and no-evidence reminders | `Registre-Notify` |
| 07:00 Monday | Weekly readiness digest to the quality lead | `Registre-Notify` |
| On demand | Ask, validation decisions, pack assembly (manifest signed at freeze), verification, share grants, drift summary — including attestation runs missing past cadence plus grace (`missingRuns`) | `Registre-Api` |
| After every prompt or model change | Evaluation recorded: `node tools/eval/runAndRecord.ts --check` (§7.6) | local or CI |

Nothing in this table is a person's job. The human job is the validation queue:
usually a handful of items a week — more while a measured metric fails, which is
deliberate (§7.6).

## 2. Supervision (ENF-OBS-01)

"Supervise every collection and every read" is implemented literally: the
observability stack is built **from the list of functions**, so a new handler
cannot be added without appearing in the alarms and the dashboard.

| Alarm | Metric | Threshold | Meaning |
|---|---|---|---|
| `errors-<fn>` (one per function) | `Errors`, 5 min sum | ≥ 1 | A collection, a read, an API call or a reminder failed |
| `throttles-<fn>` (one per function) | `Throttles`, 5 min sum | ≥ 5 twice | The pipeline is falling behind |
| `pipeline-failures` | `ExecutionsFailed`, 5 min sum | ≥ 1 | An evidence was not processed |
| `collector-dlq` | DLQ visible messages | ≥ 1 | A scheduled collector failed after every retry — it must never look like "no new evidence" |
| Budget alert | Actual 80 %, forecast 100 % | — | Spend is running away |

Every alarm publishes to one SNS topic subscribed to `REGISTRE_ALERT_EMAIL`;
confirm the subscription once, otherwise nobody hears anything.

The dashboard `registre-operations` shows invocations, errors and p95 duration
for every function side by side, which is enough to answer the two questions
that actually come up: "is it running?" and "is it slower than yesterday?".

Two domain signals complete the technical alarms, in the portal rather than in
CloudWatch: unacknowledged **drift events** (a machine attestation changed,
missed a run or crossed a threshold — §7.5) and the **quality report** with the
threshold in force (§7.6). A silent collector that never errors still shows up
as `MISSING_RUN`.

### What to do when an alarm fires

| Alarm | First check | Usual cause |
|---|---|---|
| `errors-<collector>` | CloudWatch log of the function, then the source credential | Expired token, renamed source object, schema change in the export |
| `errors-read` / `pipeline-failures` | Step Functions execution history: which step failed | Unsupported file, Data Automation quota, model access revoked |
| `errors-api` | API Gateway 5xx and the function log | DynamoDB throttling, expired guardrail version, token misconfiguration, KMS signing key unreachable |
| `collector-dlq` | The DLQ message body | Same as the collector case; the message can be redriven after a fix |
| Budget alert | AWS Cost Explorer, filtered by the `project: registre` tag | A backfill loop, or a model left on the standard tier for batch work |

## 3. Cost model

| Item | Driver | Nature |
|---|---|---|
| Reading | Data Automation, per page or per document | Dominant variable cost |
| Attachment and sufficiency | Model tokens in and out | Second variable cost; cut by the Flex tier and prompt caching |
| Knowledge bases | Storage and retrieval queries | Small but constant |
| Questions | Model tokens per question | Negligible at human rate |
| Pack signing and verification | One asymmetric KMS key (`ECC_NIST_P256`, `SIGN_VERIFY`) plus a few sign/verify operations per pack | A few cents a month |
| Base | S3, Lambda, Step Functions, DynamoDB, CloudFront, Cognito | A few dollars a month |

Expected order of magnitude for a real partner (150 controls, ~100 new evidences
a month): **a few tens of dollars per month**. For the hackathon period (60
evidences, repeated full runs, evaluation jobs): **30–80 USD**, which the 200 USD
of credits covers until 31 December 2026; in January the base stays online for a
few dollars. The extensions change nothing to that order of magnitude: the added
cost is the signing key of §7.1 — a few cents a month — and the evaluation runs
of §7.6, which cost the same tokens as the evaluations that already ran before,
now recorded instead of discarded.

The cost per evidence is recorded on each evidence (`CostRecord`) and aggregated
into the portal's cost report (`CostReport`: total, per evidence, by source), so
the claim "cost per evidence measured and displayed" (ENF-COUT-01) is a number on
a screen, not a promise.

**Budget**: `Registre-Observability` creates a monthly budget at
`REGISTRE_BUDGET_USD` (default 80 USD) with two e-mail notifications: actual
spend above 80 %, forecast above 100 %. Set it on day one, before the first
backfill.

## 4. Service tiers

| Workload | Tier | Why |
|---|---|---|
| Nightly collectors, backfill of existing documents, weekly digest | **Flex** | Tolerates latency, costs a fraction |
| Portal upload, ask, pack assembly | Standard | A judge or a quality lead is waiting |
| Evaluation jobs | Standard | Run rarely, must finish predictably |

The setting is exposed as `nightlyServiceTier` in `Settings` and defaults to
`FLEX`; the adapters read it per call rather than hard-coding it.

## 5. Backfill: 1,000 documents in one night (ENF-PERF-01)

The requirement is "read and attach one evidence in under two minutes; backfill
1,000 existing documents in one night".

- One evidence takes seconds, not minutes: the pipeline is asynchronous, the
  read step is bounded at 15 minutes for a pathological document, and the
  attachment step at 5.
- 1,000 documents are processed as a queue, not as a loop: the vault fires one
  EventBridge event per object, Step Functions runs the executions concurrently
  (standard workflow, default quota of 1,000 concurrent executions is enough),
  and the nightly work runs on the Flex tier with prompt caching.
- Realistic budget: at ~30 s per evidence end to end and a concurrency of 50, the
  backfill finishes in about 10 minutes of wall time; the binding constraint is
  the Data Automation throughput quota, which is why the procedure below exists.

**Backfill procedure**

```bash
# 1. Copy the corpus into the vault under evidence/ (versioned, locked).
aws s3 cp ./corpus "s3://$(aws cloudformation describe-stacks --stack-name Registre-Vault \
  --query "Stacks[0].Outputs[?OutputKey=='VaultBucketName'].OutputValue" --output text)/evidence/" \
  --recursive --exclude "*" --include "*.pdf"

# 2. Watch the queue: executions in flight and failures.
aws stepfunctions list-executions --state-machine-arn "$PIPELINE_ARN" --status RUNNING \
  --query "length(executions)"

# 3. When it drains, read the outcome from the portal (readiness) and from the
#    validation queue: uncertain attachments are waiting there, not silently applied.
```

Interrupting a backfill is safe: the vault is the queue, and re-copying the same
bytes is a no-op thanks to the fingerprint (a duplicate produces no second model
call, R8).

## 6. Routine operations

| Task | How | Frequency |
|---|---|---|
| Review the validation queue | Portal, "Validation" screen | Weekly, a few minutes |
| Check readiness and trend | Portal, "Readiness" screen | Weekly |
| Acknowledge or close reminders | Portal, "Reminders" screen | As they arrive |
| Acknowledge drift events | Portal drift list (§7.5) | As they arrive — a drift that stays unacknowledged is a state nobody owns |
| Review share grants and revoke the finished ones | Portal shares list (§7.4); expiry also revokes automatically | Per audit mission |
| Verify a pack before handing it over | Verification route or `scripts/verify-pack.sh` (§7.3) | Before every transmission |
| Review the quality report and the threshold in force | Portal quality screen (§7.6) | Weekly, and after every prompt or model change |
| Rotate the demo passwords | `aws cognito-idp admin-set-user-password … --permanent` | Before each public sharing |
| Re-run the evaluation after a prompt or model change | `node tools/eval/runAndRecord.ts --check` (§7.6), and `node tools/eval/bedrockEval.ts --submit` for the Bedrock tasks | Every change |
| Review cost per evidence | Portal cost panel, or Cost Explorer by `project` tag | Monthly |
| Verify the audit chain | `GET /v1/audit-log?verify=chain` | Monthly, and before a pack |
| Rehearse a restore of the state | DynamoDB PITR restore into a scratch table | Quarterly |

## 7. Extensions in operation

### 7.1 The pack-signing key (AWS)

`Registre-Vault` creates a **second** customer-managed key, distinct from the
encryption key: asymmetric `ECC_NIST_P256`, usage `SIGN_VERIFY`, alias
`alias/registre-pack-signing` (`resourceName(config, 'pack-signing')`,
`infra/lib/vault-stack.ts`). It signs the canonical manifest of every frozen
pack; it cannot encrypt or decrypt anything.

- **Never enable rotation on this key.** A rotated key orphans the signatures of
  already-frozen packs — the reason is recorded once, in ADR-16
  (`docs/DECISIONS.md`). The key is `RETAIN` on stack destroy, like the vault.
- The API Lambda is wired by `infra/lib/api-stack.ts`: `REGISTRE_SIGNER=kms` and
  `REGISTRE_SIGNING_KEY_ARN=<signing key ARN>`; the granted actions are
  `kms:Sign` and `kms:GetPublicKey`, nothing else.
- Signing happens once per `assemblePack`; verification happens per
  `verifyPack` / `verifyByToken` (`src/pipeline/verify.ts`). KMS failures are
  wrapped as upstream errors (`src/crypto/kmsSigner.ts`) — a KMS outage fails
  the pack assembly loudly, it never produces an unsigned pack that looks
  signed.

### 7.2 Local and offline signing

`signerFromEnv()` (`src/crypto/localSigner.ts`) selects the signer from
`REGISTRE_SIGNER`:

| Value | Behaviour |
|---|---|
| `local` (default) | Ed25519 key from `REGISTRE_SIGNING_KEY` (base64 of a 32-byte seed) or `REGISTRE_SIGNING_KEY_FILE` (path to a file holding that base64). Stable across runs: a signature made today still verifies tomorrow. |
| `local` with neither variable | An ephemeral key is generated; its key id says `ephemeral-unverifiable-after-process-exit`. Honest, visible, never silent. |
| `kms` | The KMS signer of §7.1. |
| `none` | `NullSigner`: no signature is stored and verification reports `signatureOk: null`. |

The seed is a secret: keep it out of the repository and out of logs (the module
never prints it). Losing it does not corrupt anything — packs signed under it
simply stop verifying with the local signer, which is what `keyId` in the
signature is for.

### 7.3 Verifying a downloaded pack offline

A partner or a reviewer who holds an archive checks it without our API, without
an account and without network — bash and `openssl` only:

```bash
scripts/verify-pack.sh <pack-directory>
# the directory holds index.json, manifest.json, attestation.json
```

The script recomputes the manifest root hash and compares it with the recorded
one, and reports the verdict; the online verification additionally recomputes
every file checksum, the signature and the audit chain (`src/pipeline/verify.ts`).
Public key of a local signer, for an independent signature check:
`publicKeyBase64()` (`src/crypto/localSigner.ts`).

### 7.4 Share tokens: lifetime and revocation

- **Create** with a scope (`PACK` or `FRAMEWORK`), a TTL between **1 and 168
  hours** — anything outside is refused — and a watermark label; the watermark
  stamped on excerpts names the auditor and the expiry (`src/pipeline/share.ts`).
- **Every use is journalled**: `SHARE_USED` audit event, `useCount` and
  `lastUsedAt` on the grant (`ExtensionStore.touchShare`). Creation and
  revocation are `SHARE_CREATED` / `SHARE_REVOKED`.
- **Revoke** as soon as the audit mission ends; expiry alone is sufficient but
  revocation is immediate. An expired or revoked token resolves to `null` —
  refusal, no detail.
- Route names, methods and payloads: `docs/API.md` (single source).

### 7.5 Watching drift

Machine attestations refresh nightly (§1); the expected cadence is
`DEFAULT_REFRESH_POLICY` — 24 h between runs, 6 h of grace
(`src/domain/quality.ts`). What to watch, in the portal drift list:

| Drift | Meaning | Usual follow-up |
|---|---|---|
| `STATE_CHANGED` | The attested state differs from the previous one | Check the source system; the control state already moved |
| `MISSING_RUN` | No attestation arrived within cadence + grace — reported when the drift summary runs (`missingRuns`, `src/pipeline/drift.ts`) | Collector or credential problem — same checks as `errors-<collector>` |
| `THRESHOLD_CROSSED` | The attested state names a failed run (e.g. a failed backup job) | Treat as an incident on the monitored system |
| `RECOVERED` | The state returned to its earlier value after a change | Acknowledge; the control recovers with it |

Acknowledging records author and date (`DRIFT_ACKNOWLEDGED`); an acknowledgement
is a decision trail, not a mute button — the next drift fires anyway.

### 7.6 Watching measured quality

After every prompt or model change (and on the fixture run in CI):

```bash
node tools/eval/runAndRecord.ts --check     # scores, records, exits 1 below target
node tools/eval/runAndRecord.ts --out /tmp/quality.json --json
```

The runner scores the four datasets with the existing scorer, converts the six
metrics into `QualityRecord`s (`tools/eval/lib/qualityRecords.ts`), persists
them through `recordEvaluation` (`src/pipeline/quality.ts`, journalled
`QUALITY_RECORDED`) and writes `eval/results/quality-records.json`. Exit codes:
0 recorded, 1 with `--check` when a metric is below target, 2 on usage or I/O
error.

What the numbers drive: the quality screen shows the trend per subject
`(kind, model, promptVersion)` and the **threshold in force**. A threshold of
**1.01** means the latest attachment-acceptance measurement failed: nothing is
auto-applied anywhere and the validation queue absorbs every proposal until a
passing measurement restores the configured setting (`effectiveConfidenceThreshold`,
`src/domain/quality.ts`; ADR-19). Operator response to a 1.01: do not raise the
configured setting — re-run the evaluation after fixing the prompt or the model,
and let the passing measurement restore the flow.

## 8. Failure modes and recovery

| Failure | Effect | Recovery |
|---|---|---|
| Data Automation unavailable in the region | Reading fails | Deploy in `eu-central-1` / `eu-west-1`, or set `REGISTRE_DATA_AUTOMATION=off` and use the multimodal fallback reader |
| Model access revoked | Attachment and sufficiency fail, alarms fire | Re-enable model access in the console; failed executions are retried from the vault |
| Knowledge base ingestion lagging | Candidates are stale for a few minutes | Harmless: retrieval still returns controls; the index catches up |
| DynamoDB throttling | API 5xx, alarms | On-demand capacity absorbs bursts; check for a runaway loop in the audit log |
| Collector credential expired | No new evidence, DLQ alarm | Fix the secret, redrive the DLQ message |
| Operator deletes the vault | Impossible before retention | Object Lock strict mode; bucket and key are `RETAIN` on stack destroy |
| Audit chain broken | `verifyChain()` returns `brokenAt` | Investigate the sequence; this is the signal the log was tampered with |
| KMS signing key unreachable | Pack assembly fails loudly (upstream error); existing packs still verify offline | Check the key state and the Lambda grant (`kms:Sign`); never fall back to `none` silently |
| Pack archive tampered after download | Offline check fails: checksums or root hash mismatch | The verdict is the product working: re-download from the vault, compare `rootHash` with the signed attestation |
| Share token leaked | Access bounded by scope and remaining TTL | Revoke immediately; the watermark and the `SHARE_USED` journal say what was served |
| A metric fails its target | Threshold in force becomes 1.01; validation queue grows | Expected behaviour (ADR-19): fix the prompt or model, re-run `runAndRecord.ts --check` |
| An attestation never arrives | `MISSING_RUN` drift moves the control | Same checks as a collector alarm (§2) |

## 9. Post-hackathon operation

Keep the base online with minimal traffic (a few dollars a month), keep the
budget alert armed, and stop the collectors if no data should be refreshed. The
portal stays reachable with the five demo accounts so the solution can still be
judged until 22 January 2027. Do not delete the signing key even when the stacks
come down: frozen packs handed to judges must stay verifiable (ADR-16).

## 10. Deployed instance (verified 2026-11-11)

Re-verify at any time with a read-only pass — it changes nothing and costs
nothing: `infra/scripts/inventory.sh` (after `aws login`).

| Item | Value |
| --- | --- |
| Account / region | `710332178565` / `eu-central-1` (ENF-DATA-01) |
| Stacks | `Registre-Vault`, `-Data`, `-Bedrock`, `-Pipeline`, `-Api`, `-Notify`, `-Collectors`, `-Portal`, `-Observability` (+ `CDKToolkit`) — all `CREATE_COMPLETE` / `UPDATE_COMPLETE` |
| Portal (public URL) | <https://d1sby9k7th0w82.cloudfront.net> |
| API | <https://p5ajalv02c.execute-api.eu-central-1.amazonaws.com> — `/healthz` answers 200 |
| Cognito | pool `eu-central-1_elpexf2Ic` (`registre-users`), client `1be7q8l4sirk2pj9lb5q23bej5`; the five demonstration identities are created by `infra/scripts/create-demo-users.sh`, passwords never stored in the repository |
| Knowledge bases | `ASI1L4FGCM` (`registre-kb-evidence`), `M8MDQICTO7` (`registre-kb-frameworks`) — `MANAGED` type, managed embedding, so no OpenSearch Serverless cluster bills while idle |
| Data Automation | project `registre-reader` (`745a9aad9e7a`), `LIVE`, asynchronous |
| Guardrail | `qs59z6uqhmpw` (`registre-guardrail`) |
| Vault | `registre-vault-710332178565` — **empty**: no corpus ingested yet, so no Data Automation or model call has been billed |
| Budget | `registre-monthly`, 80 USD per month, actual spend 0.00 USD |

**What bills while nothing runs.** No EC2, no NAT gateway, no OpenSearch
Serverless, no provisioned concurrency: the only fixed line is the two
customer-managed KMS keys (vault encryption and pack signing, ~1 USD each per
month) plus CloudFront/API Gateway/Lambda usage, which is free-tier sized for a
judged demo. Everything else is per use: a document read by Data Automation, a
model call, an e-mail.

**Known gap.** The SES identity is the placeholder domain `example.com`
(`VerifiedForSendingStatus: None`), so reminder e-mails cannot actually leave the
account until a real verified identity and, in sandbox, verified recipients are
added. Notifications are therefore exercised through the in-memory notifier, and
this is stated as such wherever the demo shows a reminder.
