# Registre — engineering contract

Read this before writing a line of code. It is the single source of truth for
conventions; `docs/spec-fr.md` is the functional specification (French, internal).

## 1. Stack

| Choice | Value |
|---|---|
| Runtime | Node **≥ 22.18**, native TypeScript type stripping — **no build step, no bundler** for `src/` and `tools/` |
| Language | TypeScript, `strict`, ESM (`"type": "module"`) |
| Tests | `node --test` + `node:assert/strict` (no vitest, no jest) |
| Type check | `tsc --noEmit` (`npm run typecheck`) |
| AWS | SDK v3, **only** inside adapters, always behind a lazy `await import(...)` |
| Portal | separate app in `portal/` (own `package.json`, Vite + React) |
| Infra | separate app in `infra/` (own `package.json`, AWS CDK) |

Commands:

```bash
npm run typecheck                 # tsc --noEmit
npm test                          # node --test "test/**/*.test.ts"
node --test test/domain/engine.test.ts   # one file only
npm run check:sizes               # < 500 lines / function, < 50 lines / function
npm run check:wording             # ENF-IA-01: no "compliant"/"conforme"
npm run demo                      # end-to-end offline demo
```

**Never run `npm install`** — dependencies are already installed. Adding a
dependency requires an explicit reason in the PR description.

## 2. Hard rules (enforced in CI)

1. Every file **< 500 lines**; every function **< 50 lines**. Split instead of growing.
2. **Zero duplication.** Reuse `src/support/*` (dates, hashes, ids, normalisation, clocks, errors). One implementation per behaviour.
3. Relative imports **must end with `.ts`** (`import { x } from './x.ts'`). Type-only imports **must** use `import type` — Node strips types, it does not resolve them.
4. No `any`, no `@ts-ignore`. `npm run typecheck` must pass.
5. Identifiers, comments and user-facing strings in **English** (the submission is English). Internal notes may stay French in `docs/spec-fr.md` only.
6. **Never** describe a control as "compliant" / "conforme" (ENF-IA-01). Use the states of `ControlState` and the wording table in `src/domain/vocabulary.ts`.
7. States, dates and counts are computed **by code** (ENF-IA-04). A model may only return: quotes, confidences, booleans, extracted fields, free text.
8. Tests never touch the network. Use `src/ai/mock/*` and `src/store/memory.ts`.
9. Deterministic output: inject `Clock` (never call `new Date()` directly in `src/`), derive ids with `src/support/ids.ts`.
10. Stay inside your assigned paths (see `docs/MODULES.md`); do not "fix" another module.

## 3. What already exists

| Path | Content |
|---|---|
| `src/domain/types.ts` | every entity, enum and the default settings — **do not rename fields** |
| `src/domain/vocabulary.ts` | forbidden-wording guard (ENF-IA-01) |
| `src/domain/engine.ts` | freshness / sufficiency / control-state / readiness engine (**draft — refine and test**) |
| `src/ports/index.ts` | every boundary interface + the `Services` bundle |
| `src/support/errors.ts` | `RegistreError` + constructors + HTTP mapping |
| `src/support/iso8601.ts` | the **only** place where calendar arithmetic happens |
| `src/support/hash.ts` | SHA-256 (bytes, text, canonical JSON) |
| `src/support/ids.ts` | deterministic ids (`ev-`, `at-`, `sf-`, `rm-`, `pk-`, `va-`) |
| `src/support/normalize.ts` | text normalisation, similarity, containment |
| `src/support/clock.ts` | `SystemClock`, `FixedClock`, `clockFromEnv` |

## 4. Module map

| Module | Paths | Responsibility |
|---|---|---|
| domain | `src/domain/**`, `test/domain/**` | rules of chapter 12: states, freshness, sufficiency, citation check, access control, vocabulary |
| pipeline | `src/pipeline/**`, `src/audit/**`, `test/pipeline/**` | ingest → read → retrieve → attach → sufficiency → states → reminders → pack |
| ai | `src/ai/**`, `test/ai/**` | prompts, Bedrock adapters (Data Automation, knowledge bases, structured output, Guardrails, Flex tier, prompt cache), deterministic mocks |
| platform | `src/store/**`, `src/collectors/**`, `src/notify/**`, `test/store/**`, `test/collectors/**` | DynamoDB + in-memory stores, S3 vault, collectors, SES notifier |
| api | `src/api/**`, `test/api/**` | the 16 endpoints of chapter 15, local server, Lambda handlers |
| portal | `portal/**` | React app: readiness, validation queue, evidence, ask, packs, audit log |
| demo | `tools/demo/**`, `demo/**`, `test/demo/**` | 30-control framework, 60 generated evidence files, seeded situations, end-to-end run |
| eval | `tools/eval/**`, `eval/**`, `test/eval/**` | 4 datasets, local scorer, Bedrock evaluation-task definitions |
| infra | `infra/**` | CDK stacks (S3 vault, Step Functions, Lambdas, DynamoDB, knowledge bases, Guardrails, portal, SES, budgets) |
| docs | `docs/**`, `README.md` | English HLD, architecture, demo script, submission checklist, security |
| quality | `tools/quality/**` | `checkSizes.ts`, `checkWording.ts` (CI guards) |

## 5. Testing conventions

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
```

- File layout: `test/<module>/<unit>.test.ts`.
- Shared builders live in `test/fixtures/builders.ts` (`makeControl`, `makeEvidence`, `makeAttachment`, `makeSufficiency`, `makeServices`). Use them; do not rebuild entities by hand in every test.
- Each acceptance scenario of chapter 22 (R1…R16) has at least one test named after it.
- No snapshot tests, no timers other than the injected `FixedClock`.

## 6. Definition of done for a module

1. `npm run typecheck` passes.
2. `npm test` passes (whole suite, not just yours).
3. `npm run check:sizes` and `npm run check:wording` pass.
4. Every public function has a one-line doc comment referencing the spec requirement it implements (e.g. `EF-FRA-01`).
5. Nothing outside your paths changed.
