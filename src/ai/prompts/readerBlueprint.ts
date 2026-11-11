/**
 * Field plan ("blueprint") handed to Bedrock Data Automation — EF-LEC-01.
 *
 * The blueprint covers exactly the fields of Annex B, no more: Data Automation
 * returns a custom output shaped by this plan, and `dataAutomationReader.ts`
 * maps it back to `EvidenceFields`. The evidence type is constrained to the
 * closed list of `src/domain/types.ts`, so a model can never invent a new type.
 *
 * Pure data and pure functions, no I/O.
 */

import { EVIDENCE_TYPES } from '../../domain/types.ts';

export type BlueprintFieldType = 'string' | 'date' | 'boolean' | 'enum';

export interface BlueprintField {
  /** Stable key, mapped by the reader. */
  name: string;
  type: BlueprintFieldType;
  /** One-line instruction given to Data Automation for this field. */
  instruction: string;
  required: boolean;
  /** Closed list, for `type: 'enum'` only. */
  values?: readonly string[];
}

export interface EvidenceBlueprint {
  name: string;
  version: string;
  /** Document classes the plan applies to (EF-LEC-02). */
  documentClasses: readonly string[];
  /** Global instruction, applies to every field. */
  instructions: string;
  /** Sensitive-data detection and masking (EF-LEC-03). */
  sensitiveDataDetection: boolean;
  fields: readonly BlueprintField[];
}

/** Field keys of the plan, in Annex B order. */
export const EVIDENCE_FIELD_NAMES = [
  'evidenceType',
  'title',
  'documentDate',
  'periodStart',
  'periodEnd',
  'version',
  'author',
  'approver',
  'approvalDate',
  'client',
  'summary',
  'personalData'
] as const;

/** Format of the summary field, enforced by the instruction. */
export const SUMMARY_MAX_SENTENCES = 3;

/** The twelve fields of Annex B, each with its closed list or format. */
const FIELDS: readonly BlueprintField[] = [
  {
    name: 'evidenceType',
    type: 'enum',
    values: EVIDENCE_TYPES,
    required: true,
    instruction: 'Nature of the document. Pick one value of the closed list, never invent one.'
  },
  { name: 'title', type: 'string', required: true, instruction: 'Title as printed on the document.' },
  {
    name: 'documentDate',
    type: 'date',
    required: false,
    instruction: 'Date printed on the document, ISO-8601 (YYYY-MM-DD). Null when absent.'
  },
  {
    name: 'periodStart',
    type: 'date',
    required: false,
    instruction: 'First day covered by the document, for a report or an export. Null otherwise.'
  },
  {
    name: 'periodEnd',
    type: 'date',
    required: false,
    instruction: 'Last day covered by the document, for a report or an export. Null otherwise.'
  },
  { name: 'version', type: 'string', required: false, instruction: 'Version label as printed.' },
  { name: 'author', type: 'string', required: false, instruction: 'Author or owner named on the document.' },
  { name: 'approver', type: 'string', required: false, instruction: 'Signatory or approver. Null when unsigned.' },
  {
    name: 'approvalDate',
    type: 'date',
    required: false,
    instruction: 'Date of approval or signature, ISO-8601. Null when unsigned.'
  },
  {
    name: 'client',
    type: 'string',
    required: false,
    instruction: 'Customer the evidence is about. Null when the evidence is internal.'
  },
  {
    name: 'summary',
    type: 'string',
    required: true,
    instruction: `At most ${SUMMARY_MAX_SENTENCES} sentences, factual, no judgement about any control.`
  },
  {
    name: 'personalData',
    type: 'boolean',
    required: true,
    instruction: 'True when the document names people (staff, customers) or carries personal data.'
  }
];

/**
 * The blueprint for one evidence document (EF-LEC-01).
 * Returned as a fresh object so callers can tweak it without mutating the plan.
 */
export function evidenceBlueprint(): EvidenceBlueprint {
  return {
    name: 'registre-evidence',
    version: '1.0',
    documentClasses: ['document', 'image', 'spreadsheet'],
    instructions: [
      'Extract the fields below from one audit evidence.',
      'Copy values as written; never infer a date that is not printed.',
      'Return null for a field the document does not contain.',
      'Never state whether a control is covered: you only read the document.'
    ].join(' '),
    sensitiveDataDetection: true,
    fields: FIELDS.map((field) => ({ ...field }))
  };
}

/** Same plan, serialised for the Data Automation request body (EF-LEC-01). */
export function evidenceBlueprintJson(): string {
  return JSON.stringify(evidenceBlueprint(), null, 2);
}

/** True when every Annex B field is present exactly once in the plan. */
export function blueprintCoversAnnexB(blueprint: EvidenceBlueprint = evidenceBlueprint()): boolean {
  const names = blueprint.fields.map((field) => field.name);
  if (names.length !== EVIDENCE_FIELD_NAMES.length) return false;
  return EVIDENCE_FIELD_NAMES.every((name, index) => names[index] === name);
}
