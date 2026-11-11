# Demonstration script and acceptance walkthrough

Two artefacts: a three-minute video script, and the acceptance run that proves
the sixteen scenarios of chapter 22. Both use the same demonstration data, so
what the video shows is what the tests check.

## 1. Demonstration data

| Item | Content |
|---|---|
| MSP | A fictional partner: 40 staff, 25 managed customers, 150 controls in real life |
| Framework | `demo-msp`, 30 controls written for this submission, six domains: governance, incident management, change management, continuity, security, client relationship |
| Evidence | 60 generated documents: policies (PDF), procedures, meeting minutes, ticket exports, screenshots, a certification list |
| Questions | 25, of which 5 have no answer in the corpus (trap questions) |
| Seeded situations | 10, listed below |
| Provenance | Everything is generated. No customer data, no employee data, no protected framework text. |

The generator lives in `tools/demo/**` and writes into `demo/`; the catalogue it
reads (`eval/catalogue.ts`) is also what the evaluation harness scores against,
so the demo and the metrics cannot drift apart.

### Seeded situations

| # | Situation | Control | Evidence | Demonstrates |
|---|---|---|---|---|
| 1 | Security policy last reviewed 18 months ago, annual periodicity | `CONT-01` | `EV-001` | Expired evidence → `EXPIRED` (R5) |
| 2 | No restore test recorded in the current quarter | `CONT-16` | — | `NO_EVIDENCE` plus a reminder (R6) |
| 3 | Restore report without a measured recovery time | `CONT-16` | `EV-033` | Partial sufficiency, gap listed in the reminder (R7) |
| 4 | Procedure published without a signature | `CONT-11` | `EV-007` | Missing element detected (R7) |
| 5 | Access review filed in the continuity folder | `CONT-21` | `EV-043` | Misfiled evidence still attached to the right control (R9) |
| 6 | Same policy filed twice under two names | `CONT-01` | `EV-001`, `EV-002` | One record, two locations (R8) |
| 7 | Document unrelated to the framework | — | `EV-060` | No attachment at all (R10) |
| 8 | Scanned procedure with no extractable text | `CONT-24` | `EV-052` | `UNREADABLE` flag, validation queue (R2) |
| 9 | Evidence holding personal data | `CONT-22` | `EV-045`, `EV-048`, `EV-050` | `RESTRICTED`, invisible to an uncleared role (R13) |
| 10 | Screenshot whose printed date differs from the file date | `CONT-04` | `EV-011`, `EV-042` | `dateToConfirm` flag |

## 2. Demonstration credentials

Created once per deployment by `infra/scripts/create-demo-users.sh`, which prints
one password per role. They are pasted into the Devpost testing instructions and
never committed.

| Login | Role | What the judges should see |
|---|---|---|
| `quality.lead@example.com` | `QUALITY_LEAD` | Everything: readiness, validation queue, pack assembly, settings |
| `control.owner@example.com` | `CONTROL_OWNER` | Only their own controls; can deposit evidence and see their reminders |
| `executive@example.com` | `EXECUTIVE` | Readiness and trend, read-only |
| `internal.auditor@example.com` | `INTERNAL_AUDITOR` | Ask questions; restricted evidence is absent from answers |
| `admin@example.com` | `ADMIN` | Settings, sources, audit log |

Offline (`npm run demo`), the same five identities exist in the in-memory store
with fixed passwords printed on screen; no network, no AWS account.

## 3. Video script — 3 minutes

Recorded in English, 1920×1080, no third-party music or branding, no protected
framework visible at any point. Two windows side by side: the portal, and the
AWS console (vault bucket with its Object Lock banner, Bedrock knowledge bases,
Data Automation project).

| Time | Shot | Narration |
|---|---|---|
| 0:00–0:20 | Title, then a split of a document folder, a ticket tool and a spreadsheet. | "Every MSP that wants the AWS MSP validation, or ISO 27001, spends weeks gathering evidence before the audit. The evidence exists. Finding it, and knowing what is still missing, is the work." |
| 0:20–0:50 | Readiness screen of `demo-msp`: 30 controls split into covered, to renew, to verify, expired, no evidence; the six-month trend below. | "Registre watches this all year. Seventeen controls have fresh, complete evidence. Four expire within thirty days. Five need a human look. Two are expired, two have no evidence at all. The trend shows where we were six months ago." |
| 0:50–1:25 | Upload `restore-test-2026-Q4.pdf`; the pipeline animation; then the evidence detail with two attachments, each with its quoted passage; sufficiency panel showing four of five elements present. | "A restore report arrives. The tool fingerprints it, reads it with Bedrock Data Automation, and asks the framework knowledge base which controls it might support. The model proposes two controls, each with the passage that justifies it — and the code checks that the passage really is in the document. Sufficiency is partial: the measured recovery time is missing." |
| 1:25–1:50 | Validation queue: one correction (the access review attached to the wrong control), one acceptance. Then the owner's inbox with the reminder. | "The quality lead reviews what the confidence threshold did not settle. One correction, one acceptance, each keeping its author, date and reason. The owner immediately receives a reminder that says exactly what to provide." |
| 1:50–2:20 | Ask screen: "When was the information security policy last reviewed?" → answer with document, page and date. Then a question with no evidence → the refusal sentence. | "The internal auditor asks a question. The answer cites the document, the page and the date, and the guardrail refuses to let an ungrounded sentence through. Ask something the evidence does not cover, and the tool says so instead of inventing an answer." |
| 2:20–2:40 | Pack assembly, then the zip opened: index per control, evidence files, the known-gaps page. | "Before the audit, one click assembles the pack: an index per control, the evidence, the checksums, and the list of known gaps — because handing over the gaps is part of an honest audit." |
| 2:40–3:00 | Architecture diagram, then the Bedrock console: two knowledge bases, the Data Automation project, the guardrail, the evaluation job. | "Two Bedrock knowledge bases, Data Automation for reading, structured output for attachments, Guardrails for masking and grounding, evaluation tasks on every prompt change, and the Flex tier for the nightly backfill. And no framework is bundled: each partner imports their own." |

## 4. Acceptance walkthrough (R1–R16)

Run offline with `npm test` and `npm run demo`; the same scenarios are replayed
against the deployed stack for the recorded demonstration.

| Ref | Scenario | How to see it | Expected |
|---|---|---|---|
| R1 | Import the demonstration framework | `POST /v1/frameworks` with `demo/framework.json`, or the demo's first step | 30 controls with requirement, expected evidence, periodicity, owner |
| R2 | Read the 60 evidences | `npm run demo`, reading report | Over 90 % of fields correct; unreadable and date-mismatch cases flagged |
| R3 | Attach the 60 evidences | Validation queue after the run | Over 85 % accepted without correction; no wrong attachment at high confidence |
| R4 | Quote absent from the document | `test/domain/citation.test.ts`, and the scripted reasoner's `fake-quote` case | Attachment rejected, reason `CITATION_NOT_FOUND` |
| R5 | Policy dated 18 months ago, annual periodicity | `CONT-01` in the readiness screen | `EXPIRED` |
| R6 | No restore test this quarter | `CONT-16` | `NO_EVIDENCE`, reminder sent |
| R7 | Restore report without a recovery time | `CONT-16`, `EV-033` | Sufficiency `PARTIAL`, `Measured recovery time` listed in the reminder |
| R8 | Duplicate document | `EV-001` / `EV-002` | One evidence, two locations, no second model call |
| R9 | Misfiled evidence | `EV-043` on `CONT-21` | Attached to the right control despite the folder |
| R10 | Unrelated document | `EV-060` | No attachment |
| R11 | Question with evidence | Ask screen, `Q-01` | Answer with document, page and date |
| R12 | Question without evidence | Any of the five trap questions | "No evidence answers this question." |
| R13 | User without clearance on restricted evidence | Log in as `internal.auditor@example.com`, ask about `EV-045` | Evidence absent from the answer; `ACCESS_DENIED` in the audit log |
| R14 | Pack assembly | `POST /v1/frameworks/demo-msp/packs` | Index per control, downloadable archive, `checksumsVerified: true` |
| R15 | Search for the c-word in the UI and in exports | `npm run check:wording`, then Ctrl-F in the pack and the portal | No occurrence applied to a control |
| R16 | Installation in a fresh account | Follow `infra/README.md` end to end | Nine stacks deployed, portal reachable, demo accounts created |

## 5. Recording checklist

- [ ] Fresh deployment in the target account, demo data loaded, demo users created.
- [ ] Browser zoom at 110 % so the text is legible at 1080p; light theme.
- [ ] No browser tab, bookmark or notification showing a real customer name.
- [ ] No protected framework on screen: use `demo-msp` only, and blur the
      Bedrock console if a framework name appears in a breadcrumb.
- [ ] Notifications off; e-mail inbox shows only the demo recipient.
- [ ] Timing rehearsed to 3:00 ±5 s; the refusal question and the partial
      sufficiency are the two moments not to cut.
- [ ] Uploaded to YouTube as public, English audio, no music.
