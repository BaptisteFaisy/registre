/**
 * The deployed Data Automation blueprint is the Annex B field plan — EF-LEC-01.
 * The stack reads the committed schema; this test keeps it equal to the plan.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVIDENCE_FIELD_NAMES, dataAutomationBlueprintSchema } from '../../src/ai/prompts/readerBlueprint.ts';

test('EF-LEC-01 the committed blueprint schema is generated from the field plan', () => {
  const committed = JSON.parse(readFileSync('infra/blueprints/evidence.schema.json', 'utf8')) as unknown;
  assert.deepEqual(committed, dataAutomationBlueprintSchema());
});

test('EF-LEC-01 the blueprint carries every Annex B field, the closed type list and no verdict', () => {
  const schema = dataAutomationBlueprintSchema() as { properties: Record<string, { type: string; instruction: string }> };
  assert.deepEqual(Object.keys(schema.properties), [...EVIDENCE_FIELD_NAMES]);
  assert.match(schema.properties.evidenceType?.instruction ?? '', /One of: POLICY, /);
  assert.equal(schema.properties.personalData?.type, 'boolean');
});
