# Operations

How the product is run, watched and paid for. The installation procedure is
`infra/README.md`; this document is about the life after deployment.

## 1. Daily rhythm

| When | What runs | Where |
|---|---|---|
| 01:00 Europe/Paris | S3 collector: new documents from the partner bucket | `Registre-Collectors` |
| 02:00 | ITSM collector: incidents, changes, problems for the period | `Registre-Collectors` |
| 03:00 on the 1st | AWS state report (e.g. backup coverage) | `Registre-Collectors` |
| On every upload or collection | Pipeline: fingerprint → dedupe → read → candidates → attach → sufficiency → states → index | `Registre-Pipeline` |
| 06:00 daily | Expiry reminders and no-evidence reminders | `Registre-Notify` |
| 07:00 Monday | Weekly readiness digest to the quality lead | `Registre-Notify` |
| On demand | Ask, validation decisions, pack assembly | `Registre-Api` |

Nothing in this table is a person's job. The human job is the validation queue:
usually a handful of items a week.

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

### What to do when an alarm fires

| Alarm | First check | Usual cause |
|---|---|---|
| `errors-<collector>` | CloudWatch log of the function, then the source credential | Expired token, renamed source object, schema change in the export |
| `errors-read` / `pipeline-failures` | Step Functions execution history: which step failed | Unsupported file, Data Automation quota, model access revoked |
| `errors-api` | API Gateway 5xx and the function log | DynamoDB throttling, expired guardrail version, token misconfiguration |
| `collector-dlq` | The DLQ message body | Same as the collector case; the message can be redriven after a fix |
| Budget alert | AWS Cost Explorer, filtered by the `project: registre` tag | A backfill loop, or a model left on the standard tier for batch work |

## 3. Cost model

| Item | Driver | Nature |
|---|---|---|
| Reading | Data Automation, per page or per document | Dominant variable cost |
| Attachment and sufficiency | Model tokens in and out | Second variable cost; cut by the Flex tier and prompt caching |
| Knowledge bases | Storage and retrieval queries | Small but constant |
| Questions | Model tokens per question | Negligible at human rate |
| Base | S3, Lambda, Step Functions, DynamoDB, CloudFront, Cognito | A few dollars a month |

Expected order of magnitude for a real partner (150 controls, ~100 new evidences
a month): **a few tens of dollars per month**. For the hackathon period (60
evidences, repeated full runs, evaluation jobs): **30–80 USD**, which the 200 USD
of credits covers until 31 December 2026; in January the base stays online for a
few dollars.

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
| Rotate the demo passwords | `aws cognito-idp admin-set-user-password … --permanent` | Before each public sharing |
| Re-run the evaluation after a prompt or model change | `node tools/eval/bedrockEval.ts --submit` then compare metrics | Every change |
| Review cost per evidence | Portal cost panel, or Cost Explorer by `project` tag | Monthly |
| Verify the audit chain | `GET /v1/audit-log?verify=chain` | Monthly, and before a pack |
| Rehearse a restore of the state | DynamoDB PITR restore into a scratch table | Quarterly |

## 7. Failure modes and recovery

| Failure | Effect | Recovery |
|---|---|---|
| Data Automation unavailable in the region | Reading fails | Deploy in `eu-central-1` / `eu-west-1`, or set `REGISTRE_DATA_AUTOMATION=off` and use the multimodal fallback reader |
| Model access revoked | Attachment and sufficiency fail, alarms fire | Re-enable model access in the console; failed executions are retried from the vault |
| Knowledge base ingestion lagging | Candidates are stale for a few minutes | Harmless: retrieval still returns controls; the index catches up |
| DynamoDB throttling | API 5xx, alarms | On-demand capacity absorbs bursts; check for a runaway loop in the audit log |
| Collector credential expired | No new evidence, DLQ alarm | Fix the secret, redrive the DLQ message |
| Operator deletes the vault | Impossible before retention | Object Lock strict mode; bucket and key are `RETAIN` on stack destroy |
| Audit chain broken | `verifyChain()` returns `brokenAt` | Investigate the sequence; this is the signal the log was tampered with |

## 8. Post-hackathon operation

Keep the base online with minimal traffic (a few dollars a month), keep the
budget alert armed, and stop the collectors if no data should be refreshed. The
portal stays reachable with the five demo accounts so the solution can still be
judged until 22 January 2027.
