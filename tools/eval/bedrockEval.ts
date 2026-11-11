#!/usr/bin/env node
/**
 * Prepares the two Bedrock evaluation tasks of spec chapter 13.5 and writes
 * every payload to `eval/bedrock/` so it can be inspected and versioned:
 *
 *   attachment-dataset.jsonl     model-as-judge dataset (prompt + referenceResponse)
 *   attachment-metrics.json      custom metric definitions of the judge model
 *   qa-dataset.jsonl             knowledge base evaluation dataset
 *   eval-config.json             task definitions, counts and CLI commands
 *   attachment-job.json          create-evaluation-job payload (model-as-judge)
 *   qa-job.json                  create-evaluation-job payload (knowledge base)
 *
 * No network call happens here: the AWS SDK is only imported when `--submit` is
 * passed, and the command then explains what is missing rather than guessing.
 *
 * Usage:
 *   node tools/eval/bedrockEval.ts
 *   node tools/eval/bedrockEval.ts --evidence-dir demo-out/evidence
 *   node tools/eval/bedrockEval.ts --model <model-id> --kb-id <knowledge-base-id>
 *   node tools/eval/bedrockEval.ts --submit
 */

import { join, relative } from 'node:path';
import {
  KNOWLEDGE_BASE_METRICS,
  attachmentDataset,
  evalConfig,
  judgeMetrics,
  loadEvidenceTexts,
  qaDataset
} from './lib/bedrock.ts';
import { knowledgeBasePayload, modelJudgePayload } from './lib/bedrockConfigs.ts';
import { writeJsonFile, writeJsonlFile } from './lib/jsonl.ts';
import { argValue, hasFlag, parseArgs } from './lib/cli.ts';
import { bedrockDir } from './lib/paths.ts';

const DEFAULT_MODEL = 'anthropic.:0';
const DEFAULT_KB_ID = '<BEDROCK_KNOWLEDGE_BASE_ID>';

const USAGE = `Bedrock evaluation task preparation (spec 13.5)

  --out <dir>            payload directory (default: eval/bedrock)
  --evidence-dir <dir>   read the generated evidence files as prompt text
  --model <id>           model identifier used by both tasks
  --kb-id <id>           knowledge base id of the question task
  --submit               create the evaluation job through the AWS SDK
  --help                 show this text`;

interface PayloadPaths {
  attachmentDataset: string;
  metrics: string;
  qaDataset: string;
  config: string;
  attachmentJob: string;
  qaJob: string;
}

function payloadPaths(outDir: string): PayloadPaths {
  return {
    attachmentDataset: join(outDir, 'attachment-dataset.jsonl'),
    metrics: join(outDir, 'attachment-metrics.json'),
    qaDataset: join(outDir, 'qa-dataset.jsonl'),
    config: join(outDir, 'eval-config.json'),
    attachmentJob: join(outDir, 'attachment-job.json'),
    qaJob: join(outDir, 'qa-job.json')
  };
}

function writePayloads(outDir: string, evidenceDir: string | null, model: string, knowledgeBaseId: string): string[] {
  const texts = evidenceDir === null ? new Map<string, string>() : loadEvidenceTexts(evidenceDir);
  const metrics = judgeMetrics();
  const paths = payloadPaths(outDir);
  writeJsonlFile(paths.attachmentDataset, attachmentDataset(texts));
  writeJsonFile(paths.metrics, { metrics });
  writeJsonlFile(paths.qaDataset, qaDataset());
  writeJsonFile(paths.config, evalConfig(model, knowledgeBaseId));
  writeJsonFile(paths.attachmentJob, modelJudgePayload(model, metrics));
  writeJsonFile(paths.qaJob, knowledgeBasePayload(model, knowledgeBaseId, KNOWLEDGE_BASE_METRICS));
  return Object.values(paths);
}

/**
 * Submits the model-as-judge job. The Bedrock control plane client is imported
 * lazily: it is not a dependency of this repository, so the command explains
 * what to install or which CLI call to run instead of failing at import time.
 */
async function submit(configPath: string): Promise<number> {
  const moduleName = '@aws-sdk/client-bedrock';
  let sdk: Record<string, unknown>;
  try {
    sdk = (await import(moduleName)) as unknown as Record<string, unknown>;
  } catch {
    console.error(`the Bedrock control plane client (${moduleName}) is not installed.`);
    console.error(`create the job with: aws bedrock create-evaluation-job --cli-input-json file://${configPath}`);
    return 3;
  }
  const clientClass = sdk.BedrockClient as (new (options: unknown) => { send(command: unknown): Promise<unknown> }) | undefined;
  if (clientClass === undefined) {
    console.error('the installed client does not expose BedrockClient');
    return 3;
  }
  const client = new clientClass({});
  const response = await client.send({ input: { configPath } });
  console.log(JSON.stringify(response, null, 2));
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (hasFlag(args, 'help')) {
    console.log(USAGE);
    return 0;
  }
  const outDir = argValue(args, 'out', bedrockDir());
  const model = argValue(args, 'model', DEFAULT_MODEL);
  const knowledgeBaseId = argValue(args, 'kb-id', DEFAULT_KB_ID);
  const evidenceDir = args.values.get('evidence-dir') ?? null;
  const paths = payloadPaths(outDir);
  for (const path of writePayloads(outDir, evidenceDir, model, knowledgeBaseId)) {
    console.log(`wrote ${relative(process.cwd(), path)}`);
  }
  if (hasFlag(args, 'submit')) return submit(relative(process.cwd(), paths.attachmentJob));
  console.log('no job created: pass --submit to create one, or run the aws CLI command from eval-config.json');
  return 0;
}

process.exit(await main());
