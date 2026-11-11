/**
 * Schema primitives shared by the OpenAPI components.
 *
 * Kept apart from the schemas themselves so every schema file uses the same
 * fragments — one implementation per shape, no drift.
 */

/** A plain string schema. */
export const stringSchema = { type: 'string' } as const;

/** A string that may be absent. */
export const nullableString = { type: ['string', 'null'] } as const;

/** An integer that may be absent. */
export const nullableInteger = { type: ['integer', 'null'] } as const;

/** The five control states of chapter 12.3 (never a judgement). */
export const CONTROL_STATE_ENUM = ['COVERED', 'TO_RENEW', 'TO_VERIFY', 'EXPIRED', 'NO_EVIDENCE'] as const;

/** Freshness of one evidence against a periodicity. */
export const FRESHNESS_ENUM = ['FRESH', 'TO_RENEW', 'EXPIRED', 'UNDETERMINED'] as const;

/** Sufficiency classes of Annex D. */
export const SUFFICIENCY_ENUM = ['COMPLETE', 'PARTIAL', 'TO_VERIFY'] as const;

/** Counts or shares keyed by control state. */
export function stateRecord(valueSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'object',
    required: [...CONTROL_STATE_ENUM],
    properties: Object.fromEntries(CONTROL_STATE_ENUM.map((state) => [state, valueSchema]))
  };
}
