/**
 * OpenAPI component schemas of the three extensions and of measured quality.
 *
 * Shapes mirror `src/api/viewsExt.ts` exactly: a field renamed in a view must be
 * renamed here, and `test/api/openapi.test.ts` fails on any component a route
 * references but nothing defines.
 */

import { nullableInteger, nullableString, stringSchema } from './schemaPrimitives.ts';

const BOOL = { type: 'boolean' } as const;
const INT = { type: 'integer' } as const;
const NUM = { type: 'number' } as const;
const INSTANT = { type: 'string', format: 'date-time' } as const;
const STRING_ARRAY = { type: 'array', items: stringSchema } as const;

/** Reference helper, so no path is typed twice. */
function ref(name: string): Record<string, string> {
  return { $ref: `#/components/schemas/${name}` };
}

function arrayOf(name: string): Record<string, unknown> {
  return { type: 'array', items: ref(name) };
}

export const EXTENSION_SCHEMAS = {
  VerificationResult: {
    type: 'object',
    required: [
      'packId',
      'frameworkId',
      'verifiedAt',
      'frozenAt',
      'rootHash',
      'controlCount',
      'evidenceCount',
      'knownGapCount',
      'checksumsOk',
      'chainOk',
      'signatureOk',
      'algorithm'
    ],
    properties: {
      packId: stringSchema,
      frameworkId: stringSchema,
      verifiedAt: INSTANT,
      frozenAt: INSTANT,
      rootHash: stringSchema,
      controlCount: INT,
      evidenceCount: INT,
      knownGapCount: INT,
      checksumsOk: BOOL,
      chainOk: BOOL,
      signatureOk: { type: ['boolean', 'null'] },
      signerKeyId: nullableString,
      algorithm: { type: 'string', enum: ['KMS-ECDSA-P256', 'ED25519-LOCAL', 'NONE'] }
    },
    description: 'Carries no evidence content: ids, hashes, counts and verdicts only.'
  },
  ShareInput: {
    type: 'object',
    required: ['ttlHours', 'watermarkLabel'],
    properties: {
      packId: stringSchema,
      frameworkId: stringSchema,
      ttlHours: { ...INT, minimum: 1, maximum: 168 },
      watermarkLabel: stringSchema
    }
  },
  ShareGrant: {
    type: 'object',
    required: ['token', 'frameworkId', 'scope', 'createdBy', 'createdAt', 'expiresAt', 'watermark', 'useCount'],
    properties: {
      token: stringSchema,
      packId: nullableString,
      frameworkId: stringSchema,
      scope: { type: 'string', enum: ['PACK', 'FRAMEWORK'] },
      createdBy: stringSchema,
      createdAt: INSTANT,
      expiresAt: INSTANT,
      revokedAt: nullableString,
      revokedBy: nullableString,
      watermark: stringSchema,
      useCount: INT,
      lastUsedAt: nullableString
    }
  },
  ShareGrantArray: arrayOf('ShareGrant'),
  ControlMapping: {
    type: 'object',
    required: [
      'id',
      'sourceFrameworkId',
      'sourceControlId',
      'targetFrameworkId',
      'targetControlId',
      'direction',
      'confidence',
      'sourceQuote',
      'targetQuote',
      'reason',
      'status',
      'citationVerified',
      'proposedBy',
      'proposedAt'
    ],
    properties: {
      id: stringSchema,
      sourceFrameworkId: stringSchema,
      sourceControlId: stringSchema,
      targetFrameworkId: stringSchema,
      targetControlId: stringSchema,
      direction: { type: 'string', enum: ['SOURCE_TO_TARGET', 'TARGET_TO_SOURCE'] },
      confidence: NUM,
      sourceQuote: stringSchema,
      targetQuote: stringSchema,
      reason: stringSchema,
      status: { type: 'string', enum: ['PROPOSED', 'VALIDATED', 'REJECTED'] },
      citationVerified: BOOL,
      proposedBy: stringSchema,
      proposedAt: INSTANT,
      validatedBy: nullableString,
      validatedAt: nullableString,
      note: nullableString
    }
  },
  ControlMappingArray: arrayOf('ControlMapping'),
  MappingPropose: {
    type: 'object',
    required: ['sourceFrameworkId', 'targetFrameworkId'],
    properties: { sourceFrameworkId: stringSchema, targetFrameworkId: stringSchema }
  },
  MappingDecision: {
    type: 'object',
    required: ['decision'],
    properties: {
      decision: { type: 'string', enum: ['VALIDATE', 'REJECT'] },
      note: nullableString
    }
  },
  ReuseMetric: {
    type: 'object',
    required: [
      'frameworkId',
      'computedAt',
      'evidenceCount',
      'attachmentCount',
      'carriedAttachments',
      'avoidedDeposits',
      'reuseFactor',
      'validatedMappings',
      'pendingMappings'
    ],
    properties: {
      frameworkId: stringSchema,
      computedAt: INSTANT,
      evidenceCount: INT,
      attachmentCount: INT,
      carriedAttachments: INT,
      avoidedDeposits: INT,
      reuseFactor: NUM,
      validatedMappings: INT,
      pendingMappings: INT
    }
  },
  DriftEvent: {
    type: 'object',
    required: ['id', 'controlId', 'frameworkId', 'detectedAt', 'kind', 'detail'],
    properties: {
      id: stringSchema,
      controlId: stringSchema,
      frameworkId: stringSchema,
      evidenceId: nullableString,
      detectedAt: INSTANT,
      kind: { type: 'string', enum: ['STATE_CHANGED', 'MISSING_RUN', 'THRESHOLD_CROSSED', 'RECOVERED'] },
      previous: nullableString,
      current: nullableString,
      detail: stringSchema,
      reminderId: nullableString,
      acknowledgedAt: nullableString,
      acknowledgedBy: nullableString
    }
  },
  DriftEventArray: arrayOf('DriftEvent'),
  DriftSummary: {
    type: 'object',
    required: ['frameworkId', 'computedAt', 'counts', 'unacknowledged', 'recent'],
    properties: {
      frameworkId: stringSchema,
      computedAt: INSTANT,
      counts: {
        type: 'object',
        properties: {
          STATE_CHANGED: INT,
          MISSING_RUN: INT,
          THRESHOLD_CROSSED: INT,
          RECOVERED: INT
        }
      },
      unacknowledged: INT,
      recent: arrayOf('DriftEvent')
    }
  },
  DraftSection: {
    type: 'object',
    required: ['expected', 'body', 'toComplete'],
    properties: { expected: stringSchema, body: stringSchema, toComplete: BOOL }
  },
  Draft: {
    type: 'object',
    required: [
      'id',
      'controlId',
      'frameworkId',
      'createdAt',
      'format',
      'title',
      'watermark',
      'status',
      'sections',
      'basedOn',
      'missing',
      'content',
      'attachable'
    ],
    properties: {
      id: stringSchema,
      controlId: stringSchema,
      frameworkId: stringSchema,
      createdAt: INSTANT,
      format: { type: 'string', enum: ['MARKDOWN'] },
      title: stringSchema,
      watermark: stringSchema,
      status: { type: 'string', enum: ['DRAFT'] },
      sections: arrayOf('DraftSection'),
      basedOn: STRING_ARRAY,
      missing: STRING_ARRAY,
      content: stringSchema,
      attachable: { type: 'boolean', enum: [false] }
    },
    description: 'Never evidence: not fingerprinted, not stored in the vault, never attached.'
  },
  QualitySubjectRow: {
    type: 'object',
    required: ['subject', 'metric', 'value', 'target', 'verdict', 'trend', 'measuredAt'],
    properties: {
      subject: {
        type: 'object',
        required: ['kind', 'modelId', 'promptVersion'],
        properties: {
          kind: { type: 'string', enum: ['READING', 'ATTACHMENT', 'SUFFICIENCY', 'QA'] },
          modelId: stringSchema,
          promptVersion: stringSchema
        }
      },
      metric: {
        type: 'string',
        enum: [
          'FIELD_ACCURACY',
          'ACCEPTED_WITHOUT_CORRECTION',
          'WRONG_HIGH_CONFIDENCE',
          'GAPS_DETECTED',
          'CITATION_ACCURACY',
          'INVENTED_ANSWERS'
        ]
      },
      value: NUM,
      target: NUM,
      verdict: { type: 'string', enum: ['PASS', 'FAIL', 'UNKNOWN'] },
      trend: { type: 'array', items: NUM },
      measuredAt: INSTANT
    }
  },
  QualityTrendPoint: {
    type: 'object',
    required: ['measuredAt', 'subjectKey', 'metric', 'value', 'verdict'],
    properties: {
      measuredAt: INSTANT,
      subjectKey: stringSchema,
      metric: stringSchema,
      value: NUM,
      verdict: { type: 'string', enum: ['PASS', 'FAIL', 'UNKNOWN'] }
    }
  },
  QualityReport: {
    type: 'object',
    required: ['subjects', 'thresholdInEffect', 'trend'],
    properties: {
      generatedAt: INSTANT,
      subjects: arrayOf('QualitySubjectRow'),
      thresholdInEffect: {
        ...NUM,
        description: 'Above 1 when a measured metric is below target: nothing is auto-applied any more.'
      },
      trend: arrayOf('QualityTrendPoint')
    }
  },
  PackAttestation: {
    type: 'object',
    required: ['manifest', 'signature'],
    properties: {
      manifest: { type: 'object', additionalProperties: true },
      signature: {
        type: ['object', 'null'],
        properties: {
          algorithm: stringSchema,
          keyId: stringSchema,
          signedAt: INSTANT,
          signature: stringSchema,
          rootHash: stringSchema
        }
      }
    },
    description: 'Written next to the archive so a third party can verify offline.'
  },
  ManifestChecksum: {
    type: 'object',
    required: ['rootHash', 'lines'],
    properties: {
      rootHash: stringSchema,
      lines: STRING_ARRAY,
      checksumsHash: stringSchema,
      page: nullableInteger
    }
  }
} as const;
