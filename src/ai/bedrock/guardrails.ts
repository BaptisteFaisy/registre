/**
 * `Guardrail` on Bedrock Guardrails — ENF-CONF-02 (PII masking) and ENF-IA-02
 * (grounding of answers in the retrieved passages).
 *
 * Two layers, on purpose:
 *  1. the service (`ApplyGuardrail`) scores grounding/relevance and masks PII;
 *  2. the local code (`anchoring.ts`, `pii.ts`) checks literal citations and
 *     masks again, so a guardrail outage or a missing guardrail id degrades to
 *     the deterministic check instead of letting an unanchored answer through.
 *
 * When no guardrail id is configured, layer 2 runs alone and the result is
 * logged as a warning (the deployment must still ship a guardrail).
 */

import type { GuardrailContentBlock, GuardrailContentSource } from '@aws-sdk/client-bedrock-runtime';
import type { AnchoringResult, CostMeter, Guardrail, RedactionResult } from '../../ports/index.ts';
import type { Passage, Settings } from '../../domain/types.ts';
import { upstream } from '../../support/errors.ts';
import { unsupportedSpans, passagesText } from '../anchoring.ts';
import { redactPii } from '../pii.ts';
import { createRuntimeClient } from './client.ts';
import { guardrailCost, recordCost } from './costs.ts';

/** Guardrail version pinned by the deployment (`DRAFT` until published). */
export const DEFAULT_GUARDRAIL_VERSION = 'DRAFT';

export interface GuardrailOptions {
  guardrailId?: string | null;
  version?: string;
  /** Shared meter; each guardrail application is recorded there (ENF-COUT-01). */
  meter?: CostMeter;
}

interface ApplyResult {
  blocked: boolean;
  text: string | null;
}

/**
 * Guardrail backed by `ApplyGuardrail` (ENF-CONF-02, ENF-IA-02).
 * The local literal check always runs, whatever the service answers.
 */
export class BedrockGuardrail implements Guardrail {
  readonly id = 'bedrock-guardrail';
  private readonly settings: Settings;
  private readonly guardrailId: string | null;
  private readonly version: string;
  private readonly meter: CostMeter | undefined;

  constructor(settings: Settings, options: GuardrailOptions = {}) {
    this.settings = settings;
    this.guardrailId = options.guardrailId ?? settings.guardrailId;
    this.version = options.version ?? DEFAULT_GUARDRAIL_VERSION;
    this.meter = options.meter;
  }

  /** True when the service layer is available (a guardrail id is configured). */
  private enabled(): boolean {
    return Boolean(this.guardrailId);
  }

  /** Checks that every citation of the answer exists in the passages. */
  async verifyAnchoring(input: { answer: string; passages: readonly Passage[] }): Promise<AnchoringResult> {
    const unsupported = unsupportedSpans(input.answer, input.passages);
    if (!this.enabled()) {
      console.warn('[ai:bedrock] no guardrail id configured: literal anchoring check only');
      return { anchored: unsupported.length === 0 && input.passages.length > 0, unsupported };
    }
    const result = await this.apply('OUTPUT', [
      { text: { text: passagesText(input.passages), qualifiers: ['grounding_source'] } },
      { text: { text: input.answer, qualifiers: ['guard_content'] } }
    ]);
    return { anchored: !result.blocked && unsupported.length === 0, unsupported };
  }

  /** Masks personal data in an excerpt or an answer (ENF-CONF-02). */
  async redact(text: string): Promise<RedactionResult> {
    const local = redactPii(text);
    if (!this.enabled()) return local;
    const result = await this.apply('OUTPUT', [{ text: { text: local.text } }]);
    const masked = result.text ? redactPii(result.text) : local;
    return { text: masked.text, redacted: masked.redacted || local.redacted, hits: local.hits + masked.hits };
  }

  /** One `ApplyGuardrail` call; never throws on a service error, logs instead. */
  private async apply(source: GuardrailContentSource, content: GuardrailContentBlock[]): Promise<ApplyResult> {
    const client = await createRuntimeClient(this.settings);
    const { ApplyGuardrailCommand } = await import('@aws-sdk/client-bedrock-runtime');
    try {
      const response = await client.send(
        new ApplyGuardrailCommand({
          guardrailIdentifier: this.guardrailId ?? '',
          guardrailVersion: this.version,
          source,
          content,
          outputScope: 'FULL'
        })
      );
      const blocked = groundingBlocked(response.assessments);
      const text = response.outputs?.[0]?.text ?? null;
      const cost = recordCost(this.meter, guardrailCost(this.id, content.length));
      console.info(`[ai:bedrock] guardrail ${blocked ? 'blocked' : 'passed'} ($${cost.usd})`);
      return { blocked, text };
    } catch (error) {
      console.error(`[ai:bedrock] guardrail call failed, using the local check: ${(error as Error).message}`);
      if (error instanceof Error && error.name === 'ValidationException') {
        throw upstream(`guardrail rejected the request: ${error.message}`);
      }
      return { blocked: false, text: null };
    }
  }
}

/** True when the contextual-grounding filters blocked the content. */
export function groundingBlocked(
  assessments: readonly { contextualGroundingPolicy?: { filters?: readonly { action?: string }[] } }[] | undefined
): boolean {
  for (const assessment of assessments ?? []) {
    for (const filter of assessment.contextualGroundingPolicy?.filters ?? []) {
      if (filter.action === 'BLOCKED') return true;
    }
  }
  return false;
}

/** Factory used by `createBedrockAi` (ENF-CONF-02). */
export function createGuardrail(settings: Settings, options: GuardrailOptions = {}): Guardrail {
  return new BedrockGuardrail(settings, options);
}
