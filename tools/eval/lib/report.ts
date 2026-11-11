/**
 * Renders a `RunScore` as a readable English table (default) or as JSON
 * (`--json`, for a CI job or a dashboard).
 */

import { TARGETS } from './scoring.ts';
import type { RunScore } from './scoring.ts';

export interface MetricRow {
  label: string;
  value: string;
  target: string;
  pass: boolean;
}

const DETAIL_LIMIT = 12;

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** The six lines of the summary table. */
export function metricRows(score: RunScore): MetricRow[] {
  return [
    {
      label: 'Reading: fields read correctly',
      value: pct(score.reading.accuracy),
      target: `> ${pct(TARGETS.readingAccuracy)}`,
      pass: score.reading.pass
    },
    {
      label: 'Attachment: accepted without correction',
      value: pct(score.attachment.acceptanceRate),
      target: `> ${pct(TARGETS.attachmentAcceptance)}`,
      pass: score.attachment.acceptanceRate > TARGETS.attachmentAcceptance
    },
    {
      label: 'Attachment: wrong with high confidence',
      value: String(score.attachment.highConfidenceWrong),
      target: '= 0',
      pass: score.attachment.highConfidenceWrong === 0
    },
    {
      label: 'Sufficiency: expected gaps detected',
      value: `${score.sufficiency.detected}/${score.sufficiency.gaps}`,
      target: 'all',
      pass: score.sufficiency.missed.length === 0
    },
    {
      label: 'Answers: correct citations',
      value: pct(score.qa.citationRate),
      target: `> ${pct(TARGETS.citationAccuracy)}`,
      pass: score.qa.citationRate > TARGETS.citationAccuracy
    },
    {
      label: `Answers: invented on ${score.qa.traps} traps`,
      value: String(score.qa.invented),
      target: '= 0',
      pass: score.qa.invented === 0
    }
  ];
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}

function widthOf(rows: readonly MetricRow[], pick: (row: MetricRow) => string, header: string): number {
  return rows.reduce((widest, row) => Math.max(widest, pick(row).length), header.length);
}

/** Table header plus one line per metric. */
function tableLines(rows: readonly MetricRow[]): string[] {
  const labelWidth = widthOf(rows, (row) => row.label, 'Metric');
  const valueWidth = widthOf(rows, (row) => row.value, 'Value');
  const targetWidth = widthOf(rows, (row) => row.target, 'Target');
  const header = `${pad('Metric', labelWidth)}  ${pad('Value', valueWidth)}  ${pad('Target', targetWidth)}  Verdict`;
  const rule = `${'-'.repeat(labelWidth)}  ${'-'.repeat(valueWidth)}  ${'-'.repeat(targetWidth)}  -------`;
  const lines = [header, rule];
  for (const row of rows) {
    lines.push(`${pad(row.label, labelWidth)}  ${pad(row.value, valueWidth)}  ${pad(row.target, targetWidth)}  ${row.pass ? 'PASS' : 'FAIL'}`);
  }
  return lines;
}

function detailBlock(title: string, entries: readonly string[]): string[] {
  if (entries.length === 0) return [];
  const lines = [`${title} (${entries.length}):`];
  for (const entry of entries.slice(0, DETAIL_LIMIT)) lines.push(`  - ${entry}`);
  if (entries.length > DETAIL_LIMIT) lines.push(`  … and ${entries.length - DETAIL_LIMIT} more`);
  return lines;
}

/** Everything that went wrong, grouped, for the person reading the report. */
function details(score: RunScore): string[] {
  return [
    ...detailBlock('Evidence with no reading result', score.reading.missing),
    ...detailBlock('Fields read wrongly', score.reading.wrongFields),
    ...detailBlock('Wrong links above the confidence threshold', score.attachment.wrongLinks),
    ...detailBlock('Expected links never proposed', score.attachment.missingLinks),
    ...detailBlock('Expected gaps not reported', score.sufficiency.missed),
    ...detailBlock('Gaps reported but not expected', score.sufficiency.spurious),
    ...detailBlock('Questions without the expected citation', score.qa.citationMisses),
    ...detailBlock('Invented answers on trap questions', score.qa.inventedQuestions)
  ];
}

/** Full text report: context lines, table, details, verdict. */
export function renderReport(score: RunScore, context: readonly string[]): string {
  const lines = [...context, '', ...tableLines(metricRows(score)), '', ...details(score)];
  if (lines[lines.length - 1] !== '') lines.push('');
  lines.push(`Overall: ${score.pass ? 'PASS' : 'FAIL'}`);
  if (score.attachment.unsupportedClaims > 0) {
    lines.push(`Note: ${score.attachment.unsupportedClaims} claim(s) were cancelled because the quote was not in the document.`);
  }
  return lines.join('\n');
}

/** Machine-readable report (`--json`). */
export function toJson(score: RunScore): unknown {
  return {
    runId: score.runId,
    producedBy: score.producedBy,
    pass: score.pass,
    targets: TARGETS,
    reading: {
      evidence: score.reading.evidence,
      fields: score.reading.fields,
      correct: score.reading.correct,
      accuracy: score.reading.accuracy,
      pass: score.reading.pass,
      missing: score.reading.missing,
      wrongFields: score.reading.wrongFields
    },
    attachment: {
      evidence: score.attachment.evidence,
      accepted: score.attachment.accepted,
      acceptanceRate: score.attachment.acceptanceRate,
      highConfidenceWrong: score.attachment.highConfidenceWrong,
      wrongLinks: score.attachment.wrongLinks,
      missingLinks: score.attachment.missingLinks,
      unsupportedClaims: score.attachment.unsupportedClaims,
      pass: score.attachment.pass
    },
    sufficiency: {
      evidence: score.sufficiency.evidence,
      gaps: score.sufficiency.gaps,
      detected: score.sufficiency.detected,
      missed: score.sufficiency.missed,
      spurious: score.sufficiency.spurious,
      pass: score.sufficiency.pass
    },
    answers: {
      evidenceQuestions: score.qa.evidenceQuestions,
      citationCorrect: score.qa.citationCorrect,
      citationRate: score.qa.citationRate,
      citationMisses: score.qa.citationMisses,
      traps: score.qa.traps,
      invented: score.qa.invented,
      inventedQuestions: score.qa.inventedQuestions,
      pass: score.qa.pass
    }
  };
}
