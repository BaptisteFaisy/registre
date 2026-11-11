/**
 * Offline end-to-end demonstration of Registre (spec chapter 18).
 *
 * One command, no AWS account, no network:
 *
 *   node tools/demo/main.ts            # human-readable run + demo-out/report.md
 *   node tools/demo/main.ts --json     # machine-readable summary on stdout
 *   node tools/demo/main.ts --quiet    # write the artefacts, print nothing
 *
 * The run is deterministic: the clock is frozen (`DEMO_NOW`), the mock
 * provider is scripted by the catalogue, and every id is derived from content.
 */

import { readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServices } from '../../src/bootstrap.ts';
import type { Services } from '../../src/ports/index.ts';
import {
  askQuestion,
  assemblePack,
  decideValidation,
  importFramework,
  ingestEvidence,
  listValidationQueue,
  recomputeFramework,
  runReminders
} from '../../src/pipeline/index.ts';
import type { IngestResult } from '../../src/pipeline/index.ts';
import type {
  Answer,
  Control,
  ControlStatus,
  Evidence,
  Pack,
  Principal,
  ReadinessSnapshot,
  ReadinessTrendPoint,
  Reminder,
  ValidationItem
} from '../../src/domain/types.ts';
import { QUESTIONS, toFrameworkImport, validateCatalogue } from '../../eval/catalogue.ts';
import type { CatalogueEvidence } from '../../eval/catalogue/types.ts';
import { EVIDENCE, findEvidence } from '../../eval/catalogue.ts';
import { isCsvDocument } from './lib/document.ts';
import { buildReasonerScript } from './lib/script.ts';
import { machineRuns, withMachineScript } from './extensions.ts';
import { EVIDENCE_DIR, FRAMEWORK_PATH } from './generate.ts';
import { buildFacts, buildReport, type DemoFacts } from './report.ts';
import {
  exportAndVerifyPack,
  recordRunQuality,
  runDraft,
  runMachineAttestations,
  runMappings,
  type ExtensionFacts
} from './extensions.ts';

/**
 * Relevance floor of the offline evidence search. Below it a question is
 * refused (EF-QR-02, R12): in production the managed knowledge base and the
 * grounding guardrail play the same role.
 */
export const EVIDENCE_MIN_SCORE = 0.1;

/** Frozen instant of the demonstration (spec 18: the audit is prepared now). */
export const DEMO_NOW = '2026-11-11T09:00:00.000Z';

/** Actor used for every action of the demo run. */
export const DEMO_ACTOR = 'demo.quality.lead';

/** Quality lead of the fictional MSP: full clearance (chapter 6). */
export const DEMO_PRINCIPAL: Principal = {
  id: 'u-quality',
  name: 'Quality and Compliance Lead',
  email: 'quality@northwind-msp.example',
  role: 'QUALITY_LEAD',
  clearance: 'RESTRICTED',
  ownedControls: []
};

export interface DemoResult {
  readiness: ReadinessSnapshot;
  statuses: ControlStatus[];
  trend: ReadinessTrendPoint;
  /** Attachment proposals accepted by the quality lead during the run. */
  decisions: number;
  ingested: number;
  duplicates: number;
  attachments: number;
  validationQueue: ValidationItem[];
  reminders: Reminder[];
  answered: Answer;
  refused: Answer;
  /** The three extensions and the measured quality of this very run. */
  extensions: ExtensionFacts;
  pack: Pack;
  costPerEvidenceUsd: number;
  totalCostUsd: number;
}

/** Runs the whole chain on the generated demonstration data. */
export async function runDemo(rootDir = process.cwd()): Promise<DemoResult> {
  const evidenceIndex: Evidence[] = [];
  const services = await demoServices(rootDir, evidenceIndex);

  await importFramework(services, toFrameworkImport(), DEMO_ACTOR);
  const run = await processDemonstration(services, evidenceIndex, rootDir);

  const answered = await askQuestion(services, DEMO_PRINCIPAL, questionWithEvidence());
  const refused = await askQuestion(services, DEMO_PRINCIPAL, trapQuestion());
  const extensions = await runExtensions(services, run, answered, refused);
  const pack = await assemblePack(services, 'demo-msp', DEMO_ACTOR);
  const exported = await exportAndVerifyPack(services, pack, join(rootDir, 'demo-out'));
  extensions.verification = exported.verification;
  extensions.packDirectory = exported.directory;

  const costs = services.costs.report();
  return {
    ...run,
    answered,
    refused,
    extensions,
    pack,
    costPerEvidenceUsd: run.ingested === 0 ? 0 : costs.totalUsd / run.ingested,
    totalCostUsd: costs.totalUsd
  };
}

/** Runs the three extensions and the quality measurement on the seeded run. */
async function runExtensions(
  services: Awaited<ReturnType<typeof createServices>>['services'],
  run: { attachments: number; decisions: number },
  answered: Answer,
  refused: Answer
): Promise<ExtensionFacts> {
  // Axis 3a: two collector runs a day apart; the second reports a failure.
  const drifts = await runMachineAttestations(services, DEMO_ACTOR, DEMO_NOW);
  setDemoClock(services, DEMO_NOW);
  await recomputeFramework(services, 'demo-msp');

  // Axis 2: a second framework, proposed equivalences, three validated.
  const mappings = await runMappings(services, DEMO_ACTOR, 'demo-msp');

  // Axis 3b: the missing document, pre-filled for its owner.
  const draft = await runDraft(services, DEMO_ACTOR);

  // Bonus: what this very run measured, recorded as the quality baseline.
  const quality = await recordRunQuality(services, {
    answered: !answered.noEvidence,
    refused: refused.noEvidence,
    // Every proposal the quality lead accepted as-is counts as accepted without
    // correction; only a rejection or a correction would lower the ratio.
    acceptedWithoutCorrection: run.attachments,
    totalAttachments: run.attachments
  });

  return { drifts, mappings, draft, quality, verification: null, packDirectory: null };
}

/** Restores the frozen instant after the collector runs moved the clock. */
function setDemoClock(services: Services, instant: string): void {
  (services.clock as { set?: (value: string) => void }).set?.(instant);
}

/**
 * Builds the offline services of the demo: frozen clock, mock provider, the
 * catalogue controls as the framework knowledge base, and the reasoner script
 * derived from the generated documents.
 */
export async function demoServices(
  rootDir: string,
  evidenceIndex: Evidence[],
  vaultRootOverride?: string
): Promise<Awaited<ReturnType<typeof createServices>>['services']> {
  const problems = validateCatalogue();
  if (problems.length > 0) {
    throw new Error(`catalogue invalid: ${problems.map((p) => `${p.code} ${p.detail}`).join('; ')}`);
  }
  // The vault enforces a retention hold (ENF-INT-01): a demo run always starts
  // from an empty vault, so re-running the same command stays possible.
  const vaultRoot = vaultRootOverride ?? join(rootDir, '.data', 'demo-vault');
  rmSync(vaultRoot, { recursive: true, force: true });

  const byName = new Map(EVIDENCE.map((item) => [item.fileName, item]));
  const catalogueScript = buildReasonerScript(rootDir, (fileName) => {
    const item = byName.get(fileName);
    return item ? isCsvDocument(item) : false;
  });
  // The two simulated collector reports are scripted like the catalogue
  // documents, so the drift demonstration is deterministic too.
  const script = withMachineScript(catalogueScript, machineRuns(DEMO_NOW));
  const { services } = await createServices({
    provider: 'mock',
    now: DEMO_NOW,
    mock: {
      controls: demoControls(),
      evidences: evidenceIndex,
      script,
      evidenceMinScore: EVIDENCE_MIN_SCORE
    },
    vaultRoot
  });
  return services;
}

/**
 * Seeds a bundle with the demonstration set: framework imported, 60 documents
 * ingested, states recomputed. Used by the demo run and by the integration test
 * that drives the real API through the real portal client.
 */
export async function seedDemoData(options: {
  rootDir?: string;
  vaultRoot?: string;
} = {}): Promise<{ services: Awaited<ReturnType<typeof createServices>>['services']; evidenceIndex: Evidence[] }> {
  const rootDir = options.rootDir ?? process.cwd();
  const evidenceIndex: Evidence[] = [];
  const services = await demoServices(rootDir, evidenceIndex, options.vaultRoot);
  await importFramework(services, toFrameworkImport(), DEMO_ACTOR);
  await ingestAll(services, evidenceIndex, rootDir);
  await recomputeFramework(services, 'demo-msp');
  return { services, evidenceIndex };
}

/** Ingest, human validation of the queue, states, reminders (spec 8.1-8.3). */
async function processDemonstration(
  services: Awaited<ReturnType<typeof createServices>>['services'],
  evidenceIndex: Evidence[],
  rootDir: string
): Promise<Omit<DemoResult, 'answered' | 'refused' | 'extensions' | 'pack' | 'totalCostUsd' | 'costPerEvidenceUsd'>> {
  const ingested = await ingestAll(services, evidenceIndex, rootDir);
  await recomputeFramework(services, 'demo-msp');

  // The quality lead clears the attachment queue (EF-VAL-01/02): accepting a
  // proposal applies it and records the first human validation of that
  // (control, evidence type) pair, which spec 12.4 requires before a mandatory
  // control can be covered.
  const decisions = await acceptProposedAttachments(services);
  const { readiness, statuses, trend } = await recomputeFramework(services, 'demo-msp');
  return {
    readiness,
    statuses,
    trend,
    ingested: ingested.count,
    duplicates: ingested.duplicates,
    attachments: ingested.attachments,
    decisions,
    validationQueue: await listValidationQueue(services),
    reminders: await runReminders(services, 'demo-msp')
  };
}

/** Accepts every attachment proposal waiting for a decision (EF-VAL-01). */
export async function acceptProposedAttachments(
  services: Awaited<ReturnType<typeof createServices>>['services']
): Promise<number> {
  const queue = await listValidationQueue(services);
  let accepted = 0;
  for (const item of queue) {
    if (item.kind !== 'ATTACHMENT') continue;
    await decideValidation(services, item.id, {
      decision: 'ACCEPT',
      by: DEMO_PRINCIPAL.id,
      note: 'Accepted during the demonstration run: the quoted passage supports the control.'
    });
    accepted += 1;
  }
  return accepted;
}

/** The 30 catalogue controls as domain `Control` records of `demo-msp`. */
export function demoControls(): Control[] {
  return toFrameworkImport().controls.map((control) => ({
    id: control.id,
    frameworkId: 'demo-msp',
    domain: control.domain,
    title: control.title,
    requirement: control.requirement,
    expectedEvidence: [...control.expectedEvidence],
    periodicity: control.periodicity,
    owner: control.owner,
    mandatory: control.mandatory ?? true
  }));
}

/** Ingests every generated document once, in catalogue order. */
async function ingestAll(
  services: Awaited<ReturnType<typeof createServices>>['services'],
  evidenceIndex: Evidence[],
  rootDir: string
): Promise<{ count: number; duplicates: number; attachments: number }> {
  const files = orderedEvidenceFiles(rootDir);
  let duplicates = 0;
  let attachments = 0;
  for (const file of files) {
    const result: IngestResult = await ingestOne(services, file, rootDir);
    if (result.duplicateOf) duplicates += 1;
    else evidenceIndex.push(result.evidence);
    attachments += result.attachments.filter((item) => item.supports).length;
  }
  return { count: files.length, duplicates, attachments };
}

/** One document through the chain (fingerprint, read, attach, assess, states). */
async function ingestOne(
  services: Awaited<ReturnType<typeof createServices>>['services'],
  fileName: string,
  rootDir: string
): Promise<IngestResult> {
  const catalogue = catalogueFor(fileName);
  const path = join(rootDir, EVIDENCE_DIR, fileName);
  return ingestEvidence(
    services,
    {
      bytes: readFileSync(path),
      contentType: catalogue && isCsvDocument(catalogue) ? 'text/csv' : 'text/plain',
      uri: `file://${path}`,
      kind: 'MANUAL',
      fileName,
      fileDate: catalogue?.documentDate ?? null,
      suggestedControlId: catalogue?.filedUnder ? null : null
    },
    DEMO_ACTOR
  );
}

/** Evidence files in catalogue order, so the run is reproducible. */
export function orderedEvidenceFiles(rootDir = process.cwd()): string[] {
  const directory = join(rootDir, EVIDENCE_DIR);
  const present = new Set(readdirSync(directory));
  return EVIDENCE.map((item) => item.fileName).filter((name) => present.has(name));
}

function catalogueFor(fileName: string): CatalogueEvidence | undefined {
  return EVIDENCE.find((item) => item.fileName === fileName) ?? findEvidence(fileName);
}

/** First question of the catalogue that a real evidence answers (R11). */
export function questionWithEvidence(): string {
  const found = QUESTIONS.find((q) => q.expectedAnswerKind === 'EVIDENCE');
  return found?.question ?? 'Show the latest approved information security policy and its review date.';
}

/** First trap question: no evidence answers it (R12). */
export function trapQuestion(): string {
  const found = QUESTIONS.find((q) => q.expectedAnswerKind === 'NO_EVIDENCE');
  return found?.question ?? 'Which employee attended the payment-card security training in October?';
}

/** Writes the report artefacts and returns the facts handed to the renderer. */
export async function writeArtifacts(result: DemoResult, rootDir = process.cwd()): Promise<DemoFacts> {
  const outDir = join(rootDir, 'demo-out');
  mkdirSync(outDir, { recursive: true });
  const facts: DemoFacts = buildFacts({
    now: DEMO_NOW,
    frameworkPath: join(rootDir, FRAMEWORK_PATH),
    readiness: result.readiness,
    statuses: result.statuses,
    ingested: result.ingested,
    duplicates: result.duplicates,
    attachments: result.attachments,
    decisions: result.decisions,
    validationQueue: result.validationQueue,
    reminders: result.reminders,
    answered: result.answered,
    refused: result.refused,
    extensions: result.extensions,
    pack: result.pack,
    totalCostUsd: result.totalCostUsd,
    costPerEvidenceUsd: result.costPerEvidenceUsd
  });
  writeFileSync(join(outDir, 'report.md'), buildReport(facts));
  writeFileSync(join(outDir, 'readiness.json'), `${JSON.stringify(facts.summary, null, 2)}\n`);
  return facts;
}

async function main(): Promise<number> {
  const asJson = process.argv.includes('--json');
  const quiet = process.argv.includes('--quiet');
  const result = await runDemo();
  const facts = await writeArtifacts(result);
  if (quiet) return 0;
  if (asJson) {
    process.stdout.write(`${JSON.stringify(facts.summary, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(`${buildReport(facts)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`demo failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  );
}
