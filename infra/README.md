# Registre — infrastructure (AWS CDK, TypeScript)

Nine stacks, one account, one **European** region. Everything the product needs
is created from code: this directory is the whole installation procedure
(ENF-REP-01). Acceptance test **R16 — installation in a fresh account — is the
checklist below, in order.**

```
infra/
├── bin/registre.ts            CDK app: builds and wires the nine stacks
├── cdk.json                   app entry (`npx tsx bin/registre.ts`) + feature flags
├── lib/
│   ├── config.ts              shared parameters, EU region guard, handler map
│   ├── handlers.ts            NodejsFunction factory (+ 501 stub while src/ is incomplete)
│   ├── vault-stack.ts         S3 versioned + Object Lock (strict mode) + KMS
│   ├── data-stack.ts          one DynamoDB table (PK/SK, 2 GSIs, PITR, KMS)
│   ├── bedrock-stack.ts       2 managed knowledge bases, guardrail, Data Automation
│   ├── pipeline-stack.ts      Step Functions chain + 7 Lambdas + EventBridge trigger
│   ├── api-stack.ts           HTTP API + Cognito + the 16 endpoints
│   ├── portal-stack.ts        S3 + CloudFront (OAC)
│   ├── notify-stack.ts        SES identity + daily reminders + weekly digest
│   ├── collectors-stack.ts    EventBridge Scheduler + 3 collectors + DLQ
│   └── observability-stack.ts alarms per function, dashboard, AWS Budgets
└── scripts/create-demo-users.sh   five judge accounts in Cognito (EF-ADM-03)
```

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | ≥ 22.18 (native TypeScript) | `node --version` |
| AWS CLI v2 | any recent | `aws --version` |
| AWS credentials | profile allowed to create IAM roles, S3, DynamoDB, Lambda, Step Functions, API Gateway, Cognito, CloudFront, SES, Bedrock, Budgets | `aws sts get-caller-identity` |
| Bedrock model access | the reasoning, answer and embedding models enabled in the target region (console → Bedrock → Model access) | — |

## 2. Configure the target account and region

```bash
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
export CDK_DEFAULT_REGION=eu-central-1        # see §3: Data Automation needs eu-central-1 or eu-west-1
```

Optional overrides (all read by `lib/config.ts`):

| Variable | Default | Effect |
|---|---|---|
| `REGISTRE_REGION` | `eu-west-3` | Deployment region. **Refused** if outside the EU (ENF-DATA-01). |
| `REGISTRE_RETENTION_MONTHS` | `24` | Object Lock retention, in months (audit cycle + 1 year). |
| `REGISTRE_CONFIDENCE_THRESHOLD` | `0.85` | Attachments at or above it are applied without review. |
| `REGISTRE_REMINDER_LEAD_DAYS` | `30` | Reminder lead time before expiry. |
| `REGISTRE_BUDGET_USD` | `80` | Monthly AWS Budgets limit. |
| `REGISTRE_ALERT_EMAIL` | `quality-lead@example.com` | Alarm and budget subscriber. |
| `REGISTRE_MAIL_DOMAIN` | `example.com` | SES domain identity for reminders. |
| `REGISTRE_SOURCE_BUCKET` | `registre-source-documents` | Partner document bucket read by the S3 collector. |
| `REGISTRE_DATA_AUTOMATION` | `on` | `off` drops the Data Automation project (multimodal fallback). |
| `REGISTRE_REASONING_MODEL` / `REGISTRE_ANSWER_MODEL` | EU inference profiles | Model ids used by the pipeline and the ask endpoint. |

## 3. Region choice (read this before deploying)

ENF-DATA-01 allows only the EU, and `lib/config.ts` throws on anything else.
Within the EU, availability differs:

| Region | `AWS::Bedrock::DataAutomationProject` | Note |
|---|---|---|
| `eu-central-1` (Frankfurt) | yes | **recommended default** |
| `eu-west-1` (Ireland) | yes | — |
| `eu-west-3` (Paris) | no | synth emits a warning; reading falls back to a multimodal model |
| `eu-north-1`, `eu-south-1` | no | also lacks `AWS::Budgets::Budget` |

Verified with `cd infra && REGISTRE_REGION=<r> npx cdk synth` against the
CloudFormation resource specification bundled with `aws-cdk-lib` 2.276. Re-verify
before a real deployment: this is item 4 of the specification's open questions.

## 4. Install, type-check, synthesize

```bash
cd infra
npm install          # separate package; the repository root is untouched
npm run typecheck    # tsc --noEmit
npm run synth        # cdk synth, offline, no AWS call
npm run diff         # cdk diff against the deployed stacks
```

`npm run synth` must succeed **without credentials**: the account falls back to
the placeholder `111111111111` and every handler that does not exist yet is
replaced by a Lambda returning `501 Not Implemented` (see §7).

## 5. Deploy

```bash
cd infra
npm run deploy       # cdk deploy --all --require-approval never
```

Stack order (the CDK CLI resolves it from cross-stack references):

1. `Registre-Vault` — bucket, Object Lock, KMS key
2. `Registre-Data` — DynamoDB table and GSIs
3. `Registre-Bedrock` — knowledge bases, guardrail, Data Automation project
4. `Registre-Pipeline` — state machine and the seven task Lambdas
5. `Registre-Api` — HTTP API, Cognito user pool and groups
6. `Registre-Portal` — CloudFront distribution
7. `Registre-Notify` — SES identity, reminder schedules
8. `Registre-Collectors` — schedules, collectors, dead-letter queue
9. `Registre-Observability` — alarms, dashboard, budget

## 6. Three one-time manual steps

1. **Confirm the SNS subscription** sent to `REGISTRE_ALERT_EMAIL`, otherwise no
   alarm reaches a human.
2. **Verify the SES identity**: publish the DKIM records of
   `REGISTRE_MAIL_DOMAIN`. While the account is in the SES sandbox, every
   recipient address must also be verified.
3. **Create the five demo accounts** for the judges:

```bash
./scripts/create-demo-users.sh
```

It prints one login and one generated password per role (`QUALITY_LEAD`,
`CONTROL_OWNER`, `EXECUTIVE`, `INTERNAL_AUDITOR`, `ADMIN`). Passwords are never
written to the repository or to a CloudFormation template; paste the output into
the Devpost testing instructions.

## 7. Handlers and the 501 stub

`lib/handlers.ts` maps a logical step to a file under `src/`:

| Step | File |
|---|---|
| `api` | `src/api/lambda.ts` |
| `ingest`, `read`, `candidates`, `attach`, `sufficiency`, `states`, `index` | `src/pipeline/<step>.ts` |
| `reminders` | `src/pipeline/reminders.ts` |
| `collectS3`, `collectItsm`, `collectAwsReport` | `src/collectors/{s3,itsm,awsReport}.ts` |

If a file does not exist, or does not export `handler`, the stack deploys a stub
that answers `501 {"error":"HANDLER_NOT_IMPLEMENTED"}` and `cdk synth` prints a
warning naming the file. That is what lets the infrastructure be built and
reviewed independently of the application workstream — and it is visible in the
synth output, so it cannot be forgotten.

**Why `NodejsFunction`** (esbuild) and not `lambda.Function` with a hand-rolled
bundle: the repository ships TypeScript with `.ts` import specifiers and no build
step (CONTRACTS.md §1). esbuild resolves and strips types at package time, emits
one self-contained ESM artefact per handler, and reuses the root lock file. The
AWS SDK v3 is left external (it is in the Lambda Node 22 runtime), everything
else is bundled.

## 8. What each stack creates

| Stack | Main resources |
|---|---|
| Vault | 1 KMS key (rotation on), 1 S3 bucket (versioned, Object Lock strict mode, SSE-KMS, public access blocked, TLS enforced, Glacier IR after 90 days) |
| Data | 1 DynamoDB table (on-demand, KMS, PITR, deletion protection), GSIs `gsi1` and `gsi2` |
| Bedrock | 2 managed knowledge bases, 2 S3 data sources, 1 guardrail (PII anonymisation + contextual grounding) and its version, 1 Data Automation project, 2 IAM roles |
| Pipeline | 1 Step Functions state machine (7 Lambda tasks, retries, log group), 7 Lambdas, 1 EventBridge rule on `evidence/` |
| Api | 1 HTTP API (16 endpoints, JWT authorizer), 1 Cognito pool + 5 groups + 1 SPA client, 1 Lambda |
| Portal | 1 private S3 bucket, 1 CloudFront distribution with OAC and SPA fallback |
| Notify | 1 SES domain identity, 2 EventBridge Scheduler schedules, 1 Lambda |
| Collectors | 3 Lambdas, 3 schedules, 1 SQS dead-letter queue |
| Observability | 2 alarms per Lambda, 1 pipeline-failure alarm, 1 DLQ alarm, 1 dashboard, 1 budget with 2 e-mail notifications |

## 9. Tear-down

```bash
cd infra
npx cdk destroy --all
```

The vault bucket, its KMS key and the DynamoDB table are `RETAIN`: destroy
removes the stacks but keeps the data, because Object Lock in strict mode forbids
deleting a locked object before the retention date — by design (ENF-INT-01).
Deleting the data early is an explicit, documented act by the account owner, not
a side effect of a destroy command.

## 10. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ENF-DATA-01: REGISTRE_REGION=... is outside the EU` | explicit non-EU region | pick an EU region |
| `WARNING Region ... has no AWS::Bedrock::DataAutomationProject` | Paris/Stockholm/Milan | deploy in `eu-central-1` or `eu-west-1`, or set `REGISTRE_DATA_AUTOMATION=off` |
| `Handler src/... (export "handler") is missing` | application code not written yet | expected during parallel development; the stub answers 501 |
| `portal/dist is absent` | portal not built | `cd portal && npm install && npm run build`, then redeploy |
| Model invocation fails with `AccessDeniedException` | model access not granted | console → Bedrock → Model access → request the models of §1 |
