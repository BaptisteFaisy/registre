# Evaluation

Quality is measured, not asserted. Five datasets, one local scorer that fails CI
when a target is missed, two Bedrock evaluation tasks that replay the two most
fragile measures on every prompt or model change — and, since the quality bonus,
a **recording loop**: every measurement is stored per prompt version, shown as a
trend, and a failing metric automatically stops auto-application (§8).

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

## 6. The fifth set — cross-framework mappings

The mapping axis brings a fifth evaluated artefact: a **second, fictional
framework**, `demo-iso` — 12 controls in 4 domains, written for this project,
never ISO normative text (`eval/catalogue-iso.ts` and `eval/catalogue-iso/**`,
exporting `ISO_CONTROLS`, `ISO_FRAMEWORK` and `toIsoFrameworkImport()`; the same
licensing rule as `demo-msp`, ENF-CONF-03).

What is checked, by tests rather than by a scorer (`test/mapping/**`, contract
in `docs/CONTRACTS-EXT.md` §3):

- **Catalogue invariants** — 12 controls, 4 domains, unique ids, and every
  `equivalents` entry names an existing `demo-msp` control.
- **Quote discipline** — a proposed mapping whose quotes are not found in the
  two requirement texts is refused: equivalences are scored by the code-side
  `similarity()`, and **both** quotes are verified by code before the mapping is
  persisted `PROPOSED` (`src/pipeline/crossmap.ts`).
- **Propagation stays a proposal** — a validated mapping propagates an applied
  attachment as `PROPOSED` only, never `APPLIED`; a rejected mapping propagates
  nothing.
- **Reuse arithmetic** — `reuseMetric` is verified on a hand-built store:
  evidence carried, attachments proposed, deposits avoided, reuse factor
  (`attachmentCount / evidenceCount`, two decimals; `src/domain/mapping.ts`).

There is no acceptance-rate target for mappings, and that is deliberate: a
mapping is never applied by the tool, so the measured quantity is the *queue of
proposals a human validates*, not an accuracy the system could degrade on its
own (ADR-17).

## 7. Bedrock evaluation tasks

Two tasks, prepared by `tools/eval/bedrockEval.ts`, which writes every payload to
`eval/bedrock/` so it can be reviewed and versioned. It performs no network call
unless `--submit` is passed.

```bash
node tools/eval/bedrockEval.ts                     # (re)generate datasets and payloads
node tools/eval/bedrockEval.ts --model <model-id> --kb-id <knowledge-base-id>
node tools/eval/bedrockEval.ts --submit            # create the jobs (needs AWS credentials)
```

### 7.1 Model-as-judge — attachments

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

### 7.2 Knowledge-base evaluation — questions

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

## 8. The continuous measurement loop

Evaluation used to end at the scorer's exit code. The quality bonus closes the
loop: measures are **recorded, attributable, trended, and enforced**.

**Attributable.** Every prompt family carries a version constant
(`PROMPT_VERSIONS` — reading, attachment, sufficiency, answer — in
`src/ai/versioning.ts`), and both reasoners stamp it on every proposal; the
stamp is persisted on `Attachment.promptVersion`. A metric is therefore always
attached to a subject `(kind, model, promptVersion)`: a template change without
a version bump would poison the trend, which is why the version constants are
code, not prose.

**Recorded.** `tools/eval/runAndRecord.ts` runs the existing scorer on the four
datasets and converts its six metrics into `QualityRecord`s through
`tools/eval/lib/qualityRecords.ts`, then persists them with `recordEvaluation`
(`src/pipeline/quality.ts`, journalled `QUALITY_RECORDED`, stored in the
extension store and written to `eval/results/quality-records.json`). Each record
carries value, target, sample size, a deterministic dataset version
(`ds-<hash>`) and the Bedrock job id when it came from an evaluation task:

| `QualityMetric` | Comes from | Target |
|---|---|---|
| `FIELD_ACCURACY` | reading accuracy (§2) | ≥ 0.90 |
| `ACCEPTED_WITHOUT_CORRECTION` | attachment acceptance (§3) | ≥ 0.85 |
| `WRONG_HIGH_CONFIDENCE` | wrong links above threshold (§3) | must be 0 |
| `GAPS_DETECTED` | detected / expected gaps (§4) | ≥ 1 |
| `CITATION_ACCURACY` | correct citations (§5) | ≥ 0.90 |
| `INVENTED_ANSWERS` | answers on the five traps (§5) | must be 0 |

Verdicts are computed by code (`metricVerdict`): ratios pass at or above target,
the two zero-target metrics pass only at exactly zero.

**Trended.** `qualityTrend` and `qualityReport` (`src/pipeline/quality.ts`)
order the records per subject and per metric — latest value, target, verdict,
direction (`improving` / `stable` / `degrading`, where the zero-target metrics
improve by falling) — and the portal quality screen displays them with the
threshold in force.

**Enforced.** The record that matters operationally is the latest
`ACCEPTED_WITHOUT_CORRECTION`: `effectiveConfidenceThreshold`
(`src/domain/quality.ts`) returns the configured threshold while it passes and
**1.01 — unreachable — while it fails**, and `src/pipeline/attach.ts` applies
that value instead of the setting. A failing measurement therefore stops every
auto-application, routing all proposals to the human queue; a passing
measurement restores the configured flow. The degradation and the recovery are
both visible on the quality screen and both journalled. Rationale: ADR-19;
runbook: `docs/OPERATIONS.md` §7.6; offline proof: `test/quality/**`
(threshold, trend, versioning, runner).

## 9. When each measure runs

| Trigger | Reading | Attachment | Sufficiency | Questions | Mappings | Recorded quality |
|---|---|---|---|---|---|---|
| Every commit (CI, offline) | local scorer on the fixture run | local scorer | local scorer | local scorer | catalogue and propagation tests (`test/mapping/**`, `docs/CONTRACTS-EXT.md` §3) | runner covered offline by `test/quality/**` |
| Prompt change | — | Bedrock judge task | — | Bedrock KB evaluation task | — | `runAndRecord.ts --check` |
| Model change | local scorer + spot check | Bedrock judge task | local scorer | Bedrock KB evaluation task | — | `runAndRecord.ts --check` |
| Before the submission | full run on the deployed stack | full run | full run | full run | full run | full run |

The offline runs use `src/ai/mock/*` and the in-memory store, so they are
deterministic and free. The Bedrock runs cost real tokens: they are the
pre-submission gate, not the inner loop.

## 10. What the numbers are not

They are not a claim that a control is satisfied. The evaluation measures
whether the tool read a document correctly, attached it to the right control
with a real quote, listed what was missing, and cited what it said. The judgment
of whether the partner meets the requirement stays with the auditor — which is
why no metric here is named after the c-word (ENF-IA-01), and why the pack hands
over the known gaps along with the evidence. Since the quality bonus, the
numbers are also the tool's own governor: when they fall, the tool stops
trusting itself and says so (§8).
