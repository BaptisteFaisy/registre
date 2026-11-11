/**
 * Public entry point of the catalogue.
 *
 * Consumers (the demo generator, the dataset builder, the tests) import from
 * `eval/catalogue.ts` only. Nothing here performs I/O or writes to the console,
 * so importing it has no side effect.
 */

import type { ControlInput, FrameworkImport } from '../src/domain/types.ts';
import type { CatalogueControl, CatalogueEvidence, CatalogueQuestion, SeededSituation } from './catalogue/types.ts';
import { CONTROLS } from './catalogue/controls.ts';
import { EVIDENCE, findEvidence, incompleteEvidence } from './catalogue/evidence.ts';
import { QUESTIONS } from './catalogue/questions.ts';
import { SEEDED_SITUATIONS } from './catalogue/situations.ts';

export * from './catalogue/types.ts';
export { CONTROLS } from './catalogue/controls.ts';
export { EVIDENCE, findEvidence, incompleteEvidence } from './catalogue/evidence.ts';
export { QUESTIONS } from './catalogue/questions.ts';
export { SEEDED_SITUATIONS } from './catalogue/situations.ts';
export {
  validateCatalogue,
  catalogueTexts,
  MANDATORY_SITUATIONS,
  EXPECTED_COUNTS
} from './catalogue/validate.ts';
export type { CatalogueProblem } from './catalogue/validate.ts';

/** Framework identity of the demonstration set (Annex A). */
export const DEMO_FRAMEWORK = {
  id: 'demo-msp',
  name: 'Demonstration MSP framework',
  version: '1.0'
} as const;

/** Looks a control up by id; `undefined` when unknown, so callers can report. */
export function findControl(id: string): CatalogueControl | undefined {
  return CONTROLS.find((control) => control.id === id);
}

/** Looks a question up by id; `undefined` when unknown. */
export function findQuestion(id: string): CatalogueQuestion | undefined {
  return QUESTIONS.find((question) => question.id === id);
}

/** Looks a seeded situation up by kind; `undefined` when unknown. */
export function findSituation(kind: string): SeededSituation | undefined {
  return SEEDED_SITUATIONS.find((situation) => situation.kind === kind);
}

function toControlInput(control: CatalogueControl): ControlInput {
  return {
    id: control.id,
    domain: control.domain,
    title: control.title,
    requirement: control.requirement,
    expectedEvidence: [...control.expectedEvidence],
    periodicity: control.periodicity,
    owner: control.owner,
    mandatory: control.mandatory
  };
}

/**
 * The demonstration framework in the payload accepted by `POST /v1/frameworks`
 * (EF-REF-01, R1): 30 controls with requirement, expected evidence,
 * periodicity and owner.
 */
export function toFrameworkImport(): FrameworkImport {
  return {
    framework: { ...DEMO_FRAMEWORK, confidentiality: 'INTERNAL', source: 'demonstration set written for the hackathon' },
    controls: CONTROLS.map(toControlInput)
  };
}

/** Evidence of the set as a plain list, ordered by id (defensive copy). */
export function listEvidence(): CatalogueEvidence[] {
  return EVIDENCE.map((item) => ({ ...item }));
}
