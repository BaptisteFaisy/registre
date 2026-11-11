/**
 * Lazy DynamoDB gateway — the only file that touches the AWS SDK for the
 * state store (CONTRACTS.md rule: SDK v3 only inside adapters, always behind a
 * lazy `await import(...)`).
 *
 * Every call is wrapped: a failure surfaces as `upstream(...)` with the
 * operation and the table, which the API layer maps to HTTP 502.
 */

import type { DynamoDBDocumentClient, NativeAttributeValue } from '@aws-sdk/lib-dynamodb';
import { upstream } from '../support/errors.ts';
import type { DynamoConfig, DynamoItem, DynamoKeys, EntityKind, QueryTarget } from './dynamoKeys.ts';
import { ATTRS } from './dynamoKeys.ts';

/** Typed view of the SDK module, imported lazily and cached once. */
type LibDynamo = typeof import('@aws-sdk/lib-dynamodb');

const WRITE_CHUNK = 25;
const READ_CHUNK = 100;
const MAX_PAGES = 200;

export interface QueryOptions {
  /** `begins_with(SK, prefix)` restriction, used for entity-type scoping. */
  skPrefix?: string;
  descending?: boolean;
  limit?: number;
  /** Resume token of a previous page (`PK`/`SK` of its last item). */
  startKey?: Record<string, string>;
}

/** Builds a stored item from its keys, discriminator and payload. */
export function itemOf(keys: DynamoKeys, entity: EntityKind, value: unknown): DynamoItem {
  const item: DynamoItem = {
    PK: keys.PK,
    SK: keys.SK,
    entity,
    data: JSON.stringify(value)
  };
  if (keys.GSI1PK !== undefined) item.GSI1PK = keys.GSI1PK;
  if (keys.GSI1SK !== undefined) item.GSI1SK = keys.GSI1SK;
  if (keys.GSI2PK !== undefined) item.GSI2PK = keys.GSI2PK;
  if (keys.GSI2SK !== undefined) item.GSI2SK = keys.GSI2SK;
  if (keys.GSI3PK !== undefined) item.GSI3PK = keys.GSI3PK;
  if (keys.GSI3SK !== undefined) item.GSI3SK = keys.GSI3SK;
  return item;
}

/** Reads a string attribute defensively (DynamoDB may return any attribute type). */
function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value : '';
}

/** Narrows one raw DynamoDB item to the single-table shape. */
export function toDynamoItem(raw: Record<string, unknown>): DynamoItem {
  const item: DynamoItem = {
    PK: readString(raw, ATTRS.pk),
    SK: readString(raw, ATTRS.sk),
    entity: readString(raw, 'entity') as EntityKind
  };
  const data = readString(raw, 'data');
  if (data.length > 0) item.data = data;
  for (const attribute of [
    ATTRS.gsi1pk,
    ATTRS.gsi1sk,
    ATTRS.gsi2pk,
    ATTRS.gsi2sk,
    ATTRS.gsi3pk,
    ATTRS.gsi3sk
  ] as const) {
    const value = readString(raw, attribute);
    if (value.length > 0) item[attribute] = value;
  }
  return item;
}

/** Payload of an item, `null` when the item carries no data attribute. */
export function payloadOf<T>(item: DynamoItem | null): T | null {
  if (item === null || item.data === undefined) return null;
  return JSON.parse(item.data) as T;
}

/** Splits a list into chunks of at most `size` elements. */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export class DynamoGateway {
  readonly table: string;

  private readonly config: DynamoConfig;
  private libPromise: Promise<LibDynamo> | null = null;
  private clientPromise: Promise<DynamoDBDocumentClient> | null = null;

  /** Builds a gateway for one table; the client is created lazily. */
  constructor(config: DynamoConfig) {
    this.config = config;
    this.table = config.table;
  }

  /** Reads one item by primary key, `null` when absent. */
  async get(keys: DynamoKeys): Promise<DynamoItem | null> {
    const lib = await this.lib();
    const response = await this.send('get', (client) =>
      client.send(new lib.GetCommand({ TableName: this.table, Key: { PK: keys.PK, SK: keys.SK } }))
    );
    return response.Item === undefined ? null : toDynamoItem(response.Item);
  }

  /** Writes one item, replacing the previous value of the same key. */
  async put(keys: DynamoKeys, entity: EntityKind, value: unknown): Promise<void> {
    const lib = await this.lib();
    await this.send('put', (client) =>
      client.send(new lib.PutCommand({ TableName: this.table, Item: itemOf(keys, entity, value) }))
    );
  }

  /** Writes many items in batches of 25, retrying unprocessed writes. */
      /**
   * Writes one item only when the key is free. Returns `false` when another
   * writer won the race, which is how the audit chain stays append-only.
   */
  async putIfAbsent(keys: DynamoKeys, entity: EntityKind, value: unknown): Promise<boolean> {
    const lib = await this.lib();
    const client = await this.client();
    try {
      await client.send(
        new lib.PutCommand({
          TableName: this.table,
          Item: itemOf(keys, entity, value),
          ConditionExpression: 'attribute_not_exists(PK)'
        })
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') return false;
      throw upstream('dynamodb: putIfAbsent failed', {
        table: this.table,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /** Writes many items in batches of 25, retrying unprocessed writes. */
  async putMany(items: readonly DynamoItem[]): Promise<void> {
    if (items.length === 0) return;
    const lib = await this.lib();
    for (const group of chunk(items, WRITE_CHUNK)) {
      let pending: DynamoItem[] = [...group];
      for (let attempt = 0; attempt < 3 && pending.length > 0; attempt += 1) {
        const response = await this.send('batchWrite', (client) =>
          client.send(
            new lib.BatchWriteCommand({
              RequestItems: { [this.table]: pending.map((item) => ({ PutRequest: { Item: item } })) }
            })
          )
        );
        pending = unprocessedWrites(response.UnprocessedItems, this.table);
      }
    }
  }

  /** Queries one index partition, following pagination up to `MAX_PAGES`. */
  async query(target: QueryTarget, pk: string, options: QueryOptions = {}): Promise<DynamoItem[]> {
    const lib = await this.lib();
    const items: DynamoItem[] = [];
    let start: Record<string, NativeAttributeValue> | undefined = options.startKey;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.send('query', (client) =>
        client.send(
          new lib.QueryCommand({
            TableName: this.table,
            ...(target.index === undefined ? {} : { IndexName: target.index }),
            KeyConditionExpression: keyExpression(target, options.skPrefix),
            ExpressionAttributeValues: expressionValues(pk, options.skPrefix),
            ScanIndexForward: options.descending !== true,
            ...(options.limit === undefined ? {} : { Limit: options.limit }),
            ...(start === undefined ? {} : { ExclusiveStartKey: start })
          })
        )
      );
      for (const raw of response.Items ?? []) items.push(toDynamoItem(raw));
      start = response.LastEvaluatedKey;
      if (start === undefined) break;
      if (options.limit !== undefined && items.length >= options.limit) break;
    }
    return options.limit === undefined ? items : items.slice(0, options.limit);
  }

  /** Reads many items by primary key, in batches of 100. */
  async batchGet(keys: readonly DynamoKeys[]): Promise<DynamoItem[]> {
    if (keys.length === 0) return [];
    const lib = await this.lib();
    const items: DynamoItem[] = [];
    for (const group of chunk(keys, READ_CHUNK)) {
      let pending: Array<{ PK: string; SK: string }> = group.map((keysItem) => ({
        PK: keysItem.PK,
        SK: keysItem.SK
      }));
      for (let attempt = 0; attempt < 3 && pending.length > 0; attempt += 1) {
        const response = await this.send('batchGet', (client) =>
          client.send(
            new lib.BatchGetCommand({
              RequestItems: { [this.table]: { Keys: pending, ConsistentRead: false } }
            })
          )
        );
        for (const raw of response.Responses?.[this.table] ?? []) items.push(toDynamoItem(raw));
        pending = unprocessedKeys(response.UnprocessedKeys, this.table);
      }
    }
    return items;
  }

  /* ------------------------------------------------------------ private */

  private lib(): Promise<LibDynamo> {
    this.libPromise ??= import('@aws-sdk/lib-dynamodb');
    return this.libPromise;
  }

  private client(): Promise<DynamoDBDocumentClient> {
    this.clientPromise ??= this.buildClient();
    return this.clientPromise;
  }

  private async buildClient(): Promise<DynamoDBDocumentClient> {
    const [{ DynamoDBClient }, lib] = await Promise.all([
      import('@aws-sdk/client-dynamodb'),
      this.lib()
    ]);
    const base = new DynamoDBClient({
      region: this.config.region,
      ...(this.config.endpoint === undefined ? {} : { endpoint: this.config.endpoint })
    });
    return lib.DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true }
    });
  }

  private async send<T>(operation: string, run: (client: DynamoDBDocumentClient) => Promise<T>): Promise<T> {
    try {
      return await run(await this.client());
    } catch (error) {
      throw upstream(`dynamodb: ${operation} failed`, {
        table: this.table,
        region: this.config.region,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

/** `PK = :pk` or `PK = :pk AND begins_with(SK, :sk)`. */
function keyExpression(target: QueryTarget, skPrefix: string | undefined): string {
  const base = `${target.pkAttr} = :pk`;
  return skPrefix === undefined ? base : `${base} AND begins_with(${target.skAttr}, :sk)`;
}

function expressionValues(pk: string, skPrefix: string | undefined): Record<string, string> {
  return skPrefix === undefined ? { ':pk': pk } : { ':pk': pk, ':sk': skPrefix };
}

function unprocessedWrites(raw: Record<string, unknown> | undefined, table: string): DynamoItem[] {
  const tableItems = raw?.[table];
  if (!Array.isArray(tableItems)) return [];
  const items: DynamoItem[] = [];
  for (const request of tableItems as Array<Record<string, unknown>>) {
    const put = request.PutRequest as Record<string, unknown> | undefined;
    if (put?.Item !== undefined) items.push(toDynamoItem(put.Item as Record<string, unknown>));
  }
  return items;
}

function unprocessedKeys(raw: Record<string, unknown> | undefined, table: string): Array<{ PK: string; SK: string }> {
  const entry = raw?.[table] as { Keys?: unknown } | undefined;
  if (entry === undefined || !Array.isArray(entry.Keys)) return [];
  return (entry.Keys as Array<Record<string, unknown>>).map((key) => ({
    PK: readString(key, ATTRS.pk),
    SK: readString(key, ATTRS.sk)
  }));
}
