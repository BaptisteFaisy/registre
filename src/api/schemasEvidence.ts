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

import { SUFFICIENCY_ENUM, nullableInteger, nullableString, stringSchema } from './schemaPrimitives.ts';

export const EVIDENCE_SCHEMAS = {
  EvidenceDeposit: {
    type: 'object',
    required: ['contentBase64'],
    properties: {
      filename: stringSchema,
      contentType: stringSchema,
      contentBase64: { type: 'string', contentEncoding: 'base64' },
      frameworkId: stringSchema,
      controlId: stringSchema,
      fileDate: { type: 'string', format: 'date' }
    }
  },
  Evidence: {
    type: 'object',
    required: ['id', 'sha256', 'accessLevel'],
    properties: {
      id: stringSchema,
      sha256: stringSchema,
      revision: { type: 'integer' },
      fields: { type: 'object', additionalProperties: true },
      flags: { type: 'object', additionalProperties: true },
      accessLevel: { type: 'string', enum: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] },
      locations: { type: 'array', items: { type: 'object', additionalProperties: true } },
      textPages: { type: 'array', items: { type: 'object', additionalProperties: true } },
      sizeBytes: { type: 'integer' },
      contentType: stringSchema,
      ingestedAt: { type: 'string', format: 'date-time' },
      reader: stringSchema,
      cost: { type: ['object', 'null'], additionalProperties: true },
      excerptsMasked: { type: 'boolean', description: 'True when excerpts were masked for this caller.' }
    }
  },
  Attachment: {
    type: 'object',
    required: ['id', 'evidenceId', 'controlId', 'frameworkId', 'supports', 'confidence', 'quote', 'status'],
    properties: {
      id: stringSchema,
      evidenceId: stringSchema,
      controlId: stringSchema,
      frameworkId: stringSchema,
      supports: { type: 'boolean' },
      confidence: { type: 'number' },
      quote: stringSchema,
      quoteLocation: {
        type: 'object',
        required: ['page'],
        properties: { page: nullableInteger }
      },
      reason: stringSchema,
      status: { type: 'string', enum: ['PROPOSED', 'APPLIED', 'REJECTED'] },
      citationVerified: { type: 'boolean' },
      autoApplied: { type: 'boolean' },
      model: stringSchema,
      createdAt: { type: 'string', format: 'date-time' },
      rejectionReason: nullableString,
      decidedBy: nullableString,
      decidedAt: nullableString,
      decidedNote: nullableString
    }
  },
  Sufficiency: {
    type: 'object',
    required: ['id', 'attachmentId', 'evidenceId', 'controlId', 'elements', 'class', 'missing', 'computedAt'],
    properties: {
      id: stringSchema,
      attachmentId: stringSchema,
      evidenceId: stringSchema,
      controlId: stringSchema,
      elements: {
        type: 'array',
        items: {
          type: 'object',
          required: ['expected', 'present', 'quote'],
          properties: {
            expected: stringSchema,
            present: { type: 'boolean' },
            quote: nullableString
          }
        }
      },
      class: { type: 'string', enum: [...SUFFICIENCY_ENUM] },
      missing: { type: 'array', items: stringSchema },
      computedAt: { type: 'string', format: 'date-time' }
    }
  },
  EvidenceArray: {
    type: 'array',
    items: { $ref: '#/components/schemas/Evidence' }
  },
  ValidationItem: {
    type: 'object',
    properties: {
      id: stringSchema,
      kind: { type: 'string', enum: ['ATTACHMENT', 'SUFFICIENCY', 'UNREADABLE_EVIDENCE'] },
      attachmentId: nullableString,
      evidenceId: nullableString,
      controlId: nullableString,
      reason: stringSchema,
      createdAt: { type: 'string', format: 'date-time' },
      status: { type: 'string', enum: ['PENDING', 'DECIDED'] },
      decision: { type: ['string', 'null'], enum: ['ACCEPT', 'REJECT', 'CORRECT', null] },
      decidedBy: nullableString,
      decidedAt: nullableString,
      note: nullableString
    }
  },
  ValidationItemArray: {
    type: 'array',
    items: { $ref: '#/components/schemas/ValidationItem' }
  },
  DecisionRequest: {
    type: 'object',
    required: ['decision'],
    properties: {
      decision: { type: 'string', enum: ['ACCEPT', 'REJECT', 'CORRECT'] },
      note: stringSchema,
      controlId: { type: 'string', description: 'Required when decision is CORRECT.' }
    }
  },
  DecisionResult: {
    type: 'object',
    required: ['item', 'controls'],
    properties: {
      item: { $ref: '#/components/schemas/ValidationItem' },
      controls: { type: 'array', items: { $ref: '#/components/schemas/Control' } }
    }
  }
} as const;
