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

import {
  CONTROL_STATE_ENUM,
  FRESHNESS_ENUM,
  SUFFICIENCY_ENUM,
  nullableString,
  stateRecord,
  stringSchema
} from './schemaPrimitives.ts';

export const FRAMEWORK_SCHEMAS = {
  Framework: {
    type: 'object',
    required: ['id', 'name', 'version', 'importedAt', 'confidentiality'],
    properties: {
      id: stringSchema,
      name: stringSchema,
      version: stringSchema,
      importedAt: { type: 'string', format: 'date-time' },
      confidentiality: { type: 'string', enum: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] },
      source: nullableString
    }
  },
  FrameworkList: {
    type: 'object',
    required: ['frameworks', 'total'],
    properties: {
      total: { type: 'integer' },
      frameworks: { type: 'array', items: { $ref: '#/components/schemas/Framework' } }
    }
  },
  FrameworkImport: {
    type: 'object',
    required: ['framework', 'controls'],
    properties: {
      framework: {
        type: 'object',
        required: ['id', 'name', 'version'],
        properties: {
          id: stringSchema,
          name: stringSchema,
          version: stringSchema,
          confidentiality: { type: 'string', enum: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] },
          source: stringSchema
        }
      },
      controls: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'domain', 'title', 'requirement', 'expectedEvidence', 'periodicity', 'owner'],
          properties: {
            id: stringSchema,
            domain: stringSchema,
            title: stringSchema,
            requirement: stringSchema,
            expectedEvidence: { type: 'array', items: stringSchema, minItems: 1 },
            periodicity: { type: 'string', examples: ['P3M', 'P1Y'] },
            owner: stringSchema,
            mandatory: { type: 'boolean' }
          }
        }
      }
    }
  },
  FrameworkImportResult: {
    type: 'object',
    required: ['framework', 'controls', 'diff'],
    properties: {
      framework: { $ref: '#/components/schemas/Framework' },
      controls: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: stringSchema,
            domain: stringSchema,
            title: stringSchema,
            periodicity: stringSchema,
            owner: stringSchema,
            mandatory: { type: 'boolean' }
          }
        }
      },
      diff: {
        type: ['object', 'null'],
        description: 'Controls added, changed or removed against the previous version (EF-REF-05).',
        properties: {
          added: { type: 'array', items: stringSchema },
          changed: { type: 'array', items: stringSchema },
          removed: { type: 'array', items: stringSchema }
        }
      }
    }
  },
  Control: {
    type: 'object',
    required: ['id', 'frameworkId', 'title', 'requirement', 'expectedEvidence', 'periodicity', 'owner'],
    properties: {
      id: stringSchema,
      frameworkId: stringSchema,
      domain: stringSchema,
      title: stringSchema,
      requirement: stringSchema,
      expectedEvidence: { type: 'array', items: stringSchema },
      periodicity: stringSchema,
      owner: stringSchema,
      mandatory: { type: 'boolean' },
      state: { type: ['string', 'null'], enum: [...CONTROL_STATE_ENUM, null] },
      freshness: { type: ['string', 'null'], enum: [...FRESHNESS_ENUM, null] },
      sufficiencyClass: { type: ['string', 'null'], enum: [...SUFFICIENCY_ENUM, null] },
      bestEvidenceId: nullableString,
      expiresAt: nullableString,
      pendingProposals: { type: 'integer' },
      notes: { type: 'array', items: stringSchema }
    }
  },
  ControlList: {
    type: 'object',
    required: ['frameworkId', 'total', 'controls'],
    properties: {
      frameworkId: stringSchema,
      total: { type: 'integer' },
      controls: { type: 'array', items: { $ref: '#/components/schemas/Control' } }
    }
  },
  ControlDetail: {
    type: 'object',
    required: ['control'],
    properties: {
      control: { $ref: '#/components/schemas/Control' },
      status: { oneOf: [{ $ref: '#/components/schemas/ControlStatus' }, { type: 'null' }] }
    }
  },
  ControlStatus: {
    type: 'object',
    properties: {
      controlId: stringSchema,
      frameworkId: stringSchema,
      state: { type: 'string', enum: [...CONTROL_STATE_ENUM] },
      freshness: { type: 'string', enum: [...FRESHNESS_ENUM] },
      sufficiencyClass: { type: ['string', 'null'], enum: [...SUFFICIENCY_ENUM, null] },
      bestEvidenceId: nullableString,
      expiresAt: nullableString,
      pendingProposals: { type: 'integer' },
      notes: { type: 'array', items: stringSchema },
      computedAt: { type: 'string', format: 'date-time' }
    }
  },
  Readiness: {
    type: 'object',
    required: ['frameworkId', 'computedAt', 'total', 'counts', 'shares', 'trend'],
    properties: {
      frameworkId: stringSchema,
      computedAt: { type: 'string', format: 'date-time' },
      total: { type: 'integer' },
      counts: stateRecord({ type: 'integer' }),
      shares: stateRecord({ type: 'number' }),
      trend: {
        type: 'array',
        items: {
          type: 'object',
          properties: { at: { type: 'string', format: 'date-time' }, counts: stateRecord({ type: 'integer' }) }
        }
      }
    }
  }
} as const;
