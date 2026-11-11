/**
 * Framework import and version diff — EF-REF-01, EF-REF-02, EF-REF-05
 * (spec annex A, chapter 9.1).
 *
 * The import payload is validated and normalised by code before anything is
 * stored; a version change reports the controls added, changed or removed.
 */

import type {
  Control,
  ControlId,
  ControlInput,
  Framework,
  FrameworkImport
} from './types.ts';
import { badRequest } from '../support/errors.ts';
import { parseDuration } from '../support/iso8601.ts';

/** Result of a validated import: framework header plus normalised controls. */
export interface NormalisedImport {
  framework: Framework;
  controls: Control[];
}

/** One control added, changed or removed between two versions — EF-REF-05. */
export interface FrameworkDiff {
  added: ControlId[];
  changed: ControlId[];
  removed: ControlId[];
}

function requireText(value: string | undefined | null, field: string): string {
  const text = (value ?? '').trim();
  if (text.length === 0) throw badRequest(`framework import: "${field}" is required`, { field });
  return text;
}

/** Validates one control of an import payload — EF-REF-01. */
export function normaliseControl(input: ControlInput, frameworkId: string): Control {
  const id = requireText(input.id, 'controls[].id');
  const expectedEvidence = (input.expectedEvidence ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  if (expectedEvidence.length === 0) {
    throw badRequest(`framework import: control "${id}" has no expected evidence`, { controlId: id });
  }
  const periodicity = requireText(input.periodicity, `controls[${id}].periodicity`);
  parseDuration(periodicity);
  return {
    id,
    frameworkId,
    domain: requireText(input.domain, `controls[${id}].domain`),
    title: requireText(input.title, `controls[${id}].title`),
    requirement: requireText(input.requirement, `controls[${id}].requirement`),
    expectedEvidence,
    periodicity,
    owner: requireText(input.owner, `controls[${id}].owner`),
    mandatory: input.mandatory ?? false
  };
}

/**
 * Validates and normalises a framework import, rejecting duplicate ids —
 * EF-REF-01. `now` is injected so the import stays reproducible (ENF-IA-04).
 */
export function normaliseFrameworkImport(input: FrameworkImport, now: string): NormalisedImport {
  const frameworkId = requireText(input.framework?.id, 'framework.id');
  const controls = (input.controls ?? []).map((control) => normaliseControl(control, frameworkId));
  assertUniqueControlIds(controls);
  return {
    framework: {
      id: frameworkId,
      name: requireText(input.framework.name, 'framework.name'),
      version: requireText(input.framework.version, 'framework.version'),
      importedAt: now,
      confidentiality: input.framework.confidentiality ?? 'INTERNAL',
      source: input.framework.source
    },
    controls
  };
}

function assertUniqueControlIds(controls: readonly Control[]): void {
  const seen = new Set<string>();
  for (const control of controls) {
    if (seen.has(control.id)) {
      throw badRequest(`framework import: duplicate control id "${control.id}"`, { controlId: control.id });
    }
    seen.add(control.id);
  }
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** True when a control differs on title, requirement, expectations, periodicity, owner or flag — EF-REF-05. */
export function isControlChanged(previous: Control, next: Control): boolean {
  return (
    previous.title !== next.title ||
    previous.requirement !== next.requirement ||
    previous.owner !== next.owner ||
    previous.periodicity !== next.periodicity ||
    previous.mandatory !== next.mandatory ||
    previous.domain !== next.domain ||
    !sameList(previous.expectedEvidence, next.expectedEvidence)
  );
}

/** Lists the controls added, changed and removed between two versions — EF-REF-05. */
export function diffVersions(previous: readonly Control[], next: readonly Control[]): FrameworkDiff {
  const before = new Map(previous.map((control) => [control.id, control]));
  const after = new Map(next.map((control) => [control.id, control]));
  const added = [...after.keys()].filter((id) => !before.has(id)).sort();
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort();
  const changed = [...after.keys()]
    .filter((id) => {
      const oldControl = before.get(id);
      return oldControl !== undefined && isControlChanged(oldControl, after.get(id)!);
    })
    .sort();
  return { added, changed, removed };
}

/** True when a diff reports no change at all — EF-REF-05. */
export function isDiffEmpty(diff: FrameworkDiff): boolean {
  return diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0;
}
