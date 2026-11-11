/**
 * DynamoDB single-table schema — the only place where key shapes are decided.
 *
 * One table, `PK`/`SK`, and three global secondary indexes.
 *
 *  - **primary key**: the entity itself (`PK = <TYPE>#<id>`, `SK = META`) or the
 *    children of an aggregate (`PK = FRAMEWORK#<id>`, `SK = CONTROL#…` /
 *    `TREND#…` / `STATUS` / `TYPE_VALIDATION#…`). One query returns a whole
 *    framework with its controls, statuses and trend: no join, no scan.
 *  - **GSI1 "scope"**: every "everything about X" question, over one overloaded
 *    attribute pair. `GSI1SK` starts with the entity type, so
 *    `begins_with(GSI1SK, 'REMINDER#')` lists only reminders of a control.
 *    Values: `CONTROL#<id>`, `FRAMEWORK#<id>`, `EVIDENCE#<id>`, `HASH#<sha256>`,
 *    `VALIDATION`.
 *  - **GSI2 "list"**: global time-ordered listings (`LIST#EVIDENCE`,
 *    `LIST#FRAMEWORK`) for dashboards, and the attachments of a control.
 *  - **GSI3 "status"**: direct lookup of a queue by status
 *    (`ATTACHMENT#APPLIED`, `REMINDER#SENT`), which avoids a scan for
 *    "all pending items" and gives the validation screen one query per state.
 *
 * The entity payload lives in a `data` attribute as canonical JSON: the domain
 * model in `src/domain/types.ts` stays the single source of truth and a model
 * change never needs a table migration. Every filter and every count is applied
 * by code (ENF-IA-04).
 *
 * Requirement references: chapter 14 (data model), EF-FRA-04, EF-VAL-01,
 * EF-DOS-03, EF-ADM-01, EF-REL-01/02, ENF-INT-02.
 */

import type {
  Attachment,
  Control,
  ControlId,
  ControlStatus,
  Evidence,
  EvidenceId,
  FrameworkId,
  PackId,
  Reminder,
  ReminderId,
  Sufficiency,
  ValidationItem
} from '../domain/types.ts';

/* --------------------------------------------------------------- config */

export const TABLE_ENV = 'REGISTRE_TABLE';
export const REGION_ENV = 'REGISTRE_REGION';
export const ENDPOINT_ENV = 'REGISTRE_DYNAMO_ENDPOINT';
export const DEFAULT_TABLE = 'registre';
export const DEFAULT_REGION = 'eu-central-1';

export interface DynamoConfig {
  table: string;
  region: string;
  /** Set for DynamoDB Local; omitted against the real service. */
  endpoint?: string;
}

/** Table name and region come from the environment (deployment contract). */
export function dynamoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DynamoConfig {
  const endpoint = env[ENDPOINT_ENV];
  return {
    table: env[TABLE_ENV] ?? DEFAULT_TABLE,
    region: env[REGION_ENV] ?? env.AWS_REGION ?? DEFAULT_REGION,
    ...(endpoint === undefined || endpoint.length === 0 ? {} : { endpoint })
  };
}

/* ----------------------------------------------------------- key shapes */

/** Names of the three secondary indexes, as declared by the infrastructure. */
export const INDEX_NAMES = { scope: 'gsi1', list: 'gsi2', status: 'gsi3' } as const;

/** Entity discriminator stored next to the payload. */
export type EntityKind =
  | 'FRAMEWORK'
  | 'CONTROL'
  | 'EVIDENCE'
  | 'ATTACHMENT'
  | 'SUFFICIENCY'
  | 'STATUS'
  | 'TREND'
  | 'REMINDER'
  | 'VALIDATION'
  | 'PACK'
  | 'SETTINGS'
  | 'TYPE_VALIDATION'
  | 'AUDIT'
  | 'SHARE'
  | 'MAPPING'
  | 'DRIFT'
  | 'QUALITY'
  | 'VERIFICATION';

export interface DynamoKeys {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  GSI3PK?: string;
  GSI3SK?: string;
}

/**
 * One row of the single table. Every attribute is a string: the keys, the
 * entity discriminator, and `data`, which holds the entity as canonical JSON.
 */
export interface DynamoItem {
  PK: string;
  SK: string;
  entity: EntityKind;
  data?: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
  GSI3PK?: string;
  GSI3SK?: string;
}

/** Attribute names used by the indexes (must match the CDK table). */
export const ATTRS = {
  pk: 'PK',
  sk: 'SK',
  gsi1pk: 'GSI1PK',
  gsi1sk: 'GSI1SK',
  gsi2pk: 'GSI2PK',
  gsi2sk: 'GSI2SK',
  gsi3pk: 'GSI3PK',
  gsi3sk: 'GSI3SK'
} as const;

/* ------------------------------------------------------------ builders */

/** Keys of a plain item: `PK` plus `SK` (defaults to `META`). */
export function itemKeys(pk: string, sk = 'META'): DynamoKeys {
  return { PK: pk, SK: sk };
}

/** Framework header, also the parent partition of its controls and trend. */
export function frameworkKeys(id: FrameworkId): DynamoKeys {
  return { PK: `FRAMEWORK#${id}`, SK: 'META', GSI2PK: 'LIST#FRAMEWORK', GSI2SK: id };
}

/** One control, stored under its framework partition (EF-REF-01). */
export function controlKeys(control: Pick<Control, 'id' | 'frameworkId'>): DynamoKeys {
  return {
    PK: `FRAMEWORK#${control.frameworkId}`,
    SK: `CONTROL#${control.id}`,
    GSI1PK: `CONTROL#${control.id}`,
    GSI1SK: 'META'
  };
}

/** One evidence, indexed by fingerprint for the duplicate check (R8). */
export function evidenceKeys(evidence: Pick<Evidence, 'id' | 'sha256' | 'ingestedAt'>): DynamoKeys {
  return {
    PK: `EVIDENCE#${evidence.id}`,
    SK: 'META',
    GSI1PK: `HASH#${evidence.sha256}`,
    GSI1SK: `EVIDENCE#${evidence.id}`,
    GSI2PK: 'LIST#EVIDENCE',
    GSI2SK: `${evidence.ingestedAt}#${evidence.id}`
  };
}

/** One attachment: by evidence, by control, and by status (chapter 14). */
export function attachmentKeys(
  attachment: Pick<Attachment, 'id' | 'evidenceId' | 'controlId' | 'status' | 'createdAt'>
): DynamoKeys {
  return {
    PK: `ATTACHMENT#${attachment.id}`,
    SK: 'META',
    GSI1PK: `EVIDENCE#${attachment.evidenceId}`,
    GSI1SK: `ATTACHMENT#${attachment.createdAt}#${attachment.id}`,
    GSI2PK: `CONTROL#${attachment.controlId}`,
    GSI2SK: `ATTACHMENT#${attachment.createdAt}#${attachment.id}`,
    GSI3PK: `ATTACHMENT#${attachment.status}`,
    GSI3SK: `${attachment.createdAt}#${attachment.id}`
  };
}

/** Sufficiency of one attachment, one per attachment (Annex D). */
export function sufficiencyKeys(
  sufficiency: Pick<Sufficiency, 'attachmentId' | 'controlId' | 'computedAt'>
): DynamoKeys {
  return {
    PK: `ATTACHMENT#${sufficiency.attachmentId}`,
    SK: 'SUFFICIENCY',
    GSI1PK: `CONTROL#${sufficiency.controlId}`,
    GSI1SK: `SUFFICIENCY#${sufficiency.computedAt}#${sufficiency.attachmentId}`
  };
}

/** Latest computed state of one control (EF-FRA-02). */
export function statusKeys(status: Pick<ControlStatus, 'controlId' | 'frameworkId'>): DynamoKeys {
  return {
    PK: `CONTROL#${status.controlId}`,
    SK: 'STATUS',
    GSI1PK: `FRAMEWORK#${status.frameworkId}`,
    GSI1SK: `STATUS#${status.controlId}`
  };
}

/** One readiness point of the framework history (EF-FRA-04). */
export function trendKeys(frameworkId: FrameworkId, at: string, fingerprint: string): DynamoKeys {
  return { PK: `FRAMEWORK#${frameworkId}`, SK: `TREND#${at}#${fingerprint}` };
}

/** One reminder: by control, and by status for the reminder screen. */
export function reminderKeys(reminder: Pick<Reminder, 'id' | 'controlId' | 'status' | 'createdAt'>): DynamoKeys {
  return {
    PK: `REMINDER#${reminder.id}`,
    SK: 'META',
    GSI1PK: `CONTROL#${reminder.controlId}`,
    GSI1SK: `REMINDER#${reminder.createdAt}#${reminder.id}`,
    GSI3PK: `REMINDER#${reminder.status}`,
    GSI3SK: `${reminder.createdAt}#${reminder.id}`
  };
}

/** One validation-queue item (EF-VAL-01/02). */
export function validationKeys(item: Pick<ValidationItem, 'id' | 'status' | 'createdAt'>): DynamoKeys {
  return {
    PK: `VALIDATION#${item.id}`,
    SK: 'META',
    GSI1PK: 'VALIDATION',
    GSI1SK: `VALIDATION#${item.status}#${item.createdAt}#${item.id}`
  };
}

/** One frozen audit pack (EF-DOS-03). */
export function packKeys(pack: { id: PackId; frameworkId: FrameworkId; frozenAt: string }): DynamoKeys {
  return {
    PK: `PACK#${pack.id}`,
    SK: 'META',
    GSI1PK: `FRAMEWORK#${pack.frameworkId}`,
    GSI1SK: `PACK#${pack.frozenAt}#${pack.id}`
  };
}

/** The single settings row of the deployment (EF-ADM-01). */
export function settingsKeys(): DynamoKeys {
  return itemKeys('SETTINGS');
}

/** Human approval of a (control, evidence type) pair (EF-SUF-03). */
export function typeValidationKeys(controlId: ControlId, evidenceType: string): DynamoKeys {
  return itemKeys(`CONTROL#${controlId}`, `TYPE_VALIDATION#${evidenceType.trim().toUpperCase()}`);
}

/** One audit event; the sort key is zero-padded so lexical order is numeric. */
export function auditKeys(seq: number): DynamoKeys {
  return itemKeys('AUDIT', `EVENT#${String(seq).padStart(10, '0')}`);
}

/** Primary key of one evidence by id, without knowing its fingerprint. */
export function evidenceLookupKeys(id: EvidenceId): DynamoKeys {
  return itemKeys(`EVIDENCE#${id}`);
}

/** Primary key of one reminder by id. */
export function reminderLookupKeys(id: ReminderId): DynamoKeys {
  return itemKeys(`REMINDER#${id}`);
}

/* ------------------------------------------------------------- queries */

/** Partition/sort attribute names for one query target. */
export interface QueryTarget {
  index?: string;
  pkAttr: string;
  skAttr: string;
}

export const QUERY_TARGETS = {
  primary: { pkAttr: ATTRS.pk, skAttr: ATTRS.sk },
  scope: { index: INDEX_NAMES.scope, pkAttr: ATTRS.gsi1pk, skAttr: ATTRS.gsi1sk },
  list: { index: INDEX_NAMES.list, pkAttr: ATTRS.gsi2pk, skAttr: ATTRS.gsi2sk },
  status: { index: INDEX_NAMES.status, pkAttr: ATTRS.gsi3pk, skAttr: ATTRS.gsi3sk }
} as const satisfies Record<string, QueryTarget>;

/** Values of the overloaded `GSI1PK` attribute, one per access path. */
export const SCOPE = {
  control: (id: ControlId): string => `CONTROL#${id}`,
  framework: (id: FrameworkId): string => `FRAMEWORK#${id}`,
  evidence: (id: EvidenceId): string => `EVIDENCE#${id}`,
  hash: (sha256: string): string => `HASH#${sha256}`,
  validation: 'VALIDATION'
} as const;

/* Keys of the three extensions (share grants, mappings, drifts, quality). */

/** A share grant: `PK=SHARE#<token>`, and a scope row for the pack listing. */
export function shareKeys(token: string): DynamoKeys {
  return itemKeys(`SHARE#${token}`);
}

/** A cross-framework mapping: `PK=MAPPING#<id>`. */
export function mappingKeys(id: string): DynamoKeys {
  return itemKeys(`MAPPING#${id}`);
}

/** A drift event: `PK=DRIFT#<id>`. */
export function driftKeys(id: string): DynamoKeys {
  return itemKeys(`DRIFT#${id}`);
}

/** A quality record: `PK=QUALITY#<subjectKey>`, sorted by measurement instant. */
export function qualityKeys(subjectKey: string, measuredAt: string, id: string): DynamoKeys {
  return itemKeys(`QUALITY#${subjectKey}`, `${measuredAt}#${id}`);
}

/** A verification result: `PK=VERIFICATION#<packId>`, sorted by instant. */
export function verificationKeys(packId: string, verifiedAt: string): DynamoKeys {
  return itemKeys(`VERIFICATION#${packId}`, verifiedAt);
}

/** Partition holding every row of one extension entity kind, for listings. */
export const EXTENSION_PARTITION = {
  shares: 'SHARES',
  mappings: 'MAPPINGS',
  drifts: 'DRIFTS',
  verifications: 'VERIFICATIONS',
  quality: 'QUALITY'
} as const;

/** Every value a status-partitioned queue can take (used to merge listings). */
export const QUEUE_STATUSES = {
  attachment: ['PROPOSED', 'APPLIED', 'REJECTED'] as const,
  reminder: ['SENT', 'ACKNOWLEDGED', 'CLOSED'] as const
};
