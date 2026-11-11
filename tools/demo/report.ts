/**
 * Report renderer of the offline demonstration.
 *
 * Pure functions only: `main.ts` gathers the facts, this module turns them into
 * the markdown report a reviewer (or a judge) reads. Nothing here computes a
 * state, a date or a count — that is the engine's job (ENF-IA-04).
 *
 * Wording rule (ENF-IA-01): no control is ever described as compliant. The five
 * states are the only vocabulary used for a control's situation.
 */

import type { Answer, ControlState, ControlStatus, Pack, ReadinessSnapshot, Reminder, ValidationItem } from '../../src/domain/types.ts';
import { NO_EVIDENCE_ANSWER } from '../../src/domain/types.ts';
import { SEEDED_SITUATIONS } from '../../eval/catalogue.ts';
import type { ExtensionFacts } from './extensions.ts';

/** Facts the renderer needs; `summary` is the machine-readable twin. */
export interface DemoFacts {
  now: string;
  frameworkPath: string;
  readiness: ReadinessSnapshot;
  statuses: ControlStatus[];
  ingested: number;
  duplicates: number;
  attachments: number;
  decisions: number;
  validationQueue: ValidationItem[];
  reminders: Reminder[];
  answered: Answer;
  refused: Answer;
  /** The three extensions and the measured quality of this run. */
  extensions: ExtensionFacts;
  pack: Pack;
  totalCostUsd: number;
  costPerEvidenceUsd: number;
  summary: DemoSummary;
}

/** Machine-readable summary written to `demo-out/readiness.json`. */
export interface DemoSummary {
  generatedAt: string;
  frameworkId: string;
  controls: number;
  counts: Record<ControlState, number>;
  shares: Record<ControlState, number>;
  ingested: number;
  duplicates: number;
  supportingAttachments: number;
  acceptedProposals: number;
  pendingValidations: number;
  reminders: number;
  pack: { id: string; frozenAt: string; entries: number; checksumsVerified: boolean };
  costs: { totalUsd: number; perEvidenceUsd: number };
  seededSituations: Array<{ kind: string; controlId: string | null; state: ControlState | null; scenario: string }>;
  questions: { answered: boolean; refused: boolean };
  extensions: {
    drifts: number;
    driftKinds: string[];
    mappingsProposed: number;
    mappingsValidated: number;
    reuseFactor: number;
    targetReuseFactor: number;
    carriedAttachments: number;
    avoidedDeposits: number;
    draftControlId: string | null;
    draftSectionsToComplete: number;
    qualityRecords: number;
    verified: { checksumsOk: boolean; chainOk: boolean; signatureOk: boolean | null } | null;
  };
}

const STATE_ORDER: readonly ControlState[] = ['COVERED', 'TO_RENEW', 'TO_VERIFY', 'EXPIRED', 'NO_EVIDENCE'];

/** Builds the facts (and the summary) from one demo run. */
export function buildFacts(input: Omit<DemoFacts, 'summary'>): DemoFacts {
  const summary: DemoSummary = {
    generatedAt: input.now,
    frameworkId: input.readiness.frameworkId,
    controls: input.readiness.total,
    counts: input.readiness.counts,
    shares: input.readiness.shares,
    ingested: input.ingested,
    duplicates: input.duplicates,
    supportingAttachments: input.attachments,
    acceptedProposals: input.decisions,
    pendingValidations: input.validationQueue.length,
    reminders: input.reminders.length,
    pack: {
      id: input.pack.id,
      frozenAt: input.pack.frozenAt,
      entries: input.pack.index.length,
      checksumsVerified: input.pack.checksumsVerified
    },
    costs: { totalUsd: round(input.totalCostUsd), perEvidenceUsd: round(input.costPerEvidenceUsd) },
    seededSituations: SEEDED_SITUATIONS.map((situation) => ({
      kind: situation.kind,
      controlId: situation.controlId,
      state: stateOf(input.statuses, situation.controlId),
      scenario: situation.scenario
    })),
    questions: { answered: !input.answered.noEvidence, refused: input.refused.noEvidence },
    extensions: summariseExtensions(input.extensions)
  };
  return { ...input, summary };
}

/** Renders the markdown report (English, the language of the submission). */
export function buildReport(facts: DemoFacts): string {
  return [...reportHeader(facts), ...reportExtensions(facts), ...reportPack(facts)].join('\n');
}

/** Problem statement, readiness, costs and seeded situations. */
function reportHeader(facts: DemoFacts): string[] {
  return [
    '# Registre - offline demonstration report',
    '',
    `Run at ${facts.now} on framework \`${facts.readiness.frameworkId}\` (mock provider, no network).`,
    '',
    '## Readiness',
    '',
    ...readinessTable(facts.readiness),
    '',
    `Controls: ${facts.readiness.total}. Documents ingested: ${facts.ingested} ` +
      `(duplicates detected: ${facts.duplicates}, supporting attachments: ${facts.attachments}, ` +
      `proposals accepted by the quality lead: ${facts.summary.acceptedProposals}, ` +
      `still awaiting a decision: ${facts.validationQueue.length}).`,
    '',
    '## Costs (ENF-COUT-01)',
    '',
    `- total: $${round(facts.totalCostUsd).toFixed(4)}`,
    `- per evidence: $${round(facts.costPerEvidenceUsd).toFixed(4)}`,
    '',
    '## Seeded situations (spec 18.1)',
    '',
    ...situationLines(facts),
    '',
    '## Validation queue (EF-VAL-01)',
    '',
    ...queueLines(facts.validationQueue),
    '',
    '## Reminders (EF-REL-01/02)',
    '',
    ...reminderLines(facts.reminders),
    '',
    '## Questions (EF-QR-01/02)',
    '',
    ...answerLines('Question with evidence', facts.answered),
    '',
    ...answerLines('Question without evidence', facts.refused),
    ''
  ];
}

/** The three extensions and the measured quality of this very run. */
function reportExtensions(facts: DemoFacts): string[] {
  return [
    '## Machine attestations and drift (axis 3a)',
    '',
    ...driftLines(facts.extensions),
    '',
    '## Cross-framework reuse (axis 2)',
    '',
    ...mappingLines(facts.extensions),
    '',
    '## Pre-filled draft (axis 3b)',
    '',
    ...draftLines(facts.extensions),
    '',
    '## Measured quality of this run',
    '',
    ...qualityLines(facts.extensions),
    '',
    '## Third-party verification (axis 1)',
    '',
    ...verificationLines(facts.extensions),
    ''
  ];
}

/** The frozen audit pack and how a third party checks it. */
function reportPack(facts: DemoFacts): string[] {
  return [
    '## Audit pack (EF-DOS-01/02)',
    '',
    `- id: \`${facts.pack.id}\``,
    `- frozen at: ${facts.pack.frozenAt}`,
    `- index entries: ${facts.pack.index.length}`,
    `- known gaps: ${facts.pack.knownGaps.length}`,
    `- checksums verified: ${facts.pack.checksumsVerified ? 'yes' : 'no'}`,
    `- archive: ${facts.pack.archive.uri} (${facts.pack.archive.sizeBytes} bytes)`,
    ''
  ];
}

/** The five states with counts and shares; the only vocabulary allowed. */
export function readinessTable(readiness: ReadinessSnapshot): string[] {
  const lines = ['| State | Controls | Share |', '| --- | ---: | ---: |'];
  for (const state of STATE_ORDER) {
    const count = readiness.counts[state];
    const share = `${(readiness.shares[state] * 100).toFixed(1)}%`;
    lines.push(`| ${state} | ${count} | ${share} |`);
  }
  return lines;
}

/** One line per seeded situation, with the state the engine actually computed. */
export function situationLines(facts: DemoFacts): string[] {
  return facts.summary.seededSituations.map(
    (item) =>
      `- \`${item.kind}\` (${item.scenario})` +
      (item.controlId ? ` - control ${item.controlId}: ${item.state ?? 'not computed'}` : ' - no control (absence seeded)')
  );
}

/** First entries of the validation queue, with their reason. */
export function queueLines(queue: ValidationItem[]): string[] {
  if (queue.length === 0) return ['Empty: every attachment was above the confidence threshold.'];
  const shown = queue.slice(0, 8).map((item) => `- \`${item.kind}\` ${item.controlId ?? item.evidenceId ?? ''} - ${item.reason}`);
  return [`${queue.length} item(s) awaiting a decision:`, ...shown];
}

/** Reminders to send, with what the owner must provide. */
export function reminderLines(reminders: Reminder[]): string[] {
  if (reminders.length === 0) return ['None due at this instant.'];
  return reminders
    .slice(0, 8)
    .map((item) => `- ${item.controlId} to ${item.recipient} (${item.reason})${item.missing.length > 0 ? ` - missing: ${item.missing.join(', ')}` : ''}`);
}

/** A question, its answer and its citations - or the refusal (R12). */
export function answerLines(label: string, answer: Answer): string[] {
  const lines = [`**${label}**: ${answer.question}`, ''];
  if (answer.noEvidence) {
    lines.push(`> ${NO_EVIDENCE_ANSWER}`, '');
    lines.push(`(passages examined: ${answer.passagesUsed})`);
    return lines;
  }
  lines.push(`> ${answer.text}`, '');
  for (const citation of answer.citations.slice(0, 3)) {
    const page = citation.page === null ? 'page n/a' : `page ${citation.page}`;
    lines.push(`- ${citation.title ?? citation.evidenceId}, ${page}, ${citation.documentDate ?? 'date n/a'}: "${citation.quote}"`);
  }
  return lines;
}

/** Machine-readable summary of the three extensions and the quality run. */
function summariseExtensions(facts: DemoFacts['extensions']): DemoSummary['extensions'] {
  const reuse = facts.mappings.reuse;
  return {
    drifts: facts.drifts.length,
    driftKinds: facts.drifts.map((drift) => drift.kind),
    mappingsProposed: facts.mappings.proposed,
    mappingsValidated: facts.mappings.validated,
    reuseFactor: reuse?.reuseFactor ?? 0,
    targetReuseFactor: facts.mappings.targetReuse?.reuseFactor ?? 0,
    carriedAttachments: facts.mappings.targetReuse?.carriedAttachments ?? 0,
    avoidedDeposits: facts.mappings.targetReuse?.avoidedDeposits ?? 0,
    draftControlId: facts.draft?.controlId ?? null,
    draftSectionsToComplete: facts.draft?.sections.filter((section) => section.toComplete).length ?? 0,
    qualityRecords: facts.quality.length,
    verified:
      facts.verification === null
        ? null
        : {
            checksumsOk: facts.verification.checksumsOk,
            chainOk: facts.verification.chainOk,
            signatureOk: facts.verification.signatureOk
          }
  };
}

function stateOf(statuses: ControlStatus[], controlId: string | null): ControlState | null {
  if (!controlId) return null;
  return statuses.find((status) => status.controlId === controlId)?.state ?? null;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Two collector runs a day apart, and the drifts they raised. */
export function driftLines(facts: DemoFacts['extensions']): string[] {
  if (facts.drifts.length === 0) return ['No drift detected on the simulated collector runs.'];
  return facts.drifts.map(
    (drift) =>
      `- \`${drift.kind}\` on ${drift.controlId}: ${drift.detail}` +
      (drift.previous ? ` (previous: ${drift.previous})` : '')
  );
}

/** What one deposited evidence is worth once mappings are validated. */
export function mappingLines(facts: DemoFacts['extensions']): string[] {
  const source = facts.mappings.reuse;
  const target = facts.mappings.targetReuse;
  if (source === null || target === null) return ['No mapping run.'];
  return [
    `- equivalences proposed between demo-msp and demo-iso: ${facts.mappings.proposed}`,
    `- validated by the quality lead during the run: ${facts.mappings.validated}`,
    `- attachments carried over to demo-iso: ${target.carriedAttachments} (proposals only, never applied)`,
    `- deposits avoided on demo-iso: ${target.avoidedDeposits} — it has ${target.evidenceCount} deposited evidence of its own`,
    `- reuse factor on demo-msp: ${source.reuseFactor} attachments per deposited evidence` +
      (target.evidenceCount === 0
        ? ' (demo-iso has none of its own: everything came from a mapping)'
        : `, ${target.reuseFactor} on demo-iso`)
  ];
}

/** The draft is a starting point, never an evidence. */
export function draftLines(facts: DemoFacts['extensions']): string[] {
  const draft = facts.draft;
  if (draft === null) return ['No control needed a draft on this run.'];
  const carried = draft.sections.filter((section) => !section.toComplete).length;
  return [
    `- control ${draft.controlId}: ${draft.sections.length} sections, ${carried} carried over from the previous version, ${draft.sections.length - carried} left to complete`,
    `- watermarked "${draft.watermark}", attachable: ${draft.attachable}`,
    '- stored nowhere: no fingerprint, no vault write, no attachment'
  ];
}

/** The measurements this run recorded about itself. */
export function qualityLines(facts: DemoFacts['extensions']): string[] {
  if (facts.quality.length === 0) return ['No measurement recorded.'];
  return facts.quality.map(
    (record) =>
      `- ${record.subject.kind} \`${record.metric}\`: ${(record.value * 100).toFixed(1)}% ` +
        `(target ${(record.target * 100).toFixed(1)}%, ${record.verdict.toLowerCase()}, n=${record.sampleCount}) ` +
        `[${record.subject.promptVersion}]`
  );
}

/** The verdict a third party can reproduce with scripts/verify-pack.sh. */
export function verificationLines(facts: DemoFacts['extensions']): string[] {
  const result = facts.verification;
  if (result === null) return ['No pack verified.'];
  const signature =
    result.signatureOk === null ? 'no signing key configured' : result.signatureOk ? 'valid' : 'INVALID';
  return [
    `- root hash: \`${result.rootHash}\``,
    `- checksums: ${result.checksumsOk ? 'ok' : 'FAILED'} · audit chain: ${result.chainOk ? 'ok' : 'BROKEN'} · signature: ${signature}`,
    `- exported to \`${facts.packDirectory ?? 'demo-out/pack'}\`, verifiable offline with \`scripts/verify-pack.sh\``
  ];
}
