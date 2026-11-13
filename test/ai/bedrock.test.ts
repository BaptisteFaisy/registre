/**
 * Bedrock adapters: everything that can be verified WITHOUT calling AWS —
 * request building (Flex tier, prompt cache, structured output), result mapping
 * (Annex B), guardrail assessment reading, error mapping. No network (EF-LEC-01,
 * EF-RAT-01, EF-QR-01, ENF-COUT-01).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { clientConfig, hasAwsCredentials, resolveRegion } from '../../src/ai/bedrock/client.ts';
import {
  DATA_AUTOMATION_MODEL_ID,
  invocationInput,
  parseS3Uri,
  outputPathsOf,
  profileArnFor,
  requireOutputUri,
  startInvocationInput,
  stateOfStatus
} from '../../src/ai/bedrock/dataAutomationApi.ts';
import { customOutput, extractText, fieldsFromOutput } from '../../src/ai/bedrock/dataAutomationReader.ts';
import { combineFilters, accessFilter } from '../../src/ai/bedrock/knowledgeBase.ts';
import { groundingBlocked } from '../../src/ai/bedrock/guardrails.ts';
import { ATTACHMENT_JSON_SCHEMA, SUFFICIENCY_JSON_SCHEMA } from '../../src/ai/schemas.ts';
import { RegistreError } from '../../src/support/errors.ts';
import { makeSettings } from '../fixtures/builders.ts';

const SETTINGS = makeSettings({ region: 'eu-central-1' });

test('the client region comes from Settings and never defaults silently', () => {
  assert.equal(resolveRegion(SETTINGS), 'eu-central-1');
  assert.equal(resolveRegion(SETTINGS, { region: 'eu-west-1' }), 'eu-west-1');
  assert.throws(
    () => resolveRegion(makeSettings({ region: '' })),
    (error: unknown) => error instanceof RegistreError && error.code === 'CONFIG'
  );
});

test('the client configuration retries three times and stays on the settings region', () => {
  assert.deepEqual(clientConfig(SETTINGS), { region: 'eu-central-1', maxAttempts: 3 });
  assert.deepEqual(clientConfig(SETTINGS, { maxAttempts: 1, endpoint: 'http://localhost:4566' }), {
    region: 'eu-central-1',
    maxAttempts: 1,
    endpoint: 'http://localhost:4566'
  });
});

test('the default credential chain is detected, not invented', () => {
  assert.equal(hasAwsCredentials({}), false);
  assert.equal(hasAwsCredentials({ AWS_PROFILE: 'demo' }), true);
  assert.equal(hasAwsCredentials({ AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: '/v2/creds' }), true);
});

test('the Data Automation invocation carries the blueprint and the output location', () => {
  const target = {
    modelId: DATA_AUTOMATION_MODEL_ID,
    blueprintArn: 'arn:aws:bedrock:eu-central-1:1:blueprint/x',
    outputS3Uri: 's3://vault-bda/out/'
  };
  const modelInput = invocationInput('s3://vault/ev-1/policy.pdf', target);
  assert.deepEqual(modelInput.inputConfiguration, { s3Uri: 's3://vault/ev-1/policy.pdf' });
  assert.deepEqual(modelInput.blueprintConfiguration, { blueprintArn: target.blueprintArn });
  assert.deepEqual(modelInput.outputConfiguration, { s3Uri: 's3://vault-bda/out/' });

  const project = 'arn:aws:bedrock:eu-central-1:123456789012:data-automation-project/abc';
  const request = startInvocationInput({
    inputS3Uri: 's3://vault/ev-1/policy.pdf',
    target: { ...target, modelId: project, profileArn: profileArnFor(project) ?? '' },
    token: 'ev-1'
  });
  assert.equal(request.dataAutomationProfileArn, 'arn:aws:bedrock:eu-central-1:123456789012:data-automation-profile/eu.data-automation-v1');
  assert.deepEqual(request.dataAutomationConfiguration, { dataAutomationProjectArn: project, stage: 'LIVE' });
  assert.equal(request.clientToken, 'ev-1');
  assert.deepEqual(request.outputConfiguration, { s3Uri: 's3://vault-bda/out/' });
  assert.deepEqual(request.blueprints, [{ blueprintArn: target.blueprintArn }]);
});

test('the Data Automation status and job metadata are read as the service writes them', () => {
  assert.equal(stateOfStatus('Success'), 'Completed');
  assert.equal(stateOfStatus('ClientError'), 'Failed');
  assert.equal(stateOfStatus('InProgress'), 'InProgress');
  const metadata = { output_metadata: [{ segment_metadata: [{ standard_output_path: 's3://b/out/standard.json' }] }] };
  assert.deepEqual(outputPathsOf(metadata), { standard: 's3://b/out/standard.json', custom: null });
  assert.equal(parseS3Uri('s3://b/evidence/ev-1/v1.pdf#ver123').key, 'evidence/ev-1/v1.pdf');
  assert.equal(extractText({ pages: [{ representation: { text: 'page one' } }, { representation: { markdown: 'page two' } }] }), 'page onepage two');
});

test('a missing Data Automation output location is a hard error', () => {
  assert.throws(
    () => requireOutputUri({ modelId: 'x', blueprintArn: '', outputS3Uri: '' }),
    (error: unknown) => error instanceof RegistreError && error.code === 'UPSTREAM'
  );
});

test('an S3 URI is parsed strictly', () => {
  assert.deepEqual(parseS3Uri('s3://bucket/a/b.json'), { bucket: 'bucket', key: 'a/b.json' });
  assert.throws(() => parseS3Uri('https://bucket/a.json'), RegistreError);
});

test('the reader maps a Data Automation result onto the Annex B fields', () => {
  const payload = {
    custom_output: [
      {
        fields: {
          evidenceType: 'Report',
          title: 'Quarterly restore test',
          documentDate: '2026-10-14',
          periodStart: '2026-10-01',
          periodEnd: '2026-10-31',
          version: '1.0',
          author: 'L. Moreau',
          approver: 'C. Bernard',
          approvalDate: '2026-10-14',
          client: 'Acme Corp',
          summary: 'Restore of the customer database, 42 minutes, matching the source data.',
          personalData: true
        },
        pages: [
          { text: 'Restoration of the customer database on 14 October 2026.' },
          { text: 'Duration 42 minutes. Signed: C. Bernard.' }
        ]
      }
    ]
  };
  const fields = fieldsFromOutput(payload);
  assert.equal(fields.type, 'REPORT');
  assert.equal(fields.title, 'Quarterly restore test');
  assert.equal(fields.documentDate, '2026-10-14');
  assert.deepEqual(fields.period, { start: '2026-10-01', end: '2026-10-31' });
  assert.equal(fields.client, 'Acme Corp');
  assert.equal(fields.personalData, true);
  assert.equal(extractText(payload).split('\f').length, 2);
  assert.deepEqual(customOutput({}), {});
});

test('an unparsable date is dropped rather than stored', () => {
  const fields = fieldsFromOutput({ custom_output: [{ fields: { documentDate: 'le 14 octobre 2026', evidenceType: 'Unknown' } }] });
  assert.equal(fields.documentDate, null);
  assert.equal(fields.type, null);
});

test('the knowledge-base filter combines access and framework without losing either', () => {
  const access = accessFilter(['PUBLIC', 'INTERNAL']);
  assert.equal(combineFilters(access), access);
  assert.deepEqual(combineFilters(undefined, 'demo-msp'), { equals: { key: 'frameworkId', value: 'demo-msp' } });
  const both = combineFilters(access, 'demo-msp');
  assert.ok(both && 'andAll' in both);
  assert.equal((both as { andAll: unknown[] }).andAll.length, 2);
});

test('a contextual-grounding block is detected in the guardrail assessment', () => {
  assert.equal(groundingBlocked([{ contextualGroundingPolicy: { filters: [{ action: 'BLOCKED' }] } }]), true);
  assert.equal(groundingBlocked([{ contextualGroundingPolicy: { filters: [{ action: 'NONE' }] } }]), false);
  assert.equal(groundingBlocked([]), false);
  assert.equal(groundingBlocked(undefined), false);
});

test('the structured-output schemas forbid any state, date or count field', () => {
  for (const schema of [ATTACHMENT_JSON_SCHEMA, SUFFICIENCY_JSON_SCHEMA]) {
    const parsed = JSON.parse(schema) as { items: { properties: Record<string, unknown> } };
    const keys = Object.keys(parsed.items.properties);
    for (const forbidden of ['state', 'status', 'class', 'missing', 'expiresAt', 'freshness']) {
      assert.equal(keys.includes(forbidden), false, `${forbidden} must not be model output`);
    }
  }
});
