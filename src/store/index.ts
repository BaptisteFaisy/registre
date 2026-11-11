/**
 * Public surface of the platform store module (chapter 11.2, chapter 14).
 *
 * Downstream modules import from here instead of reaching into a file:
 *  - `memory.ts` / `auditMemory.ts` / `memorySupport.ts` — offline adapters for
 *    tests, the demo and the evaluation harness (CONTRACTS.md rule 8);
 *  - `vault.ts` — versioned local evidence vault with a legal hold (ENF-INT-01);
 *  - `dynamodb.ts` / `dynamoAudit.ts` — the production adapters;
 *  - `dynamoKeys.ts` — the single-table layout the CDK stack must declare.
 *
 * No SDK is imported at module load: the DynamoDB adapters reach the AWS SDK
 * lazily, on first call.
 */

export { InMemoryStateStore } from './memory.ts';
export type { InMemoryStateStoreOptions, TypeValidation } from './memory.ts';

export { InMemoryAuditSink } from './auditMemory.ts';
export type { InMemoryAuditSinkOptions } from './auditMemory.ts';

export { MemoryCostMeter, MemoryNotifier } from './memorySupport.ts';
export type { MemoryNotifierOptions } from './memorySupport.ts';

export { GENESIS_HASH, eventDigest, sealEvent, verifyEvents } from './auditChain.ts';
export type { AuditEventInput, ChainVerification, UnsignedEvent } from './auditChain.ts';

export {
  DEFAULT_VAULT_ROOT,
  LocalEvidenceStore,
  VAULT_ROOT_ENV,
  isRetained,
  normalizeKey,
  objectDirName,
  parseVaultUri,
  vaultRootFromEnv
} from './vault.ts';
export type { LocalVaultOptions, VaultManifest, VaultVersion } from './vault.ts';

export { DynamoStateStore } from './dynamodb.ts';
export { DynamoAuditSink } from './dynamoAudit.ts';
export { DynamoGateway, itemOf, payloadOf, toDynamoItem } from './dynamoClient.ts';
export type { DynamoConfig, DynamoItem } from './dynamoKeys.ts';
export { dynamoConfigFromEnv } from './dynamoKeys.ts';

export { MemoryExtensionStore, createMemoryExtensions } from './extensionsMemory.ts';
export type { MemoryExtensionStoreOptions } from './extensionsMemory.ts';
