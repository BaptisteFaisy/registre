/**
 * VaultStack — the evidence vault (ENF-INT-01, ENF-SEC-01).
 *
 * One S3 bucket holds every byte the product keeps: raw evidence, imported
 * frameworks, assembled audit packs. Three properties are non-negotiable and
 * encoded here rather than in application code:
 *
 *  1. versioning — a re-upload never destroys the previous content;
 *  2. Object Lock in the strict retention mode (AWS's non-governance mode) —
 *     nobody, including the account root, can overwrite or delete a locked
 *     object before `retentionMonths` elapse;
 *  3. SSE-KMS with a customer-managed key — the same key is used by DynamoDB
 *     and the Bedrock knowledge bases so a single revocation point exists.
 *
 * Public access is blocked at bucket and account-policy level; `enforceSSL`
 * denies every non-TLS request.
 */

import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { bucketName, resourceName, type RegistreConfig } from './config';

/** Key prefixes inside the vault; the pipeline and the collectors share them. */
export const VAULT_PREFIXES = {
  evidence: 'evidence/',
  frameworks: 'frameworks/',
  packs: 'packs/'
} as const;

export interface VaultStackProps extends cdk.StackProps {
  readonly config: RegistreConfig;
}

export class VaultStack extends cdk.Stack {
  /** The evidence vault itself (versioned, locked, KMS-encrypted). */
  public readonly bucket: s3.Bucket;
  /** Customer-managed key shared by S3, DynamoDB and the Bedrock roles. */
  public readonly key: kms.Key;

  public constructor(scope: Construct, id: string, props: VaultStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.key = new kms.Key(this, 'VaultKey', {
      alias: `alias/${resourceName(config, 'vault')}`,
      description: 'Registre evidence vault - S3, DynamoDB and Bedrock at-rest encryption',
      enableKeyRotation: true,
      pendingWindow: Duration.days(30),
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    this.bucket = new s3.Bucket(this, 'EvidenceVault', {
      bucketName: bucketName(config, 'vault'),
      versioned: true,
      objectLockEnabled: true,
      // `ObjectLockRetention.compliance(...)` is the CDK name of AWS's strict,
      // non-governance retention mode; it has nothing to do with the banned
      // wording of ENF-IA-01 (no control state is ever called that).
      objectLockDefaultRetention: s3.ObjectLockRetention.compliance(Duration.days(config.retentionDays)),
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.key,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      eventBridgeEnabled: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'cold-storage-after-90-days',
          enabled: true,
          transitions: [{ storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: Duration.days(90) }]
        },
        {
          id: 'expire-noncurrent-after-retention',
          enabled: true,
          noncurrentVersionExpiration: Duration.days(config.retentionDays + 31)
        },
        { id: 'abort-incomplete-uploads', enabled: true, abortIncompleteMultipartUploadAfter: Duration.days(7) }
      ]
    });

    // Deny every non-TLS request, including from inside the account.
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyInsecureTransport',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['s3:*'],
        resources: [this.bucket.bucketArn, `${this.bucket.bucketArn}/*`],
        conditions: { Bool: { 'aws:SecureTransport': 'false' } }
      })
    );

    new cdk.CfnOutput(this, 'VaultBucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'VaultBucketArn', { value: this.bucket.bucketArn });
    new cdk.CfnOutput(this, 'VaultKeyArn', { value: this.key.keyArn });
    new cdk.CfnOutput(this, 'VaultRetentionDays', {
      value: String(config.retentionDays),
      description: `Object Lock strict-mode retention (${config.retentionMonths} months)`
    });
  }
}
