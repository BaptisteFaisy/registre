/**
 * DataStack — the state store (chapter 14, ENF-SEC-01).
 *
 * A single DynamoDB table keeps every entity behind one billing and one
 * backup story. Key layout (documented once, here, because every adapter in
 * `src/store/**` depends on it):
 *
 *   pk = FRAMEWORK#<id>            sk = META                 framework
 *   pk = FRAMEWORK#<id>            sk = CONTROL#<id>         control
 *   pk = FRAMEWORK#<id>            sk = STATUS#<controlId>   control state
 *   pk = FRAMEWORK#<id>            sk = TREND#<iso8601>      readiness snapshot
 *   pk = EVIDENCE#<id>             sk = META                 evidence
 *   pk = EVIDENCE#<id>             sk = ATTACH#<controlId>   attachment
 *   pk = EVIDENCE#<id>             sk = SUFF#<attachmentId>  sufficiency
 *   pk = CONTROL#<id>              sk = REMINDER#<iso8601>   reminder
 *   pk = VALIDATION#<status>       sk = <createdAt>#<id>     validation queue
 *   pk = PACK#<id>                 sk = META                 audit pack
 *   pk = AUDITLOG                  sk = <zero-padded seq>    hash-chained log
 *   pk = SETTINGS                  sk = META                 settings
 *
 * gsi1 answers "find by content hash" (deduplication, EF-COL-05) and
 * "everything of one framework". gsi2 answers the portal lists: validation
 * queue by status, evidence by access level, statuses by control state.
 *
 * On-demand capacity: an MSP produces a hundred evidences a month, provisioned
 * capacity would cost more and throttle the nightly backfill.
 */

import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import type { Construct } from 'constructs';
import { resourceName, type RegistreConfig } from './config';

export interface DataStackProps extends cdk.StackProps {
  readonly config: RegistreConfig;
  /** Customer-managed key shared with the vault (single revocation point). */
  readonly key: kms.IKey;
}

export class DataStack extends cdk.Stack {
  public readonly table: dynamodb.Table;

  public constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config, key } = props;

    // Legacy table, kept only so the stacks that still import its outputs can
    // move to the new table in the same deployment; it never held data (its
    // key names did not match `src/store/dynamoKeys.ts`). Remove once unused.
    const legacy = new dynamodb.Table(this, 'State', {
      tableName: resourceName(config, 'state'),
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    legacy.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.INCLUDE,
      nonKeyAttributes: ['sha256', 'frameworkId', 'controlId', 'status', 'accessLevel']
    });
    legacy.addGlobalSecondaryIndex({
      indexName: 'gsi2',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY
    });

    // The state table, with the key and index names the store code uses
    // (`ATTRS` and `INDEX_NAMES` in src/store/dynamoKeys.ts): PK/SK and three
    // overloaded indexes, fully projected so a query never needs a second read.
    this.table = new dynamodb.Table(this, 'Store', {
      tableName: resourceName(config, 'store'),
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: key,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });
    for (const [indexName, n] of [['gsi1', 1], ['gsi2', 2], ['gsi3', 3]] as const) {
      this.table.addGlobalSecondaryIndex({
        indexName,
        partitionKey: { name: `GSI${n}PK`, type: dynamodb.AttributeType.STRING },
        sortKey: { name: `GSI${n}SK`, type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL
      });
    }
    new cdk.CfnOutput(this, 'LegacyStateTableName', { value: legacy.tableName });
    this.exportValue(legacy.tableName);
    this.exportValue(legacy.tableArn);

    new cdk.CfnOutput(this, 'StateTableName', { value: this.table.tableName });
    new cdk.CfnOutput(this, 'StateTableArn', { value: this.table.tableArn });
  }
}
