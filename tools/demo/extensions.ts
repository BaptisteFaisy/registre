/**
 * Demonstration of the three extensions, offline and deterministic.
 *
 * Everything here runs on the mock provider: two machine attestations and the
 * drift they raise, a second framework with proposed and validated mappings and
 * the reuse metric they produce, a pre-filled draft for a control with a gap,
 * the measured quality of the run, and finally the exported pack that
 * `scripts/verify-pack.sh` checks without any trust in this codebase.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Services } from '../../src/ports/index.ts';
import type {
  Attachment,
  ControlMapping,
  Draft,
  Pack,
  ReuseMetric,
  SufficiencyElement
} from '../../src/domain/types.ts';
import type { ProposedAttachment } from '../../src/ports/index.ts';
import type { DriftEvent, QualityRecord, QualitySubject } from '../../src/domain/quality.ts';
import type { QualityMeasurement } from '../../src/pipeline/quality.ts';
import { ingestEvidence } from '../../src/pipeline/ingest.ts';
import { decideMapping, proposeMappings, reuseMetric } from '../../src/pipeline/crossmap.ts';
import { generateDraft } from '../../src/pipeline/draft.ts';
import { recordEvaluation } from '../../src/pipeline/quality.ts';
import { verifyPack } from '../../src/pipeline/verify.ts';
import type { VerificationResult } from '../../src/domain/verification.ts';
import { canonicalJson } from '../../src/support/hash.ts';
import { toIsoFrameworkImport } from '../../eval/catalogue-iso.ts';
import { importFramework } from '../../src/pipeline/import.ts';
import { findControl } from '../../eval/catalogue.ts';
import { addDays } from '../../src/support/iso8601.ts';
import type { ReasonerScript } from '../../src/ai/mock/scriptedReasoner.ts';
import { demoEvidenceId, mergeScripts, scriptEntryFor, searchableText } from './lib/script.ts';

/** The control the simulated backup collector attests about. */
export const ATTESTED_CONTROL = 'CONT-19';

/** Two consecutive collector runs: one healthy, one reporting a failure. */
export interface MachineRun {
  fileName: string;
  attestedState: string;
  collectedAt: string;
  text: string;
}

export interface ExtensionFacts {
  drifts: DriftEvent[];
  mappings: {
    proposed: number;
    validated: number;
    reuse: ReuseMetric | null;
    targetReuse: ReuseMetric | null;
  };
  draft: Draft | null;
  quality: QualityRecord[];
  verification: VerificationResult | null;
  packDirectory: string | null;
}

/** Renders one collector report, quoting the control it attests about. */
export function machineRuns(now: string, controlId: string = ATTESTED_CONTROL): MachineRun[] {
  const control = findControl(controlId);
  const requirement = control?.requirement ?? 'Backup jobs complete and are monitored.';
  const title = control?.title ?? 'Backup jobs';
  return [
    {
      fileName: 'backup-job-report-day1.md',
      attestedState: 'all 12 backup jobs succeeded',
      collectedAt: now,
      text: report(title, requirement, now, 'all 12 backup jobs succeeded', '12 of 12 jobs succeeded')
    },
    {
      fileName: 'backup-job-report-day2.md',
      attestedState: 'backup job failed on db-1',
      collectedAt: addDays(now, 1),
      text: report(
        title,
        requirement,
        addDays(now, 1),
        'backup job failed on db-1',
        '11 of 12 jobs succeeded, db-1 failed with a timeout'
      )
    }
  ];
}

/** Text of one collector report, in the header format the reader understands. */
function report(title: string, requirement: string, date: string, state: string, detail: string): string {
  return [
    '---',
    `Title: ${title} - automated report`,
    'Type: Report',
    `Date: ${date.slice(0, 10)}`,
    'Author: backup collector',
    'Personal data: no',
    `Summary: Automated collector report. ${detail}.`,
    '---',
    '',
    `# ${title} - automated report`,
    '',
    requirement,
    '',
    `Observed state: ${state}.`,
    `Detail: ${detail}.`,
    ''
  ].join('\n');
}

/**
 * Script entries for the two collector reports, so the offline reasoner answers
 * for them exactly as it does for the 60 catalogue documents: same confidence,
 * same real quotes, no heuristic surprise.
 */
export function machineScript(runs: readonly MachineRun[], controlId: string = ATTESTED_CONTROL): ReasonerScript {
  const attachments = new Map<string, readonly ProposedAttachment[]>();
  const sufficiency = new Map<string, readonly SufficiencyElement[]>();
  for (const run of runs) {
    const bytes = new TextEncoder().encode(run.text);
    const id = demoEvidenceId(bytes);
    const entry = scriptEntryFor({
      evidenceId: id,
      reference: run.fileName,
      text: searchableText(run.text, false),
      controlIds: [controlId]
    });
    attachments.set(id, entry.proposals);
    for (const [key, elements] of entry.elements) sufficiency.set(key, elements);
  }
  return { attachments, sufficiency };
}

/** Merges the catalogue script with the collector reports' script. */
export function withMachineScript(base: ReasonerScript, runs: readonly MachineRun[]): ReasonerScript {
  return mergeScripts(base, machineScript(runs));
}

/** Ingests both runs, one day apart, and returns the drifts they raised. */
export async function runMachineAttestations(
  services: Services,
  actor: string,
  now: string
): Promise<DriftEvent[]> {
  const runs = machineRuns(now);
  const drifts: DriftEvent[] = [];
  for (const run of runs) {
    const before = await services.extensions.listDrifts({});
    await ingestEvidence(
      services,
      {
        bytes: new TextEncoder().encode(run.text),
        contentType: 'text/markdown',
        uri: `file://demo/data/machine/${run.fileName}`,
        kind: 'AWS_REPORT',
        fileName: run.fileName,
        fileDate: run.collectedAt,
        provenance: 'MACHINE_ATTESTATION',
        attestedState: run.attestedState
      },
      actor
    );
    const after = await services.extensions.listDrifts({});
    for (const event of after) {
      if (!before.some((known) => known.id === event.id)) drifts.push(event);
    }
    setClock(services, run.collectedAt);
  }
  return drifts;
}

/**
 * Moves the frozen demo clock. The port only promises `now()`; the demo always
 * builds a `FixedClock`, so the cast is safe here and nowhere else.
 */
function setClock(services: Services, instant: string): void {
  const clock = services.clock as { set?: (value: string) => void };
  clock.set?.(instant);
}

/** Imports the second framework, proposes mappings and validates the best ones. */
export async function runMappings(
  services: Services,
  actor: string,
  sourceFrameworkId: string,
  validateUpTo = 3
): Promise<{ proposed: number; validated: number; reuse: ReuseMetric; targetReuse: ReuseMetric }> {
  await importFramework(services, toIsoFrameworkImport(), actor);
  const proposed = await proposeMappings(services, {
    sourceFrameworkId,
    targetFrameworkId: 'demo-iso',
    actor
  });
  // Validate first the equivalences whose source control already has applied
  // evidence: those are the ones that show what a mapping is worth.
  const ordered = await withAppliedEvidenceFirst(services, proposed);
  let validated = 0;
  for (const mapping of ordered.slice(0, validateUpTo)) {
    await decideMapping(services, mapping.id, {
      decision: 'VALIDATE',
      by: actor,
      note: 'Demonstration: the two requirements ask for the same record.'
    });
    validated += 1;
    // Carrying over only ever proposes on the other framework, never applies.
    await propagateFor(services, mapping);
  }
  // The reuse shows up on the RECEIVING framework: that is where attachments
  // appear without a single new deposit.
  return {
    proposed: proposed.length,
    validated,
    reuse: await reuseMetric(services, sourceFrameworkId),
    targetReuse: await reuseMetric(services, 'demo-iso')
  };
}

/** Puts first the mappings whose source control has applied evidence. */
async function withAppliedEvidenceFirst(
  services: Services,
  mappings: readonly ControlMapping[]
): Promise<ControlMapping[]> {
  const scored: Array<{ mapping: ControlMapping; applied: number }> = [];
  for (const mapping of mappings) {
    const attachments = await services.state.listAttachments({
      controlId: mapping.sourceControlId,
      status: 'APPLIED'
    });
    scored.push({ mapping, applied: attachments.filter((item) => item.supports).length });
  }
  return scored
    .sort((left, right) => right.applied - left.applied || left.mapping.id.localeCompare(right.mapping.id))
    .map((entry) => entry.mapping);
}

/** Propagates every applied attachment of one mapping's source control. */
async function propagateFor(services: Services, mapping: ControlMapping): Promise<void> {
  const { propagateAttachment } = await import('../../src/pipeline/crossmap.ts');
  const attachments = await services.state.listAttachments({
    controlId: mapping.sourceControlId,
    status: 'APPLIED'
  });
  for (const attachment of attachments.filter((item: Attachment) => item.supports)) {
    await propagateAttachment(services, attachment);
  }
}

/** Drafts the document of the first control that still misses an element. */
export async function runDraft(services: Services, actor: string): Promise<Draft | null> {
  const queue = await services.state.listValidations({ status: 'PENDING', kind: 'SUFFICIENCY' });
  const candidates = await draftableControls(services, queue.map((item) => item.controlId ?? null));
  // The first candidate whose previous version actually carries text over: a
  // control whose only evidence is a flat CSV export has nothing to carry, and
  // the demonstration is clearer with a real starting point.
  let fallback: Draft | null = null;
  for (const controlId of candidates.slice(0, DRAFT_CANDIDATES)) {
    const draft = await generateDraft(services, controlId, actor);
    if (fallback === null) fallback = draft;
    if (draft.sections.some((section) => !section.toComplete)) return draft;
  }
  return fallback;
}

/** How many controls are tried before settling for a fully blank draft. */
export const DRAFT_CANDIDATES = 4;

/**
 * First control of the queue that has a previous version to carry over: the
 * draft is more convincing when it starts from the partner's own document.
 */
async function draftableControls(
  services: Services,
  candidates: readonly (string | null)[]
): Promise<string[]> {
  const unique = candidates.filter((id): id is string => id !== null);
  const ordered: string[] = [];
  for (const controlId of unique) {
    if (await hasAppliedEvidence(services, controlId)) ordered.push(controlId);
  }
  // Then any other control of the same framework that has a previous version.
  const first = unique[0];
  if (first !== undefined) {
    const control = await services.state.getControl(first);
    if (control !== null) {
      for (const other of await services.state.listControls(control.frameworkId)) {
        if (!ordered.includes(other.id) && (await hasAppliedEvidence(services, other.id))) ordered.push(other.id);
      }
    }
  }
  return ordered.length > 0 ? ordered : unique;
}

/** True when a control has at least one applied, supporting attachment. */
async function hasAppliedEvidence(services: Services, controlId: string): Promise<boolean> {
  const applied = await services.state.listAttachments({ controlId, status: 'APPLIED' });
  return applied.some((item) => item.supports);
}

/** Records what this very run measured, so the quality trend is not fiction. */
export async function recordRunQuality(
  services: Services,
  input: { answered: boolean; refused: boolean; acceptedWithoutCorrection: number; totalAttachments: number }
): Promise<QualityRecord[]> {
  const ratio = input.totalAttachments === 0 ? 0 : input.acceptedWithoutCorrection / input.totalAttachments;
  const attachment: QualitySubject = {
    kind: 'ATTACHMENT',
    modelId: services.settings.reasoningModel,
    promptVersion: 'attachment-v1'
  };
  const qa: QualitySubject = {
    kind: 'QA',
    modelId: services.settings.answerModel,
    promptVersion: 'answer-v1'
  };
  const attachmentRecords = await recordEvaluation(services, {
    subject: attachment,
    records: [
      {
        metric: 'ACCEPTED_WITHOUT_CORRECTION',
        value: round4(ratio),
        target: 0.85,
        sampleCount: input.totalAttachments,
        datasetVersion: 'demo-run',
        jobId: null
      }
    ]
  });
  const qaRecords = await recordEvaluation(services, { subject: qa, records: qaMeasurements(input) });
  return [...attachmentRecords, ...qaRecords];
}

/** The two question-answering metrics this run can measure honestly. */
function qaMeasurements(input: { answered: boolean; refused: boolean }): QualityMeasurement[] {
  return [
    { metric: 'INVENTED_ANSWERS', value: input.refused ? 0 : 1, target: 0, sampleCount: 1, datasetVersion: 'demo-run', jobId: null },
    { metric: 'CITATION_ACCURACY', value: input.answered ? 1 : 0, target: 0.9, sampleCount: 1, datasetVersion: 'demo-run', jobId: null }
  ];
}

/** Writes the pack where a third party can verify it, then verifies it. */
export async function exportAndVerifyPack(
  services: Services,
  pack: Pack,
  outDir: string
): Promise<{ directory: string; verification: VerificationResult }> {
  const directory = join(outDir, 'pack');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'manifest.json'), `${canonicalJson(pack.manifest)}\n`);
  if (pack.signature !== null) {
    writeFileSync(
      join(directory, 'attestation.json'),
      `${canonicalJson({ manifest: pack.manifest, signature: pack.signature })}\n`
    );
  }
  const archiveBytes = await services.evidenceStore.get(pack.archive.uri);
  writeFileSync(join(directory, 'index.json'), archiveBytes);
  return { directory, verification: await verifyPack(services, pack.id) };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
