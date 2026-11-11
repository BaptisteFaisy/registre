/**
 * Registre — Lambda factory shared by every stack.
 *
 * One implementation of "a handler from `src/` becomes a Lambda": bundling
 * options, runtime, log retention, tracing and the fallback used while the
 * application code is still being written by another workstream.
 *
 * CHOICE — `NodejsFunction` (esbuild) instead of `lambda.Function` + manual
 * bundling: the repository ships TypeScript with `.ts` import specifiers and no
 * build step (CONTRACTS.md §1), so esbuild has to resolve and strip types at
 * package time. `NodejsFunction` gives us that, keeps the lock file in the
 * repository root, and emits one self-contained ESM artefact per handler.
 *
 * Because `src/**` is produced in parallel, a handler file may be missing at
 * synth time. In that case we emit a stub that answers `501 Not Implemented`
 * and add an annotation on the stack: `cdk synth` must always succeed offline.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { HANDLERS, type HandlerKey } from './config';

/** Repository root, resolved from this file (infra/lib → ../..). */
export const REPO_ROOT = join(__dirname, '..', '..');

/** What a stack must provide for one handler. */
export interface HandlerSpec {
  /** Logical key of `HANDLERS` (maps to a file under `src/`). */
  readonly key: HandlerKey;
  /** Exported function name inside the file. Defaults to `handler`. */
  readonly exported?: string;
  readonly memoryMb?: number;
  readonly timeout?: Duration;
  readonly environment?: Record<string, string>;
  readonly description?: string;
  /** Extra statements added to the execution role. */
  readonly policies?: iam.PolicyStatement[];
}

/** Absolute path of the handler file that this spec points at. */
export function handlerPath(key: HandlerKey): string {
  return join(REPO_ROOT, HANDLERS[key]);
}

/** Inline fallback used when the application file (or its handler) is missing. */
function stubCode(key: HandlerKey): lambda.InlineCode {
  const body = `exports.handler = async () => ({
  statusCode: 501,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ error: 'HANDLER_NOT_IMPLEMENTED', handler: '${key}' })
});`;
  return lambda.Code.fromInline(body);
}

/**
 * True when the file exists AND exports the requested symbol. A module that is
 * still being written (no `handler` yet) gets the stub instead of a Lambda that
 * would deploy and fail at the first invocation.
 */
function exportsHandler(entry: string, symbol: string): boolean {
  if (!existsSync(entry)) return false;
  const source = readFileSync(entry, 'utf8');
  const pattern = new RegExp(`export\\s+(const|async function|function)\\s+${symbol}\\b`);
  return pattern.test(source);
}

/** Common bundling options: bundle everything but the AWS SDK v3 runtime. */
function bundling(): lambdaNode.BundlingOptions {
  return {
    format: OutputFormat.ESM,
    target: 'node22',
    platform: 'node',
    mainFields: ['module', 'main'],
    externalModules: ['@aws-sdk/*'],
    banner:
      "import { createRequire } from 'module';const require = createRequire(import.meta.url);"
  };
}

/** Shared log group: 30-day retention keeps the demo inside the free tier. */
function logGroupFor(scope: Construct, id: string): LogGroup {
  return new LogGroup(scope, id, {
    retention: RetentionDays.ONE_MONTH,
    removalPolicy: cdk.RemovalPolicy.DESTROY
  });
}

/**
 * Creates the Lambda for one handler, falling back to a stub when the file is
 * not present yet. Returns the function so callers can wire grants and alarms.
 */
export function createHandler(scope: Construct, id: string, spec: HandlerSpec): lambda.IFunction {
  const entry = handlerPath(spec.key);
  const common = {
    functionName: `${cdk.Stack.of(scope).stackName}-${spec.key.replace(/[^a-zA-Z0-9]/g, '-')}`,
    runtime: lambda.Runtime.NODEJS_22_X,
    architecture: lambda.Architecture.ARM_64,
    memorySize: spec.memoryMb ?? 512,
    timeout: spec.timeout ?? Duration.minutes(2),
    environment: { NODE_OPTIONS: '--enable-source-maps', ...spec.environment },
    description: spec.description ?? `Registre handler ${spec.key} (${HANDLERS[spec.key]})`,
    tracing: lambda.Tracing.ACTIVE,
    logGroup: logGroupFor(scope, `${id}Logs`),
    ...(spec.policies ? { initialPolicy: spec.policies } : {})
  } as const;

  if (!exportsHandler(entry, spec.exported ?? 'handler')) {
    cdk.Annotations.of(scope).addWarning(
      `Handler ${HANDLERS[spec.key]} (export "${spec.exported ?? 'handler'}") is missing; a 501 stub is deployed for "${spec.key}".`
    );
    return new lambda.Function(scope, id, { ...common, code: stubCode(spec.key), handler: 'index.handler' });
  }

  return new NodejsFunction(scope, id, {
    ...common,
    entry,
    handler: spec.exported ?? 'handler',
    projectRoot: REPO_ROOT,
    depsLockFilePath: join(REPO_ROOT, 'package-lock.json'),
    bundling: bundling()
  });
}

/** Grants the handler read/write access on one S3 bucket (vault or portal). */
export function grantBucket(fn: lambda.IFunction, bucketArn: string, readWrite: boolean): void {
  if (fn.role) {
    fn.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: readWrite
          ? ['s3:GetObject*', 's3:PutObject*', 's3:DeleteObject*', 's3:ListBucket', 's3:GetBucketLocation']
          : ['s3:GetObject*', 's3:ListBucket'],
        resources: [bucketArn, `${bucketArn}/*`]
      })
    );
  }
}
