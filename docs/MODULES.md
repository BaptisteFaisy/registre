# Module map

Who owns what, with the real paths. The rule that makes this document useful:
**a module only changes files inside its own paths**, and a boundary is crossed
through `src/ports/index.ts`, never by importing another module's internals.

## 1. Layers

```
  portal/            React SPA — talks HTTP only
      │
  src/api/           the 16 endpoints, request → principal → domain call
      │
  src/pipeline/      orchestration of one evidence, step by step
      │
  src/domain/        rules: states, freshness, sufficiency, citation, access
      │
  src/ports/         every boundary as an interface (no implementation)
      │
  src/ai/  src/store/  src/collectors/  src/notify/  src/support/
      adapters: Bedrock, DynamoDB/S3, sources, SES, primitives
```

Dependencies point downwards only. `src/domain/**` imports nothing but
`src/domain/**` and `src/support/**`; that is what lets the whole rule set be
tested without a network, a clock or a store.

## 2. Modules

| Module | Paths | Responsibility | Key requirements |
|---|---|---|---|
| **domain** | `src/domain/**`, `test/domain/**` | Types and rules: control states, freshness, sufficiency classes, citation verification, access control, vocabulary guard, framework import and diff | chapter 12, ENF-IA-01, ENF-IA-04, ENF-CONF-01, EF-REF-01..05 |
| **ports** | `src/ports/index.ts` | Every boundary interface and the `Services` bundle injected at bootstrap. No implementation, no I/O | ENF-REP-01 |
| **support** | `src/support/**` | Primitives shared by everyone: ISO-8601 arithmetic (the only place calendar maths happens), SHA-256, deterministic ids, text normalisation and similarity, clocks, error types and HTTP mapping | ENF-INT-01, determinism |
| **ai** | `src/ai/**`, `test/ai/**` | Prompt templates (including the injection fence), Bedrock adapters (Data Automation reader, knowledge-base retrievers, structured reasoner, guardrail, composer, cost meter) and deterministic mocks | EF-LEC-01..04, EF-RAT-01..02, EF-QR-01..02, EF-SUF-01..02, ENF-IA-02..03, ENF-COUT-01 |
| **pipeline** | `src/pipeline/**`, `src/audit/**`, `test/pipeline/**` | The chain: ingest → read → retrieve → attach → sufficiency → states → reminders → pack. Owns the order of operations and the audit events emitted at each step | chapter 11.4, EF-COL-05, EF-RAT-03, EF-FRA-01..04, EF-DOS-01..03 |
| **platform** | `src/store/**`, `src/collectors/**`, `src/notify/**`, `test/store/**`, `test/collectors/**` | DynamoDB single-table adapter and in-memory store, S3 vault, the four collectors, SES notifier and reminder text | EF-COL-01..04, EF-REL-01..04, ENF-INT-01..02 |
| **api** | `src/api/**`, `test/api/**` | The sixteen endpoints of chapter 15, the local server for the demo, and the Lambda handlers used by CDK | chapter 15, EF-ADM-02..03 |
| **portal** | `portal/**` | React SPA (Vite): readiness, validation queue, evidence, ask, packs, audit log, settings. Talks HTTP only; has a mock client so it runs without a back end | EF-VAL-01..02, EF-QR-01, EF-DOS-02 |
| **demo** | `tools/demo/**`, `demo/**`, `test/demo/**` | The 30-control demonstration framework, the 60 generated evidences, the seeded situations, and the end-to-end offline run | chapter 18, acceptance R1–R16 |
| **eval** | `tools/eval/**`, `eval/**`, `test/eval/**` | Four datasets, the local scorer with its targets, and the two Bedrock evaluation task payloads | chapter 13.5 |
| **infra** | `infra/**` | Nine CDK stacks, the handler factory, the demo-user script, the deployment README | ENF-REP-01, ENF-DATA-01, ENF-OBS-01, R16 |
| **docs** | `docs/**`, `README.md` | English deliverables: HLD, architecture, API, data model, security, demo, submission, evaluation, operations, decisions, this map | chapter 19 |
| **quality** | `tools/quality/**` | Two CI guards: file and function size, and the wording ban | rule "files < 500 lines", ENF-IA-01 |

## 3. Where to look for a behaviour

| Question | File |
|---|---|
| What states exist, and what do they mean? | `src/domain/types.ts` (`ControlState`), `src/domain/states.ts` |
| When does an evidence expire? | `src/domain/freshness.ts`, `src/support/iso8601.ts` |
| What makes a sufficiency complete? | `src/domain/sufficiency.ts` |
| Why was this attachment cancelled? | `src/domain/citation.ts` (`CITATION_NOT_FOUND`) |
| Who may read this evidence? | `src/domain/access.ts` (`ROLE_MAX_LEVEL`, `levelsUpTo`) |
| How is a hostile document neutralised? | `src/ai/prompts/injection.ts` |
| How is a quote verified? | `src/domain/citation.ts` + `src/support/normalize.ts` |
| How is the audit chain computed? | `src/store/auditChain.ts` |
| How is a document read on AWS? | `src/ai/bedrock/dataAutomationReader.ts` |
| How are candidates retrieved? | `src/ai/bedrock/knowledgeBase.ts` |
| How are attachments proposed? | `src/ai/bedrock/structuredReasoner.ts` + `src/ai/prompts/attachment.ts` |
| How is an answer grounded? | `src/ai/bedrock/guardrails.ts` + `src/ai/anchoring.ts` |
| What is the DynamoDB key layout? | `src/store/dynamoKeys.ts`, `docs/DATA-MODEL.md` §3 |
| Which stack creates what? | `infra/lib/*-stack.ts`, `infra/README.md` §8 |
| Which Bedrock function is used where, and why? | `docs/ARCHITECTURE.md` §4 |

## 4. Conventions every module follows

1. **Files under 500 lines, functions under 50.** Enforced by
   `tools/quality/checkSizes.ts` over `src`, `tools`, `test`, `infra/lib`,
   `infra/bin`, `portal/src`. Split, do not grow.
2. **Zero duplication.** Shared behaviour lives once: dates in
   `src/support/iso8601.ts`, hashes in `src/support/hash.ts`, ids in
   `src/support/ids.ts`, normalisation in `src/support/normalize.ts`, errors in
   `src/support/errors.ts`. A second implementation is a bug.
3. **No `any`, no `@ts-ignore`.** `npm run typecheck` is the gate.
4. **Relative imports end with `.ts`**; type-only imports use `import type`
   (Node strips types, it does not resolve them).
5. **AWS SDK v3 only inside adapters**, behind a lazy `await import(...)`, so
   `src/domain/**` and the tests never load it.
6. **Time is injected.** No `new Date()` in `src/`; a `Clock` is passed in, so
   tests and the demo are reproducible.
7. **English** for identifiers, comments and user-facing strings.
8. **The wording ban is global**: no control is ever described with the c-word
   (ENF-IA-01). The vocabulary guard, the CI check and acceptance R15 exist for
   exactly that.

## 5. Boundaries that must not be crossed

| Do not | Instead |
|---|---|
| Import a Bedrock adapter from `src/domain/**` | Depend on the port in `src/ports/index.ts` |
| Call `new Date()` anywhere in `src/` | Use the injected `Clock` |
| Read `process.env` outside the bootstrap and `infra/lib/config.ts` | Pass settings through `Settings` |
| Write a DynamoDB key outside `src/store/dynamoKeys.ts` | Reuse the key builders |
| Compute a date difference outside `src/support/iso8601.ts` | Reuse the helpers |
| Add a second "is this fresh?" rule | Use `src/domain/freshness.ts` |
| Let a model return a state, a class or a count | Compute it in `src/domain/**` |
| Put a framework text in the repository | Import it at runtime (EF-REF-03) |
