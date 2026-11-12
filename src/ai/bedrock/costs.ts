/**
 * Indicative price list and cost meter — ENF-COUT-01 ("cost per evidence is
 * measured and displayed", nightly batches on the Flex tier).
 *
 * The prices below are ORDER-OF-MAGNITUDE values used to show a cost per
 * evidence in the portal and in the demo; they are not a billing source. The
 * authoritative figures are read from the Bedrock pricing page before any
 * budget commitment (spec chapter 17.1), so they live in one table, easy to
 * update, and every adapter prices through it.
 */

import type { CostMeter } from '../../ports/index.ts';
import type { CostRecord, CostReport } from '../../domain/types.ts';

/** Micro-dollar precision: costs are rounded to 6 decimals, never truncated. */
export const USD_PRECISION = 6;

/** Rounds a USD amount to `USD_PRECISION` decimals. */
export function roundUsd(value: number): number {
  const factor = 10 ** USD_PRECISION;
  return Math.round(value * factor) / factor;
}

export interface TokenPrice {
  /** USD per 1,000 input tokens (standard tier). */
  inputPer1k: number;
  /** USD per 1,000 output tokens (standard tier). */
  outputPer1k: number;
}

/**
 * Indicative token prices by model family (USD per 1k tokens).
 * `default` covers any model id that is not listed (conservative estimate).
 */
export const MODEL_PRICES: Readonly<Record<string, TokenPrice>> = {
  // Real identifiers are inference profiles such as
  // `eu.anthropic.claude-haiku-4-5-20251001-v1:0`, hence the `claude-*` keys;
  // the legacy `anthropic.*` keys are kept for the bare model ids.
  'claude-haiku': { inputPer1k: 0.0008, outputPer1k: 0.004 },
  'claude-sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-opus': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'nova-micro': { inputPer1k: 0.000035, outputPer1k: 0.00014 },
  'anthropic.haiku': { inputPer1k: 0.0008, outputPer1k: 0.004 },
  'anthropic.sonnet': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'anthropic.opus': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'amazon.nova-lite': { inputPer1k: 0.00006, outputPer1k: 0.00024 },
  'amazon.nova-pro': { inputPer1k: 0.0008, outputPer1k: 0.0032 },
  default: { inputPer1k: 0.003, outputPer1k: 0.015 }
};

/** Discount applied to the standard price when the Flex tier is used. */
export const FLEX_DISCOUNT = 0.5;

/**
 * Data Automation is billed per page read (EF-LEC-01, spec 17.1).
 *
 * Standard profile, eu-central-1: 0.04 USD per page processed, verified on
 * 2026-11-12 through the Price List API (`aws pricing get-products
 * --service-code AmazonBedrock --region us-east-1`, usage type
 * `EUC1-DataAutomation-Standard-PagesProcessed`, flat from 0 to Inf). The Custom
 * profile is priced differently (0.005 USD per image plus 0.0005 USD per add-on
 * field) and is not what the deployed project uses.
 */
export const DATA_AUTOMATION_PRICE_PER_PAGE = 0.04;

/** Knowledge-base retrieval is billed per query. */
export const KNOWLEDGE_BASE_PRICE_PER_QUERY = 0.0005;

/** Guardrail application is billed per 1k text units. */
export const GUARDRAIL_PRICE_PER_1K_UNITS = 0.001;

/** Tier of a call: Flex is cheaper and slower (ENF-COUT-01). */
export type CostTier = 'FLEX' | 'STANDARD';

/** Price of one model, falling back to the conservative default. */
export function priceOf(modelId: string): TokenPrice {
  const exact = MODEL_PRICES[modelId];
  if (exact) return exact;
  const family = Object.keys(MODEL_PRICES).find((key) => key !== 'default' && modelId.includes(key));
  return MODEL_PRICES[family ?? 'default']!;
}

/** Cost of one model call, tokens measured by the service. */
export function tokenCost(input: {
  modelId: string;
  tokensIn: number;
  tokensOut: number;
  tier?: CostTier;
  source: string;
}): CostRecord {
  const price = priceOf(input.modelId);
  const factor = input.tier === 'FLEX' ? FLEX_DISCOUNT : 1;
  const usd = ((input.tokensIn / 1000) * price.inputPer1k + (input.tokensOut / 1000) * price.outputPer1k) * factor;
  return {
    usd: roundUsd(usd),
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    source: input.source
  };
}

/** Cost of one document reading, billed per page (EF-LEC-01). */
export function readingCost(readerId: string, pages: number): CostRecord {
  const count = Math.max(1, pages);
  return {
    usd: roundUsd(count * DATA_AUTOMATION_PRICE_PER_PAGE),
    tokensIn: 0,
    tokensOut: 0,
    source: readerId
  };
}

/** Cost of one knowledge-base retrieval (EF-RAT-01, EF-QR-01). */
export function retrievalCost(source: string, queries = 1): CostRecord {
  return {
    usd: roundUsd(Math.max(1, queries) * KNOWLEDGE_BASE_PRICE_PER_QUERY),
    tokensIn: 0,
    tokensOut: 0,
    source
  };
}

/** Cost of one guardrail application (ENF-CONF-02, ENF-IA-02). */
export function guardrailCost(source: string, textUnits: number): CostRecord {
  return {
    usd: roundUsd((Math.max(1, textUnits) / 1000) * GUARDRAIL_PRICE_PER_1K_UNITS),
    tokensIn: 0,
    tokensOut: 0,
    source
  };
}

/** Adds two records of the same shape, keeping their source. */
export function addCosts(left: CostRecord, right: CostRecord): CostRecord {
  return {
    usd: roundUsd(left.usd + right.usd),
    tokensIn: left.tokensIn + right.tokensIn,
    tokensOut: left.tokensOut + right.tokensOut,
    source: left.source === right.source ? left.source : `${left.source}+${right.source}`
  };
}

/** Totals of a cost list: one loop, used by the meter and the report. */
export function totalBySource(records: readonly CostRecord[]): { totalUsd: number; bySource: Record<string, number> } {
  const bySource: Record<string, number> = {};
  let total = 0;
  for (const record of records) {
    total += record.usd;
    bySource[record.source] = roundUsd((bySource[record.source] ?? 0) + record.usd);
  }
  return { totalUsd: roundUsd(total), bySource };
}

/**
 * Records a cost when a meter is injected, and returns it unchanged
 * (ENF-COUT-01). One line per adapter, so no adapter forgets to bill itself.
 */
export function recordCost(meter: CostMeter | undefined, cost: CostRecord): CostRecord {
  meter?.record(cost);
  return cost;
}

/**
 * In-memory cost meter injected in `Services` (ENF-COUT-01).
 * Pure accumulation: `record` never throws and `report` is a snapshot.
 */
export class InMemoryCostMeter implements CostMeter {
  private records: CostRecord[] = [];

  record(cost: CostRecord): void {
    this.records.push({ ...cost });
  }

  report(): { totalUsd: number; bySource: Record<string, number>; count: number } {
    const { totalUsd, bySource } = totalBySource(this.records);
    return { totalUsd, bySource, count: this.records.length };
  }

  /** Everything recorded so far, oldest first (audit, exports). */
  list(): CostRecord[] {
    return this.records.map((record) => ({ ...record }));
  }

  /** Empties the meter (start of a new batch). */
  reset(): void {
    this.records = [];
  }
}

/**
 * Cost per evidence for the portal (spec 17.2, ENF-COUT-01).
 * `evidenceCount` is the number of evidences the cost covers; 0 yields 0.
 */
export function summariseCosts(records: readonly CostRecord[], evidenceCount: number): CostReport {
  const { totalUsd, bySource } = totalBySource(records);
  return {
    totalUsd,
    perEvidenceUsd: evidenceCount > 0 ? roundUsd(totalUsd / evidenceCount) : 0,
    evidenceCount,
    bySource
  };
}

/** Factory used by `createBedrockAi` (ENF-COUT-01). */
export function createCostMeter(): InMemoryCostMeter {
  return new InMemoryCostMeter();
}
