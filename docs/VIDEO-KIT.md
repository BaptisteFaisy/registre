# Video kit — the three-minute submission video

Everything needed to record the demonstration video required by the hackathon
(about three minutes, public on YouTube, English, no third-party branding or
music, no protected framework text on screen).

Timing follows the specification (`docs/spec-fr.md`, chapter 18.2). Narration is
written out word for word and sized at roughly 140 words per minute, so each
block fits its slot. Total narration: **421 words for 3:00**.

---

## 1. Before you record

Open these five windows, in this order, and leave them ready:

| # | Window | Command / state |
|---|---|---|
| 1 | Terminal A — repository | `cd registre && git pull` |
| 2 | Terminal B — API | `node src/api/server.ts` (listens on `http://127.0.0.1:8787`) |
| 3 | Browser — portal | `cd portal && npm run dev:demo` (offline mock mode) |
| 4 | Terminal C — demonstration run | `node tools/demo/main.ts` (already run once, so `demo-out/report.md` exists) |
| 5 | Editor — architecture | `docs/ARCHITECTURE.md` open on the Bedrock feature table |

One-time preparation, the day before:

```bash
npm ci                      # root dependencies
cd portal && npm ci && cd ..
node tools/demo/generate.ts # writes demo/data (60 documents, deterministic)
node tools/demo/main.ts     # writes demo-out/report.md and readiness.json
```

Display settings: 1920×1080, browser zoom 100 %, terminal font large enough to
read on a phone, dark theme everywhere, notifications off, personal tabs closed.

## 2. Never on screen

- Any AWS access key, session token, `~/.aws` file, or GitHub token.
- Any real customer name, real employee name, or real ticket export.
- The AWS MSP programme validation checklist, or any ISO 27001 normative text.
  The demonstration framework (`demo-msp`, 30 controls) was written for this
  project; say so out loud (see block 7).
- The word "compliant" applied to a control. The five states are the only
  vocabulary: covered, to renew, to verify, expired, no evidence.

## 3. Shot-by-shot script

### 0:00 – 0:20 · The problem and the promise (47 words)

**On screen:** the portal login screen, then the readiness dashboard.

> "Every audit starts the same way: weeks spent hunting for evidence that is
> scattered across drives, tickets and inboxes. Registre does that work all year
> long. It collects evidence, reads it, attaches it to the controls it supports,
> watches how fresh it is, and assembles the audit pack on demand. It never says
> a control is compliant — that judgement belongs to the auditor."

### 0:20 – 0:50 · Readiness, and the trend (70 words)

**On screen:** Readiness dashboard — the five state counters, the shares, the
trend chart, the per-domain breakdown, then the cost per evidence.

> "This is the readiness of one framework: thirty controls, six domains. Five
> covered, three to renew, fourteen to verify, eight expired. Every number is
> computed by code, not by a model — dates, expiries and counts come from the
> periodicity of each control and the date of each document. The trend shows the
> last recomputations, so a reviewer can see whether preparation is improving.
> And here is the cost per evidence, measured, not estimated."

### 0:50 – 1:25 · Deposit, read, attach, assess (82 words)

**On screen:** open a control detail (restore test), then the deposit dialog,
upload the restore-test report, show the reading result, the two attachments
with their quotes and page numbers, and the partial sufficiency.

> "A restore-test report arrives. Bedrock Data Automation reads it against a
> field blueprint: type, title, document date, covered period, author, approver,
> summary. The knowledge base over the frameworks returns candidate controls, and
> a structured model call says which ones this document supports, with a
> confidence and a quoted passage. Our code then checks that the quote really is
> in the document — a quote that is not found cancels the attachment. Here the
> sufficiency is partial: the measured recovery time is missing, and the tool
> says exactly what is missing."

### 1:25 – 1:50 · Validation queue and reminder (58 words)

**On screen:** the Validation screen — accept one item, correct another with a
note; then the Reminders screen showing the owner's reminder.

> "Anything below the confidence threshold waits for a human. The quality lead
> accepts this one, corrects that one, and every decision keeps its author, its
> date and its reason. Accepting also records the first human validation for this
> evidence type, which a mandatory control needs before it can be covered. The
> owner of the expiring control gets a reminder that says what to provide."

### 1:50 – 2:20 · The auditor asks (70 words)

**On screen:** the Ask screen. Type the first question, show the answer with its
citations. Then type the second question and show the refusal.

> "During the audit, the internal auditor asks: when was the information
> security policy last reviewed, and who approved it? The answer cites the
> document, the page and the date — every claim traces back to a passage we can
> verify. Now a question nothing in the corpus answers: what was the result of
> the penetration test of the production cluster? The tool refuses. It says no
> evidence answers this question, instead of inventing an answer."

### 2:20 – 2:40 · The audit pack (47 words)

**On screen:** the Packs screen — assemble, show the index per control, the known
gaps, the checksums, the download.

> "Before the audit, the quality lead freezes a pack: an index by control, every
> supporting evidence with its date, its fingerprint and the quoted passage, plus
> the list of known gaps. Checksums are verified on the way out, so the pack is
> provably what was collected."

### 2:40 – 3:00 · Architecture, Bedrock, gains, portability (47 words)

**On screen:** `docs/ARCHITECTURE.md` — the Bedrock feature table, then the
framework import screen.

> "Six Bedrock capabilities, each doing what it is best at: managed knowledge
> bases, Data Automation, structured output, Guardrails, evaluation jobs, and the
> Flex tier for nightly runs. Partners import their own framework — nothing
> protected ships in this repository."

## 4. The six seeded situations, and where to show them

All six are in the demonstration set (`eval/catalogue.ts`); the table says which
screen proves each one.

| Situation | Control | Where to show it | What the viewer must see |
|---|---|---|---|
| Security policy not reviewed for 18 months | `CONT-01` | Readiness → control detail | state **expired**, expiry date computed from the 2025 review date plus the annual periodicity |
| No restore test this quarter | `CONT-16` | Readiness + Reminders | the latest report is the Q2 one, so the control is **expired**, and the reminder asks for this quarter |
| Restore report without a recovery time | `CONT-16` | Control detail → sufficiency | sufficiency **partial**, the missing element is named |
| Procedure published without a signature | `CONT-11` | Control detail / validation | no approver, the element is missing, the item waits in the queue |
| Evidence filed in the wrong folder | `CONT-21` | Evidence detail | filed under continuity, attached to a security control — the attachment is what counts, not the folder |
| Same document filed twice | `CONT-01` | Evidence detail → locations | one record, one fingerprint, **two locations**, the second flagged as a duplicate |

Four edge cases are worth ten seconds each if the timing allows: a document with
no relation to the framework (attached to nothing), an unreadable scan (flagged
for review), an evidence containing personal data (restricted, masked excerpts),
and a screenshot whose printed date differs from the file date (date to confirm).

## 5. The two live questions

Copy these exact strings; both come from the catalogue so the expected behaviour
is known in advance.

```text
When was the information security policy last reviewed and who approved it?
What was the result of the penetration test of the production cluster?
```

Expected: the first is answered with at least one citation carrying document,
page and date; the second returns "No evidence answers this question." with no
citation. If the answer differs, stop and investigate — do not re-record around
it.

## 6. Out-of-portal shots

Chapter 18.2 asks the video to show the internal accounts and the upstream and
downstream environments: sources, evidence vault, Bedrock console (knowledge
bases, Data Automation), and the owner's mailbox.

**If the AWS deployment is live** (the intended case), show for ten seconds each:

1. the S3 bucket holding the evidence — versioning enabled, object lock on;
2. the Bedrock console — the two knowledge bases (frameworks, evidence) and one
   Data Automation project with its field blueprint;
3. the Guardrail — the PII redaction and contextual grounding settings;
4. the owner's mailbox receiving a reminder, and the audit pack landing in the
   bucket;
5. CloudFront serving the portal at its public URL.

**If it is not live yet**, do not fake it. Show `infra/` in the editor, run
`cdk synth` and say plainly: "the infrastructure is code, nine stacks; this
recording runs the same application offline, with deterministic stand-ins for
the Bedrock calls, so the behaviour you see is the behaviour that ships." That
sentence keeps the video honest and still demonstrates the design.

## 7. Compliance checklist before publishing

- [ ] English audio or English subtitles, understandable without the code.
- [ ] About three minutes (2:50 – 3:10).
- [ ] Public on YouTube, unlisted is not accepted by the rules.
- [ ] No third-party logo, no music, no stock footage with a watermark.
- [ ] No protected framework text: no MSP validation checklist, no ISO 27001 text.
- [ ] No secret, token, key, account id or real customer name on screen.
- [ ] The tool never says a control is compliant — states only.
- [ ] The demonstration data is stated to be fictional (`demo-msp`, Northwind MSP).
- [ ] The URL of the portal shown is either the deployed one or clearly labelled
      as a local run.

## 8. Plan B — the fully offline recording

If the deployment, the network or the Bedrock quota fails on recording day, the
whole story still runs offline, deterministically:

```bash
node tools/demo/generate.ts   # 60 documents + the framework import
node tools/demo/main.ts       # ingest, validate, states, questions, pack
node src/api/server.ts        # the real HTTP API on 127.0.0.1:8787
cd portal && npm run dev:demo # the portal on its offline dataset
```

`node tools/demo/main.ts` prints the report used in blocks 2 to 6: readiness per
state, duplicates detected, proposals accepted by the quality lead, items still
waiting, reminders, the answered question with its citations, the refused
question, the assembled pack and the cost per evidence. Same numbers on every
run, because the clock is frozen at `2026-11-11T09:00:00Z`.

Say out loud which parts are the deterministic stand-ins and which are the real
Bedrock calls. The judges' criterion is that the code really calls an AWS AI
service at runtime — so if the recording is offline, point at
`src/ai/bedrock/**` in the editor and at `REGISTRE_PROVIDER=bedrock` in
`docs/OPERATIONS.md`, and state that the deployed run uses those adapters.
