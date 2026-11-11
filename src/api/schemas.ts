/**
 * OpenAPI components: the response schemas and the shared error responses.
 *
 * The shapes mirror `src/api/views.ts` exactly — a field renamed in a view must
 * be renamed here, and `test/api/openapi.test.ts` checks that the sixteen
 * operations of chapter 15 are all present with their error codes.
 *
 * Wording rule (ENF-IA-01): no schema, no example and no description qualifies
 * a control with the forbidden vocabulary. A control carries a `state` taken
 * from `ControlState` and nothing else.
 */

import { stringSchema } from './schemaPrimitives.ts';
import { FRAMEWORK_SCHEMAS } from './schemasFrameworks.ts';
import { EVIDENCE_SCHEMAS } from './schemasEvidence.ts';
import { OUTPUT_SCHEMAS } from './schemasOutput.ts';
import { EXTENSION_SCHEMAS } from './schemasExt.ts';

/** Schemas shared by several operations: errors, health and settings. */
const SHARED = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['code', 'message', 'detail'],
        properties: {
          code: {
            type: 'string',
            enum: [
              'BAD_REQUEST',
              'NOT_FOUND',
              'CONFLICT',
              'FORBIDDEN',
              'UNAUTHENTICATED',
              'METHOD_NOT_ALLOWED',
              'PAYLOAD_TOO_LARGE',
              'UNREADABLE',
              'UPSTREAM',
              'CONFIG',
              'INTERNAL'
            ]
          },
          message: stringSchema,
          detail: { type: 'object', additionalProperties: true }
        }
      }
    }
  },
  Health: {
    type: 'object',
    required: ['status', 'version', 'at'],
    properties: {
      status: { type: 'string', enum: ['ok'] },
      version: stringSchema,
      at: { type: 'string', format: 'date-time' },
      region: stringSchema
    }
  },
  Principal: {
    type: 'object',
    required: ['id', 'name', 'email', 'role', 'clearance', 'ownedControls'],
    properties: {
      id: stringSchema,
      name: stringSchema,
      email: stringSchema,
      role: { type: 'string', enum: ['QUALITY_LEAD', 'CONTROL_OWNER', 'EXECUTIVE', 'INTERNAL_AUDITOR', 'ADMIN'] },
      clearance: { type: 'string', enum: ['PUBLIC', 'INTERNAL', 'RESTRICTED'] },
      ownedControls: { type: 'array', items: stringSchema }
    }
  },
  SessionRequest: {
    type: 'object',
    required: ['login', 'password'],
    properties: {
      login: stringSchema,
      password: { type: 'string', format: 'password' }
    }
  },
  Session: {
    type: 'object',
    required: ['token', 'principal'],
    properties: {
      token: stringSchema,
      principal: { $ref: '#/components/schemas/Principal' }
    }
  },
  SessionAccount: {
    type: 'object',
    required: ['login', 'role', 'name'],
    properties: {
      login: stringSchema,
      role: stringSchema,
      name: stringSchema
    }
  },
  SessionAccountArray: {
    type: 'array',
    items: { $ref: '#/components/schemas/SessionAccount' }
  },
  Settings: {
    type: 'object',
    properties: {
      confidenceThreshold: { type: 'number', minimum: 0, maximum: 1 },
      reminderLeadDays: { type: 'integer', minimum: 0 },
      defaultPeriodicity: { type: 'string', examples: ['P1Y'] },
      region: stringSchema,
      retentionMonths: { type: 'integer', minimum: 1 },
      readerModel: stringSchema,
      reasoningModel: stringSchema,
      answerModel: stringSchema,
      guardrailId: { type: ['string', 'null'] },
      nightlyServiceTier: { type: 'string', enum: ['FLEX', 'STANDARD'] }
    }
  },
  SettingsPatch: {
    type: 'object',
    description: 'Any subset of Settings; absent fields keep their current value.',
    properties: {
      confidenceThreshold: { type: 'number', minimum: 0, maximum: 1 },
      reminderLeadDays: { type: 'integer', minimum: 0, maximum: 365 },
      defaultPeriodicity: { type: 'string', examples: ['P3M'] },
      retentionMonths: { type: 'integer', minimum: 1, maximum: 120 },
      nightlyServiceTier: { type: 'string', enum: ['FLEX', 'STANDARD'] }
    },
    additionalProperties: true
  }
} as const;

/** Every component schema of the document. */
export const COMPONENT_SCHEMAS: Record<string, unknown> = {
  ...SHARED,
  ...FRAMEWORK_SCHEMAS,
  ...EVIDENCE_SCHEMAS,
  ...OUTPUT_SCHEMAS,
  ...EXTENSION_SCHEMAS
};

/** The single error body, reused by every operation. */
const errorResponse = (description: string): Record<string, unknown> => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
});

/** Error responses keyed by HTTP status. */
export const ERROR_RESPONSES: Readonly<Record<number, Record<string, unknown>>> = {
  400: errorResponse('Malformed request: body, query, periodicity or forbidden wording (ENF-IA-01).'),
  401: errorResponse('No credential, or an unknown one (EF-ADM-03).'),
  403: errorResponse('Role not allowed, or access level above the caller clearance (ENF-CONF-01).'),
  404: errorResponse('Unknown framework, control, evidence, pack or validation item.'),
  409: errorResponse('Conflicting state: version already imported, decision already recorded.'),
  413: errorResponse('Request body above the configured limit.'),
  422: errorResponse('Evidence cannot be read: corrupt or unsupported document.'),
  502: errorResponse('Upstream failure: Bedrock, DynamoDB, S3 or SES.')
};
