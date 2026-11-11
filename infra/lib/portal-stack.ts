/**
 * PortalStack — static hosting for the React portal.
 *
 * Private S3 bucket behind CloudFront with Origin Access Control (OAC), no
 * public bucket, HTTPS only, security headers, and a single-page-app fallback
 * so `/readiness` or `/queue` survive a reload.
 *
 * The build output (`portal/dist`) is produced by the `portal` app, which lives
 * in another package. When it is absent — first checkout, CI synth — the stack
 * still deploys an empty bucket and the upload is skipped, so `cdk synth`
 * never depends on a front-end build.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import { bucketName, resourceName, type RegistreConfig } from './config';
import { REPO_ROOT } from './handlers';

export interface PortalStackProps extends cdk.StackProps {
  readonly config: RegistreConfig;
  /** Public URL of the API, injected into the SPA at build time. */
  readonly apiUrl: string;
}

export class PortalStack extends cdk.Stack {
  public readonly distribution: cloudfront.Distribution;
  public readonly bucket: s3.Bucket;

  public constructor(scope: Construct, id: string, props: PortalStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.bucket = new s3.Bucket(this, 'Assets', {
      bucketName: bucketName(config, 'portal'),
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    this.distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: resourceName(config, 'portal'),
      defaultRootObject: 'index.html',
      // No custom certificate on purpose: the demo runs on the CloudFront
      // default domain, which fixes the TLS policy. Attach an ACM certificate
      // in us-east-1 (CloudFront requirement) to raise it to TLSv1.2_2021.
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.minutes(1) }
      ]
    });

    this.deployAssets();

    new cdk.CfnOutput(this, 'PortalUrl', { value: `https://${this.distribution.distributionDomainName}` });
    new cdk.CfnOutput(this, 'PortalBucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'PortalApiUrl', { value: props.apiUrl });
  }

  /** Uploads `portal/dist` when it exists; skips it (with a note) otherwise. */
  private deployAssets(): void {
    const dist = join(REPO_ROOT, 'portal', 'dist');
    if (!existsSync(dist)) {
      cdk.Annotations.of(this).addWarning(
        'portal/dist is absent: the distribution is created but no assets are uploaded. Run `npm run build` in portal/ then redeploy.'
      );
      return;
    }
    new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [s3deploy.Source.asset(dist)],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      prune: true,
      memoryLimit: 512
    });
  }
}
