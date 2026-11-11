/**
 * OpenAPI component schemas, split by domain so every file stays readable.
 *
 * The shapes mirror `src/api/views.ts` exactly — a field renamed in a view must
 * be renamed here, and `test/api/openapi.test.ts` checks that the sixteen
 * operations of chapter 15 are all present with their error codes.
 *
 * Wording rule (ENF-IA-01): no schema, no example and no description qualifies
 * a control with the forbidden vocabulary. A control carries a `state` taken
 * from `ControlState` and nothing else.
 */

import { nullableInteger, nullableString, stringSchema } from './schemaPrimitives.ts';

export const OUTPUT_SCHEMAS = {
  AskRequest: {
    type: 'object',
    required: ['question'],
    properties: {
      question: { type: 'string', minLength: 3 },
      frameworkId: { type: 'string', description: 'Optional framework scope, checked when present.' }
    }
  },
  Answer: {
    type: 'object',
    required: ['question', 'text', 'citations', 'noEvidence'],
    properties: {
      question: stringSchema,
      text: stringSchema,
      citations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            evidenceId: stringSchema,
            title: nullableString,
            page: nullableInteger,
            documentDate: nullableString,
            quote: stringSchema
          }
        }
      },
      noEvidence: { type: 'boolean', description: 'True when no evidence grounds the answer (EF-QR-02).' },
      redacted: { type: 'boolean' },
      passagesUsed: { type: 'integer' },
      cost: { type: ['object', 'null'], additionalProperties: true }
    }
  },
  PackRequest: {
    type: 'object',
    properties: { freezeAt: { type: 'string', format: 'date-time' } }
  },
  Pack: {
    type: 'object',
    required: ['id', 'frameworkId', 'frozenAt', 'index', 'knownGaps', 'archive'],
    properties: {
      id: stringSchema,
      frameworkId: stringSchema,
      frozenAt: { type: 'string', format: 'date-time' },
      index: { type: 'array', items: { type: 'object', additionalProperties: true } },
      knownGaps: { type: 'array', items: { type: 'object', additionalProperties: true } },
      archive: { type: 'object', additionalProperties: true },
      checksumsVerified: { type: 'boolean' },
      downloadUrl: nullableString
    }
  },
  Reminder: {
    type: 'object',
    properties: {
      id: stringSchema,
      controlId: stringSchema,
      frameworkId: stringSchema,
      recipient: stringSchema,
      reason: { type: 'string', enum: ['EXPIRING_SOON', 'NO_EVIDENCE', 'MISSING_ELEMENTS'] },
      missing: { type: 'array', items: stringSchema },
      message: stringSchema,
      createdAt: { type: 'string', format: 'date-time' },
      expiresAt: nullableString,
      status: { type: 'string', enum: ['SENT', 'ACKNOWLEDGED', 'CLOSED'] },
      channel: stringSchema
    }
  },
  ReminderArray: {
    type: 'array',
    items: { $ref: '#/components/schemas/Reminder' }
  },
  PackArray: {
    type: 'array',
    items: { $ref: '#/components/schemas/Pack' }
  },
  CostReport: {
    type: 'object',
    required: ['totalUsd', 'perEvidenceUsd', 'evidenceCount', 'bySource'],
    properties: {
      totalUsd: { type: 'number' },
      perEvidenceUsd: { type: 'number' },
      evidenceCount: { type: 'integer' },
      bySource: { type: 'object', additionalProperties: { type: 'number' } }
    }
  },
  RemindRequest: {
    type: 'object',
    properties: {
      reason: { type: 'string', enum: ['EXPIRING_SOON', 'NO_EVIDENCE', 'MISSING_ELEMENTS'] }
    }
  },
  AuditEvent: {
    type: 'object',
    properties: {
      seq: { type: 'integer' },
      id: stringSchema,
      at: { type: 'string', format: 'date-time' },
      actor: stringSchema,
      action: stringSchema,
      objectType: stringSchema,
      objectId: stringSchema,
      detail: { type: 'object', additionalProperties: true },
      prevHash: stringSchema,
      hash: stringSchema
    }
  },
  AuditPage: {
    type: 'object',
    required: ['total', 'limit', 'offset', 'events'],
    properties: {
      total: { type: 'integer' },
      limit: { type: 'integer' },
      offset: { type: 'integer' },
      nextOffset: nullableInteger,
      events: { type: 'array', items: { $ref: '#/components/schemas/AuditEvent' } },
      chain: {
        type: 'object',
        description: 'Present with ?verify=chain: the hash chain verdict (ENF-INT-02).',
        properties: { ok: { type: 'boolean' }, brokenAt: nullableInteger }
      }
    }
  }
} as const;
