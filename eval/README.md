# Module `eval` — the four quality measures

The measurement module of spec chapter 13.5. It holds the shared catalogue of the
demonstration data, the four generated datasets, the local scorer, and the two
Bedrock evaluation tasks.

```
eval/
  catalogue.ts             public entry point (import this one)
  catalogue/
    types.ts               shapes, domains, periodicities, helpers
    controls.ts            30 controls over six domains
    evidenceGovernance.ts  EV-001 … EV-012
    evidenceOperations.ts  EV-013 … EV-032 (incidents, changes)
    evidenceContinuity.ts  EV-033 … EV-042
    evidenceSecurity.ts    EV-043 … EV-052
    evidenceClients.ts     EV-053 … EV-060
    evidence.ts            the 60 rows, assembled + lookups
    questions.ts           20 questions with evidence + 5 traps
    situations.ts          the seeded situations of chapter 18.1
    validate.ts            integrity checks (counts, ids, dates, wording)
  datasets/                generated, never hand-edited
    reading.jsonl          60 rows — Annex B fields read by hand
    attachment.jsonl       60 rows — expected controls
    sufficiency.jsonl      20 rows — expected gaps
    qa.jsonl               25 rows — 20 answers + 5 traps
  bedrock/                 generated payloads for the Bedrock evaluation jobs
  results/                 run result files fed to the scorer
tools/eval/
  buildDatasets.ts         catalogue → eval/datasets/*.jsonl  (--check)
  score.ts                 the local scorer (table, --json, --evidence-dir)
  bedrockEval.ts           catalogue → eval/bedrock/*         (--submit, lazy SDK)
  makeFixtureResults.ts    a perfect and a degraded reference run
  lib/                     schema, rows, scoring, report, fixtures, quotes, Bedrock shapes
test/eval/                 catalogue, datasets, scorer, Bedrock payloads
```

## Commands

```bash
node tools/eval/buildDatasets.ts          # regenerate the four datasets
node tools/eval/buildDatasets.ts --check  # fail when they are stale (CI)
node tools/eval/makeFixtureResults.ts     # reference runs: perfect + degraded
node tools/eval/score.ts                  # score eval/results/latest.json
node tools/eval/score.ts --results eval/results/fixture-degraded.json
node tools/eval/score.ts --results <file> --json
node tools/eval/score.ts --results <file> --evidence-dir demo-out/evidence
node tools/eval/bedrockEval.ts            # write the Bedrock payloads
node --test "test/eval/**/*.test.ts"
```

`score.ts` exits 0 when the four measures pass, 1 when one fails, 2 on a usage
or input error. That exit code is the CI signal.

## Targets (spec 13.5)

| Measure | Dataset | Target |
|---|---|---|
| Fields read correctly | `reading.jsonl` | > 90 % of the 840 scored fields |
| Accepted without correction | `attachment.jsonl` | > 85 % of the 60 evidence |
| Wrong link with high confidence | `attachment.jsonl` | 0 above the confidence threshold |
| Expected gaps detected | `sufficiency.jsonl` | 20 of 20, and no gap invented |
| Correct citations | `qa.jsonl` | > 90 % of the 20 questions |
| Invented answers | `qa.jsonl` | 0 on the 5 traps |

The 14 scored fields are: `type`, `title`, `documentDate`, `period.start`,
`period.end`, `version`, `author`, `approver`, `approvalDate`, `client`,
`personalData`, `accessLevel`, `unreadable`, `dateToConfirm`.

## Run result format (`eval/results/*.json`)

The demo and a real Bedrock run write the same document:

```json
{
  "runId": "demo-2026-11-11",
  "producedBy": "demo",
  "reading":     [{ "evidenceId": "EV-001", "fields": { "type": "POLICY", "...": "..." }, "flags": {}, "accessLevel": "INTERNAL" }],
  "attachment":  [{ "evidenceId": "EV-001", "attachments": [{ "controlId": "CONT-01", "supports": true, "confidence": 0.93, "citationVerified": true }] }],
  "sufficiency": [{ "evidenceId": "EV-033", "controlId": "CONT-16", "missing": ["Measured recovery time"] }],
  "answers":     [{ "questionId": "Q-01", "answerKind": "EVIDENCE", "citations": [{ "evidenceId": "EV-001", "page": 1 }] }]
}
```

Every section is optional (an empty section simply scores zero). Write it to
`eval/results/latest.json` to use the default command line.

With `--evidence-dir <dir>`, the cited passage of every answer is also searched
inside the document (`src/domain/citation.ts`), so a right document with a
fabricated passage no longer passes. Without it, only the evidence ids are
compared.

## Contract for the demo generator (`tools/demo/**`)

The catalogue is the single source of truth: the demo renders the files, the
evaluation measures them. Import it — do not copy it.

```ts
import {
  CONTROLS,        // CatalogueControl[]  — 30 rows, Annex A shape
  EVIDENCE,        // CatalogueEvidence[] — 60 rows, file name + expected fields
  QUESTIONS,       // CatalogueQuestion[] — 25 rows (20 + 5 traps)
  SEEDED_SITUATIONS, // SeededSituation[] — chapter 18.1 seeds + 4 edge cases
  DEMO_FRAMEWORK,  // { id: 'demo-msp', name, version }
  toFrameworkImport, // () => FrameworkImport, ready for POST /v1/frameworks (R1)
  findControl, findEvidence, findQuestion, findSituation,
  validateCatalogue, // () => CatalogueProblem[]  (empty = valid)
  DOMAINS, PERIODICITIES, OWNERS, EXPECTED_COUNTS
} from '../../eval/catalogue.ts';
```

Rules the generator must keep:

1. **File names come from the catalogue.** `EV-00n.fileName` is what the
   `reading.jsonl` and `attachment.jsonl` rows reference; do not rename a file
   without regenerating the datasets.
2. **Content must match the declared fields.** A `POLICY` row dated `2025-05-12`
   must print that date; an `approver: null` row must carry no signature block;
   a `personalData: true` row must actually hold personal data.
3. **Honour the seeds.** `seededSituation` says what the file must show:
   `UNSIGNED_PROCEDURE` → no signature block; `RESTORE_REPORT_MISSING_DURATION`
   → a restore report with no measured recovery time; `DUPLICATE_DOCUMENT` →
   the byte-identical content of `duplicateOf`; `MISFILED_EVIDENCE` → the file is
   written into `filedUnder`; `UNREADABLE_EVIDENCE` → a scan with no
   extractable text; `SCREENSHOT_DATE_TO_CONFIRM` → a printed date that differs
   from the file timestamp.
4. **`expectedControls` is the accepted answer**, not a suggestion. If the
   generated text would not support those controls, fix the text — the dataset
   is the measurement.
5. **`missingElements` is the accepted gap list** used by `sufficiency.jsonl`.
6. Call `validateCatalogue()` in your own test: it fails on a missing seed, a
   dangling control id, a bad periodicity, or forbidden wording.

After changing the catalogue, regenerate:

```bash
node tools/eval/buildDatasets.ts && node tools/eval/bedrockEval.ts
```

`buildDatasets.ts --check` fails in CI when a dataset no longer matches the
catalogue, so a catalogue edit that forgets the regeneration is caught.

## Bedrock tasks

`bedrockEval.ts` writes, without any network call:

| File | Content |
|---|---|
| `attachment-dataset.jsonl` | 60 lines, `prompt` + `referenceResponse` (model-as-judge) |
| `attachment-metrics.json` | two binary custom metrics: set match, quote grounding |
| `qa-dataset.jsonl` | 25 lines, `conversationTurns` (knowledge base evaluation) |
| `eval-config.json` | task definitions, counts, `aws` CLI commands |
| `attachment-job.json` | `create-evaluation-job` payload, model-as-judge |
| `qa-job.json` | `create-evaluation-job` payload, knowledge base |

The AWS SDK is imported lazily and only under `--submit`. Spec item 24.9 (exact
field names of the evaluation API) is still open: the payloads are shaped after
the published documentation and must be confirmed before the first real job.

## Wording

No file of this module — code, data, prompt or report — describes a control as
being in a state. The scorer reports ratios and counts; the states belong to
`src/domain/engine.ts` and are named `COVERED`, `TO_RENEW`, `TO_VERIFY`,
`EXPIRED`, `NO_EVIDENCE`.
