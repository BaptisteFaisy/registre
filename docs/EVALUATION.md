# Evaluation

Quality is measured, not asserted. Four datasets, four targets, one local scorer
that fails CI when a target is missed, and two Bedrock evaluation tasks that
replay the two most fragile measures on every prompt or model change.

## 1. The four measures

| Measure | Dataset | Rows | Target | What fails the build |
|---|---|---|---|---|
| Reading | `eval/datasets/reading.jsonl` | 60 evidences, expected fields hand-written | > 90 % of scored fields correct | `readingAccuracy ≤ 0.90` |
| Attachment | `eval/datasets/attachment.jsonl` | 60 evidences, expected controls | > 85 % accepted without correction, **and** no wrong link above the confidence threshold | `attachmentAcceptance ≤ 0.85`, or one high-confidence false link |
| Sufficiency | `eval/datasets/sufficiency.jsonl` | 20 deliberately incomplete evidences | Every expected gap detected | one undetected gap |
| Questions | `eval/datasets/qa.jsonl` | 25 questions (20 answerable, 5 traps) | > 90 % correct citations, and no invented answer on the five traps | `citationAccuracy ≤ 0.90`, or one trap answered with a document |

Targets live in `tools/eval/lib/scoring.ts` (`TARGETS`), so a change to a target
is a visible code change, not a tweak to a document.

```bash
npm run eval:local                       # score eval/results/latest.json
node tools/eval/score.ts --results x.json --json    # machine-readable
node tools/eval/score.ts --threshold 0.85           # confidence cut used for "high confidence"
```

The scorer exits non-zero as soon as one target is missed, which is why it can
sit in CI next to the tests.

## 2. Reading — 60 evidences

Fourteen fields are compared per evidence (`SCORED_FIELDS` in
`tools/eval/lib/scoring.ts`): the eleven value-carrying fields of Annex B
(type, title, document date, period start, period end, version, author,
approver, approval date, client, personal-data flag) plus the derived access
level and the two reading flags that matter to a human (`unreadable`,
`dateToConfirm`).

Normalisation before comparison: dates to `YYYY-MM-DD`, text trimmed,
case-folded and accent-folded, empty string equals `null`. A field the reader
leaves empty when a value was expected counts as wrong; a field the reader
invents when nothing was expected also counts as wrong.

The dataset deliberately includes the hard cases: a scanned procedure with no
extractable text (must be flagged `unreadable`, not guessed), a screenshot whose
printed date differs from the file date (must be flagged `dateToConfirm`), a
spreadsheet where the covered period must be derived from the row dates, and an
unsigned procedure (approver empty, not invented).

## 3. Attachment — 60 evidences

Two numbers, both required:

- **Acceptance rate** — proposed links a quality lead accepts without correction.
  Target above 85 %. This is the metric that maps to the Track 1 efficiency
  claim: every correction is human time.
- **High-confidence precision** — no evidence attached to the wrong control with
  a confidence above the threshold (0.85). Target: zero. A single occurrence
  fails the build. This is the metric that protects the product's credibility:
  an auto-applied wrong link is worse than ten proposals in a queue.

The dataset encodes the seeded situations as expected outcomes, not as
exceptions: the misfiled access review must attach to the security control
(R9), the duplicate must produce one attachment and not two (R8), the unrelated
document must produce no attachment at all (R10), and a quote that does not
exist in the document must cancel the link (R4).

## 4. Sufficiency — 20 incomplete evidences

Twenty evidences, each missing at least one expected element of its control. For
each, the expected `missing` list is known. The measure is binary per evidence:
every expected gap detected. A missed gap is the failure mode that would let a
partial evidence look complete — so it is treated as a hard failure, not a
percentage.

The class (`COMPLETE` / `PARTIAL` / `TO_VERIFY`) and the `missing` list are
computed by code from the model's element-by-element answer, so this measure
also tests the domain layer, not only the prompt.

## 5. Questions — 25 questions

Twenty answerable questions, each with the evidence that must be cited; five
trap questions about subjects the corpus does not cover (for example a recovery
objective never stated, a penetration test never performed).

Scoring: a citation is correct when the cited evidence id is in the expected
set **and** the quoted passage is found in that document. The five traps must
receive the refusal sentence; any answer naming a document is a failure, even a
plausible one. The threshold for "the answer is anchored" is the guardrail's
grounding filter plus the code-side citation check — both must pass.

## 6. Bedrock evaluation tasks

Two tasks, prepared by `tools/eval/bedrockEval.ts`, which writes every payload to
`eval/bedrock/` so it can be reviewed and versioned. It performs no network call
unless `--submit` is passed.

```bash
node tools/eval/bedrockEval.ts                     # (re)generate datasets and payloads
node tools/eval/bedrockEval.ts --model <model-id> --kb-id <knowledge-base-id>
node tools/eval/bedrockEval.ts --submit            # create the jobs (needs AWS credentials)
```

### 6.1 Model-as-judge — attachments

| Item | Value |
|---|---|
| Task | `registre-attachment-judge`, `kind: model-as-judge` |
| Dataset | `attachment-dataset.jsonl`, 60 rows of `{prompt, referenceResponse}` |
| Metrics | `attachment_set_matches` (same control set as the reference), `attachment_quote_grounded` (the quoted passage exists in the document) |
| Metric definitions | `attachment-metrics.json` (custom, judge-scored) |
| Judge model | the reasoning model, overridable with `--model` |
| Payload | `attachment-job.json` |

The reference responses are generated from the catalogue, so the judge compares
against the same truth the local scorer uses. A prompt change is accepted only
if both metrics hold.

### 6.2 Knowledge-base evaluation — questions

| Item | Value |
|---|---|
| Task | `registre-qa-knowledge-base`, `kind: knowledge-base` |
| Dataset | `qa-dataset.jsonl`, 25 conversations with reference responses |
| Metrics | `Correctness`, `Completeness`, `Helpfulness`, `Faithfulness` |
| Knowledge base | `EVIDENCE_KB_ID`, passed with `--kb-id` |
| Payload | `qa-job.json` |

`Faithfulness` is the metric that matters for the "no invented answer" promise:
it scores whether the answer is supported by the retrieved passages. The five
trap questions must score as refusals; a trap answered with a citation is a
regression even if the other four metrics look good.

## 7. When each measure runs

| Trigger | Reading | Attachment | Sufficiency | Questions |
|---|---|---|---|---|
| Every commit (CI, offline) | local scorer on the fixture run | local scorer | local scorer | local scorer |
| Prompt change | — | Bedrock judge task | — | Bedrock KB evaluation task |
| Model change | local scorer + spot check | Bedrock judge task | local scorer | Bedrock KB evaluation task |
| Before the submission | full run on the deployed stack | full run | full run | full run |

The offline runs use `src/ai/mock/*` and the in-memory store, so they are
deterministic and free. The Bedrock runs cost real tokens: they are the
pre-submission gate, not the inner loop.

## 8. What the numbers are not

They are not a claim that a control is satisfied. The evaluation measures
whether the tool read a document correctly, attached it to the right control
with a real quote, listed what was missing, and cited what it said. The judgment
of whether the partner meets the requirement stays with the auditor — which is
why no metric here is named after the c-word (ENF-IA-01), and why the pack hands
over the known gaps along with the evidence.
