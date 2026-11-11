/**
 * Provider selection — `REGISTRE_PROVIDER` must default to the offline mocks and
 * refuse an unknown value instead of silently going to AWS.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROVIDER, PROVIDER_ENV, createAi, providerFromEnv } from '../../src/ai/index.ts';
import { createBedrockAi } from '../../src/ai/bedrock/index.ts';
import { createDataAutomationReader } from '../../src/ai/bedrock/dataAutomationReader.ts';
import { dataAutomationTarget } from '../../src/ai/bedrock/dataAutomationApi.ts';
import { RegistreError } from '../../src/support/errors.ts';
import { execFileSync } from 'node:child_process';
import { makeSettings } from '../fixtures/builders.ts';

test('the default provider is the offline mock', () => {
  assert.equal(DEFAULT_PROVIDER, 'mock');
  assert.equal(providerFromEnv({}), 'mock');
  assert.equal(providerFromEnv({ [PROVIDER_ENV]: '' }), 'mock');
  assert.equal(providerFromEnv({ [PROVIDER_ENV]: '   ' }), 'mock');
});

test('the provider is read case-insensitively', () => {
  assert.equal(providerFromEnv({ [PROVIDER_ENV]: 'mock' }), 'mock');
  assert.equal(providerFromEnv({ [PROVIDER_ENV]: 'BEDROCK' }), 'bedrock');
  assert.equal(providerFromEnv({ [PROVIDER_ENV]: ' Bedrock ' }), 'bedrock');
});

test('an unknown provider is an explicit configuration error', () => {
  assert.throws(
    () => providerFromEnv({ [PROVIDER_ENV]: 'aws' }),
    (error: unknown) => error instanceof RegistreError && error.code === 'CONFIG'
  );
});

test('createAi builds the mock services without any AWS configuration', () => {
  const services = createAi({}, makeSettings());
  assert.equal(services.provider, 'mock');
  assert.equal(services.costs.report().count, 0);
});

test('importing the module never loads the AWS SDK (offline demo guarantee)', () => {
  const entry = new URL('../../src/ai/index.ts', import.meta.url).href;
  const script = [
    `const mod = await import(${JSON.stringify(entry)});`,
    'const loaded = (process.moduleLoadList ?? []).filter((name) => name.includes("aws-sdk"));',
    'console.log(JSON.stringify({ provider: mod.providerFromEnv({}), loaded: loaded.length }));'
  ].join('\n');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  const parsed = JSON.parse(output.trim().split('\n').pop() ?? '{}') as { provider: string; loaded: number };
  assert.equal(parsed.provider, 'mock');
  assert.equal(parsed.loaded, 0, 'no @aws-sdk module is loaded at import time');
});

test('createAi builds the Bedrock services without loading the SDK', () => {
  const services = createAi({ [PROVIDER_ENV]: 'bedrock' }, makeSettings());
  assert.equal(services.provider, 'bedrock');
  assert.equal(services.reader.id, 'bedrock-data-automation');
  assert.equal(services.controlRetriever.id, 'bedrock-kb-frameworks');
  assert.equal(services.evidenceRetriever.id, 'bedrock-kb-evidence');
  assert.equal(services.reasoner.id, 'bedrock-structured-reasoner');
  assert.equal(services.composer.id, 'bedrock-composer');
  assert.equal(services.guardrail.id, 'bedrock-guardrail');
});

test('the Data Automation target comes from the environment', () => {
  const target = dataAutomationTarget(
    { REGISTRE_BDA_PROJECT_ARN: 'arn:aws:bedrock:eu-central-1:1:data-automation-project/x', REGISTRE_BDA_BLUEPRINT_ARN: 'arn:bp' },
    'bedrock-data-automation'
  );
  assert.equal(target.modelId, 'arn:aws:bedrock:eu-central-1:1:data-automation-project/x');
  assert.equal(target.blueprintArn, 'arn:bp');
  assert.equal(target.outputS3Uri, '');
  assert.equal(dataAutomationTarget({}, 'bedrock-data-automation').modelId, 'bedrock-data-automation');
});

test('the Bedrock reader refuses a non-S3 object before calling any service', async () => {
  const reader = createDataAutomationReader(makeSettings(), { env: {} });
  await assert.rejects(
    () =>
      reader.read({
        evidenceId: 'ev-1',
        contentType: 'application/pdf',
        sizeBytes: 10,
        uri: 'file:///tmp/policy.pdf'
      }),
    (error: unknown) => error instanceof RegistreError && error.code === 'UPSTREAM'
  );
});

test('createBedrockAi builds the six services from the environment', () => {
  const services = createBedrockAi(
    { REGISTRE_KB_FRAMEWORKS_ID: 'kb-frameworks', REGISTRE_KB_EVIDENCE_ID: 'kb-evidence' },
    makeSettings({ guardrailId: 'gr-123' })
  );
  assert.equal(services.provider, 'bedrock');
  assert.equal(services.costs.report().count, 0);
});
