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

import { nullableString, stringSchema } from './schemaPrimitives.ts';

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
  EvidenceDepositResult: {
    type: 'object',
    required: ['evidenceId', 'sha256', 'duplicate', 'accessLevel'],
    properties: {
      evidenceId: stringSchema,
      sha256: stringSchema,
      revision: { type: 'integer' },
      duplicate: { type: 'boolean', description: 'True when the fingerprint was already stored (R8).' },
      accessLevel: { type: 'string', enum: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] },
      contentType: stringSchema,
      sizeBytes: { type: 'integer' },
      ingestedAt: { type: 'string', format: 'date-time' },
      flags: { type: 'object', additionalProperties: true },
      locations: { type: 'array', items: { type: 'object', additionalProperties: true } }
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
    properties: {
      attachmentId: stringSchema,
      evidenceId: stringSchema,
      controlId: stringSchema,
      frameworkId: stringSchema,
      status: { type: 'string', enum: ['PROPOSED', 'APPLIED', 'REJECTED'] },
      supports: { type: 'boolean' },
      confidence: { type: 'number' },
      quote: stringSchema,
      quoteLocation: { type: 'object', additionalProperties: true },
      citationVerified: { type: 'boolean' },
      autoApplied: { type: 'boolean' },
      reason: stringSchema,
      rejectionReason: nullableString,
      createdAt: { type: 'string', format: 'date-time' },
      decidedBy: nullableString,
      decidedAt: nullableString,
      sufficiency: { type: ['object', 'null'], additionalProperties: true },
      title: nullableString,
      documentDate: nullableString
    }
  },
  AttachmentList: {
    type: 'object',
    required: ['controlId', 'attachments'],
    properties: {
      controlId: stringSchema,
      total: { type: 'integer' },
      attachments: { type: 'array', items: { $ref: '#/components/schemas/Attachment' } }
    }
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
  ValidationQueue: {
    type: 'object',
    required: ['status', 'total', 'items'],
    properties: {
      status: { type: 'string', enum: ['PENDING', 'DECIDED'] },
      total: { type: 'integer' },
      items: { type: 'array', items: { $ref: '#/components/schemas/ValidationItem' } }
    }
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
