/**
 * Cost meter and price list — ENF-COUT-01 ("cost per evidence measured and
 * displayed", Flex tier for nightly batches).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_AUTOMATION_PRICE_PER_PAGE,
  FLEX_DISCOUNT,
  InMemoryCostMeter,
  addCosts,
  guardrailCost,
  priceOf,
  readingCost,
  retrievalCost,
  recordCost,
  roundUsd,
  summariseCosts,
  tokenCost,
  totalBySource
} from '../../src/ai/bedrock/costs.ts';
import { createGuardrail } from '../../src/ai/bedrock/guardrails.ts';
import { makeSettings } from '../fixtures/builders.ts';
import type { CostRecord } from '../../src/domain/types.ts';

const SONNET = 'anthropic.sonnet';

test('roundUsd keeps six decimals so accumulation stays exact', () => {
  assert.equal(roundUsd(0.1 + 0.2), 0.3);
  assert.equal(roundUsd(1 / 3), 0.333333);
});

test('a reading is billed per page, at least one page', () => {
  // Derived from the verified price constant, not a literal: the list price is
  // re-checked against the Price List API whenever the region or profile moves.
  assert.equal(readingCost('bedrock-data-automation', 3).usd, roundUsd(3 * DATA_AUTOMATION_PRICE_PER_PAGE));
  assert.equal(readingCost('bedrock-data-automation', 0).usd, roundUsd(DATA_AUTOMATION_PRICE_PER_PAGE));
  assert.equal(readingCost('bedrock-data-automation', 2).source, 'bedrock-data-automation');
});

test('the Flex tier halves the token price of the same call', () => {
  const standard = tokenCost({ modelId: SONNET, tokensIn: 2000, tokensOut: 500, source: 'reasoner' });
  const flex = tokenCost({ modelId: SONNET, tokensIn: 2000, tokensOut: 500, tier: 'FLEX', source: 'reasoner' });
  assert.equal(standard.usd, 0.0135);
  assert.equal(flex.usd, roundUsd(0.0135 * FLEX_DISCOUNT));
  assert.equal(standard.tokensIn, 2000);
  assert.equal(standard.tokensOut, 500);
});

test('an unknown model falls back to the conservative default price', () => {
  assert.deepEqual(priceOf('some-new-model'), priceOf('default'));
  assert.deepEqual(priceOf('anthropic.sonnet'), { inputPer1k: 0.003, outputPer1k: 0.015 });
});

test('retrieval and guardrail calls are priced per query and per unit', () => {
  assert.equal(retrievalCost('kb-evidence', 2).usd, 0.001);
  assert.equal(guardrailCost('guardrail', 2000).usd, 0.002);
});

test('addCosts sums amounts and tokens, keeping a single source when equal', () => {
  const left: CostRecord = { usd: 0.01, tokensIn: 100, tokensOut: 10, source: 'reader' };
  const right: CostRecord = { usd: 0.02, tokensIn: 200, tokensOut: 20, source: 'reader' };
  assert.deepEqual(addCosts(left, right), { usd: 0.03, tokensIn: 300, tokensOut: 30, source: 'reader' });
  assert.equal(addCosts(left, { ...right, source: 'reasoner' }).source, 'reader+reasoner');
});

test('the meter accumulates exactly and groups by source', () => {
  const meter = new InMemoryCostMeter();
  meter.record({ usd: 0.1, tokensIn: 0, tokensOut: 0, source: 'reader' });
  meter.record({ usd: 0.2, tokensIn: 0, tokensOut: 0, source: 'reasoner' });
  meter.record({ usd: 0.05, tokensIn: 0, tokensOut: 0, source: 'reader' });
  const report = meter.report();
  assert.equal(report.totalUsd, 0.35);
  assert.equal(report.count, 3);
  assert.equal(report.bySource.reader, 0.15);
  assert.equal(report.bySource.reasoner, 0.2);
});

test('the meter hands out copies, so a caller cannot rewrite history', () => {
  const meter = new InMemoryCostMeter();
  const cost: CostRecord = { usd: 0.5, tokensIn: 1, tokensOut: 1, source: 'reader' };
  meter.record(cost);
  cost.usd = 99;
  assert.equal(meter.report().totalUsd, 0.5);
  assert.equal(meter.list()[0]?.usd, 0.5);
  meter.reset();
  assert.equal(meter.report().count, 0);
});

test('the cost per evidence divides the total by the evidence count', () => {
  const records: CostRecord[] = [
    { usd: 0.12, tokensIn: 0, tokensOut: 0, source: 'reader' },
    { usd: 0.18, tokensIn: 0, tokensOut: 0, source: 'reasoner' }
  ];
  const report = summariseCosts(records, 3);
  assert.equal(report.totalUsd, 0.3);
  assert.equal(report.perEvidenceUsd, 0.1);
  assert.equal(report.evidenceCount, 3);
  assert.deepEqual(report.bySource, { reader: 0.12, reasoner: 0.18 });
  assert.equal(summariseCosts(records, 0).perEvidenceUsd, 0);
});

test('a cost is recorded through the shared meter, or skipped when absent', () => {
  const meter = new InMemoryCostMeter();
  const cost: CostRecord = { usd: 0.03, tokensIn: 0, tokensOut: 0, source: 'bedrock-data-automation' };
  assert.equal(recordCost(meter, cost), cost);
  assert.equal(meter.report().count, 1);
  assert.equal(recordCost(undefined, cost), cost, 'no meter, no failure');
});

test('totals are computed once and reused by the meter and the report', () => {
  const records: CostRecord[] = [
    { usd: 0.01, tokensIn: 0, tokensOut: 0, source: 'reader' },
    { usd: 0.02, tokensIn: 0, tokensOut: 0, source: 'reader' },
    { usd: 0.04, tokensIn: 0, tokensOut: 0, source: 'reasoner' }
  ];
  const totals = totalBySource(records);
  assert.equal(totals.totalUsd, 0.07);
  assert.deepEqual(totals.bySource, { reader: 0.03, reasoner: 0.04 });
  assert.equal(summariseCosts(records, 7).perEvidenceUsd, 0.01);
});

test('the guardrail only bills when it actually calls the service', async () => {
  const meter = new InMemoryCostMeter();
  const guardrail = createGuardrail(makeSettings({ guardrailId: null }), { guardrailId: null, meter });
  const outcome = await guardrail.redact('Contact jean.dupont@msp.demo');
  assert.equal(outcome.redacted, true);
  assert.equal(meter.report().count, 0, 'the local PII pass costs nothing');
});

test('without the user question, the grounding check stays literal and never calls the service', async () => {
  const meter = new InMemoryCostMeter();
  // A configured guardrail: a service call here would need the network.
  const guardrail = createGuardrail(makeSettings({ guardrailId: 'gr-1' }), { guardrailId: 'gr-1', meter });
  const passages = [{ evidenceId: 'ev-1', page: 1, text: 'Approved on 2025-05-20.' }] as never;
  const outcome = await guardrail.verifyAnchoring({ answer: 'Approved on 2025-05-20.', passages });
  assert.equal(outcome.anchored, true);
  assert.equal(meter.report().count, 0);
});
