/**
 * DynamoDB single-table schema — key shapes and configuration.
 *
 * No AWS call is made here: the store itself is never executed by the suite
 * (CONTRACTS.md rule 8). What is tested is the layout the CDK table must
 * declare, which is the part that can silently drift from the infrastructure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REGION,
  DEFAULT_TABLE,
  INDEX_NAMES,
  QUEUE_STATUSES,
  QUERY_TARGETS,
  REGION_ENV,
  SCOPE,
  TABLE_ENV,
  auditKeys,
  controlKeys,
  dynamoConfigFromEnv,
  evidenceKeys,
  frameworkKeys,
  itemKeys,
  packKeys,
  reminderKeys,
  settingsKeys,
  statusKeys,
  sufficiencyKeys,
  trendKeys,
  typeValidationKeys,
  validationKeys
} from '../../src/store/dynamoKeys.ts';
import { attachmentKeys } from '../../src/store/dynamoKeys.ts';
import { itemOf, payloadOf, toDynamoItem } from '../../src/store/dynamoClient.ts';
import { InMemoryAuditSink } from '../../src/store/auditMemory.ts';
import { InMemoryStateStore } from '../../src/store/memory.ts';
import { makeAttachment, makeControl, makeEvidence, makeFramework } from '../fixtures/builders.ts';

test('config: table and region come from the environment, with defaults', () => {
  assert.deepEqual(dynamoConfigFromEnv({}), { table: DEFAULT_TABLE, region: DEFAULT_REGION });
  assert.deepEqual(dynamoConfigFromEnv({ [TABLE_ENV]: 'registre-prod', [REGION_ENV]: 'eu-west-1' }), {
    table: 'registre-prod',
    region: 'eu-west-1'
  });
  assert.equal(dynamoConfigFromEnv({ AWS_REGION: 'eu-central-1' }).region, 'eu-central-1');
  assert.equal(
    dynamoConfigFromEnv({ REGISTRE_DYNAMO_ENDPOINT: 'http://localhost:8000' }).endpoint,
    'http://localhost:8000'
  );
});

test('keys: a framework and its controls share one partition (chapter 14)', () => {
  const framework = frameworkKeys('demo-msp');
  const control = controlKeys(makeControl({ id: 'CONT-01', frameworkId: 'demo-msp' }));

  assert.deepEqual(framework, {
    PK: 'FRAMEWORK#demo-msp',
    SK: 'META',
    GSI2PK: 'LIST#FRAMEWORK',
    GSI2SK: 'demo-msp'
  });
  assert.equal(control.PK, framework.PK);
  assert.equal(control.SK, 'CONTROL#CONT-01');
  assert.equal(control.GSI1PK, 'CONTROL#CONT-01');
});

test('keys: an evidence is indexed by fingerprint, so a duplicate is one query (R8)', () => {
  const evidence = makeEvidence({ id: 'ev-1', sha256: 'a'.repeat(64) });
  const keys = evidenceKeys(evidence);

  assert.equal(keys.PK, 'EVIDENCE#ev-1');
  assert.equal(keys.GSI1PK, `HASH#${'a'.repeat(64)}`);
  assert.equal(keys.GSI2PK, 'LIST#EVIDENCE');
  assert.equal(keys.GSI2SK, `${evidence.ingestedAt}#ev-1`);
});

test('keys: an attachment is reachable by evidence, by control and by status', () => {
  const attachment = makeAttachment({
    id: 'at-1',
    evidenceId: 'ev-1',
    controlId: 'CONT-01',
    status: 'PROPOSED'
  });
  const keys = attachmentKeys(attachment);

  assert.equal(keys.PK, 'ATTACHMENT#at-1');
  assert.equal(keys.GSI1PK, 'EVIDENCE#ev-1');
  assert.equal(keys.GSI2PK, 'CONTROL#CONT-01');
  assert.equal(keys.GSI3PK, 'ATTACHMENT#PROPOSED');
});

test('keys: status, sufficiency, trend and reminder rows are scoped to their parent', () => {
  assert.deepEqual(statusKeys({ controlId: 'CONT-01', frameworkId: 'demo-msp' }), {
    PK: 'CONTROL#CONT-01',
    SK: 'STATUS',
    GSI1PK: 'FRAMEWORK#demo-msp',
    GSI1SK: 'STATUS#CONT-01'
  });
  assert.equal(
    sufficiencyKeys({ attachmentId: 'at-1', controlId: 'CONT-01', computedAt: 'x' }).PK,
    'ATTACHMENT#at-1'
  );
  assert.equal(
    trendKeys('demo-msp', '2026-11-11T12:00:00.000Z', 'abcd1234').SK,
    'TREND#2026-11-11T12:00:00.000Z#abcd1234'
  );
  assert.equal(
    reminderKeys({ id: 'rm-1', controlId: 'CONT-01', status: 'SENT', createdAt: 'x' }).GSI3PK,
    'REMINDER#SENT'
  );
});

test('keys: settings, type validation and audit rows are singleton or ordered', () => {
  assert.deepEqual(settingsKeys(), { PK: 'SETTINGS', SK: 'META' });
  assert.equal(typeValidationKeys('CONT-01', 'policy').SK, 'TYPE_VALIDATION#POLICY');
  assert.equal(auditKeys(7).SK, 'EVENT#0000000007');
  assert.ok(auditKeys(9).SK < auditKeys(10).SK, 'zero padding keeps lexical order numeric');
});

test('keys: validation and pack rows carry the listing index', () => {
  const validation = validationKeys({ id: 'va-1', status: 'PENDING', createdAt: 'x' });
  assert.equal(validation.GSI1PK, 'VALIDATION');
  assert.equal(validation.GSI1SK, 'VALIDATION#PENDING#x#va-1');
  assert.equal(
    packKeys({ id: 'pk-1', frameworkId: 'demo-msp', frozenAt: 'x' }).GSI1PK,
    'FRAMEWORK#demo-msp'
  );
  assert.deepEqual(itemKeys('X'), { PK: 'X', SK: 'META' });
});

test('keys: every index is declared once and points at the right attributes', () => {
  assert.equal(INDEX_NAMES.scope, 'gsi1');
  assert.equal(QUERY_TARGETS.scope.pkAttr, 'GSI1PK');
  assert.equal(QUERY_TARGETS.list.index, 'gsi2');
  assert.equal(QUERY_TARGETS.status.pkAttr, 'GSI3PK');
  assert.equal('index' in QUERY_TARGETS.primary, false, 'the primary key needs no index name');
  assert.deepEqual(QUEUE_STATUSES.attachment, ['PROPOSED', 'APPLIED', 'REJECTED']);
});

test('keys: the scope values are the overloaded partition names used by the queries', () => {
  assert.equal(SCOPE.control('CONT-01'), 'CONTROL#CONT-01');
  assert.equal(SCOPE.framework('demo-msp'), 'FRAMEWORK#demo-msp');
  assert.equal(SCOPE.evidence('ev-1'), 'EVIDENCE#ev-1');
  assert.equal(SCOPE.hash('abc'), 'HASH#abc');
  assert.equal(SCOPE.validation, 'VALIDATION');
});

test('items: a row round-trips through its stored form, payload included', () => {
  const framework = makeFramework();
  const item = itemOf(frameworkKeys(framework.id), 'FRAMEWORK', framework);

  assert.equal(item.entity, 'FRAMEWORK');
  const restored = payloadOf<typeof framework>(toDynamoItem({ ...item }));
  assert.deepEqual(restored, framework);
  assert.equal(payloadOf(toDynamoItem({ PK: 'X', SK: 'META', entity: 'SETTINGS' })), null);
});

test('items: keys are strings only, so no attribute type is ever ambiguous', () => {
  const item = itemOf(frameworkKeys('demo-msp'), 'FRAMEWORK', makeFramework());
  for (const value of Object.values(item)) {
    assert.equal(typeof value, 'string');
  }
});

test('the in-memory adapters carry the ids the bootstrap expects', async () => {
  const memory = new InMemoryStateStore();
  const audit = new InMemoryAuditSink();
  assert.equal(memory.id, 'memory-state');
  assert.equal(audit.id, 'memory-audit');

  const framework = makeFramework();
  await memory.putFramework(framework);
  assert.deepEqual(await memory.getFramework(framework.id), framework);
});
