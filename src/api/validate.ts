/**
 * Request validation: one place that turns untyped JSON and query strings into
 * typed values, and answers `BAD_REQUEST` (400) when it cannot.
 *
 * The domain validates semantics (periodicity, duplicate ids, empty expected
 * evidence); this file validates shapes, so a malformed body never reaches the
 * pipeline as a half-built object.
 */

import type { ControlInput, FrameworkImport } from '../domain/types.ts';
import { badRequest } from '../support/errors.ts';

/** A JSON object, or `BAD_REQUEST`. */
export function objectBody(value: unknown, field = 'body'): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest(`"${field}" must be a JSON object`, { field });
  }
  return value as Record<string, unknown>;
}

/** A non-empty trimmed string field, or `BAD_REQUEST`. */
export function requiredString(
  source: Record<string, unknown>,
  field: string,
  minLength = 1
): string {
  const value = source[field];
  if (typeof value !== 'string') throw badRequest(`"${field}" is required and must be a string`, { field });
  const text = value.trim();
  if (text.length < minLength) {
    throw badRequest(`"${field}" must be at least ${minLength} character(s)`, { field, minLength });
  }
  return text;
}

/** An optional trimmed string field; empty strings are treated as absent. */
export function optionalString(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`, { field });
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

/** One value of a closed list, or `BAD_REQUEST` (case-insensitive). */
export function requiredEnum<T extends string>(
  source: Record<string, unknown>,
  field: string,
  values: readonly T[]
): T {
  const text = requiredString(source, field).toUpperCase();
  const match = values.find((value) => value.toUpperCase() === text);
  if (match === undefined) {
    throw badRequest(`"${field}" must be one of: ${values.join(', ')}`, { field, values });
  }
  return match;
}

/** A non-empty array of strings, or `BAD_REQUEST`. */
export function stringArray(source: Record<string, unknown>, field: string): string[] {
  const value = source[field];
  if (!Array.isArray(value)) throw badRequest(`"${field}" must be an array of strings`, { field });
  return value.map((item) => {
    if (typeof item !== 'string') throw badRequest(`"${field}" must contain strings only`, { field });
    return item;
  });
}

/** Raw query value; absent when missing or empty. */
export function queryValue(query: Readonly<Record<string, string>>, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

/** Integer query parameter with bounds; anything else is `BAD_REQUEST`. */
export function queryInt(
  query: Readonly<Record<string, string>>,
  name: string,
  options: { fallback: number; min: number; max: number }
): number {
  const raw = queryValue(query, name);
  if (raw === undefined) return options.fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw badRequest(`query "${name}" must be an integer`, { name, raw });
  if (parsed < options.min || parsed > options.max) {
    throw badRequest(`query "${name}" must be between ${options.min} and ${options.max}`, {
      name,
      raw,
      min: options.min,
      max: options.max
    });
  }
  return parsed;
}

/** Closed-list query parameter (case-insensitive); `BAD_REQUEST` otherwise. */
export function queryEnum<T extends string>(
  query: Readonly<Record<string, string>>,
  name: string,
  values: readonly T[]
): T | undefined {
  const raw = queryValue(query, name);
  if (raw === undefined) return undefined;
  const match = values.find((value) => value.toUpperCase() === raw.toUpperCase());
  if (match === undefined) {
    throw badRequest(`query "${name}" must be one of: ${values.join(', ')}`, { name, values });
  }
  return match;
}

/** One control of an Annex A import payload. */
function controlInputFrom(value: unknown, index: number): ControlInput {
  const field = `controls[${index}]`;
  const source = objectBody(value, field);
  return {
    id: requiredString(source, 'id'),
    domain: requiredString(source, 'domain'),
    title: requiredString(source, 'title'),
    requirement: requiredString(source, 'requirement'),
    expectedEvidence: stringArray(source, 'expectedEvidence'),
    periodicity: requiredString(source, 'periodicity'),
    owner: requiredString(source, 'owner'),
    mandatory: source.mandatory === true
  };
}

/** Validates the Annex A import payload of `POST /v1/frameworks` (EF-REF-01). */
export function frameworkImportFrom(value: unknown): FrameworkImport {
  const source = objectBody(value);
  const header = objectBody(source.framework, 'framework');
  const controls = source.controls;
  if (!Array.isArray(controls) || controls.length === 0) {
    throw badRequest('"controls" must be a non-empty array', { field: 'controls' });
  }
  const confidentiality = optionalString(header, 'confidentiality');
  if (confidentiality !== undefined && !['PUBLIC', 'INTERNAL', 'RESTRICTED'].includes(confidentiality)) {
    throw badRequest('"framework.confidentiality" must be PUBLIC, INTERNAL or RESTRICTED', {
      field: 'framework.confidentiality'
    });
  }
  return {
    framework: {
      id: requiredString(header, 'id'),
      name: requiredString(header, 'name'),
      version: requiredString(header, 'version'),
      confidentiality: confidentiality as FrameworkImport['framework']['confidentiality'],
      source: optionalString(header, 'source')
    },
    controls: controls.map(controlInputFrom)
  };
}
