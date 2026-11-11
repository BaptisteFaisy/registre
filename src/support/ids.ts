/**
 * Deterministic identifiers. The demo and the tests must be reproducible, so
 * ids are derived from content instead of random UUIDs (except `newUid`, used
 * only for audit events where uniqueness matters more than stability).
 */

import { randomUUID } from 'node:crypto';
import { sha256Text } from './hash.ts';

/** `ev-<12 hex>` derived from the file fingerprint. */
export function evidenceId(sha256: string): string {
  return `ev-${sha256.slice(0, 12)}`;
}

/** `at-<12 hex>` derived from the (evidence, control) pair. */
export function attachmentId(evidenceIdValue: string, controlId: string): string {
  return `at-${sha256Text(`${evidenceIdValue}|${controlId}`).slice(0, 12)}`;
}

/** `sf-<12 hex>` derived from an attachment id. */
export function sufficiencyId(attachmentIdValue: string): string {
  return `sf-${sha256Text(attachmentIdValue).slice(0, 12)}`;
}

/** `rm-<12 hex>` derived from control + reason + day, so a day yields one reminder. */
export function reminderId(controlId: string, reason: string, day: string): string {
  return `rm-${sha256Text(`${controlId}|${reason}|${day}`).slice(0, 12)}`;
}

/** `pk-<12 hex>` derived from framework + freeze instant. */
export function packId(frameworkId: string, frozenAt: string): string {
  return `pk-${sha256Text(`${frameworkId}|${frozenAt}`).slice(0, 12)}`;
}

/** `va-<12 hex>` derived from kind + referenced object. */
export function validationId(kind: string, refId: string): string {
  return `va-${sha256Text(`${kind}|${refId}`).slice(0, 12)}`;
}

/** Random unique id (audit events). */
export function newUid(prefix = 'id'): string {
  return `${prefix}-${randomUUID()}`;
}
