/**
 * Skeletons of the two `CreateEvaluationJob` payloads. They are written to disk
 * for inspection and for the AWS CLI; the placeholders (S3 URI, role, knowledge
 * base id) are the only values a human must fill in.
 *
 * Field names follow the published shapes of the service; spec item 24.9 asks
 * to confirm them before the first real job.
 */

import type { CustomMetric } from './bedrock.ts';

const ROLE_PLACEHOLDER = '<BEDROCK_EVALUATION_ROLE_ARN>';
const BUCKET_PLACEHOLDER = 's3://<evidence-bucket>/eval';

/** `create-evaluation-job` payload for the attachment model-as-judge task. */
export function modelJudgePayload(modelIdentifier: string, metrics: readonly CustomMetric[]): unknown {
  return {
    jobName: 'registre-attachment-model-judge',
    roleArn: ROLE_PLACEHOLDER,
    evaluationConfig: {
      automated: {
        datasetMetricConfigs: [
          {
            taskType: 'General',
            dataset: {
              name: 'registre-attachment',
              datasetLocation: { s3Uri: `${BUCKET_PLACEHOLDER}/attachment-dataset.jsonl` }
            },
            metricNames: metrics.map((metric) => metric.metricName)
          }
        ],
        customMetricDefinitions: metrics
      }
    },
    inferenceConfig: {
      models: [{ bedrockModel: { modelIdentifier } }]
    }
  };
}

/** `create-evaluation-job` payload for the knowledge base question task. */
export function knowledgeBasePayload(modelIdentifier: string, knowledgeBaseId: string, metrics: readonly string[]): unknown {
  return {
    jobName: 'registre-qa-knowledge-base',
    roleArn: ROLE_PLACEHOLDER,
    evaluationConfig: {
      knowledgeBase: {
        knowledgeBaseId,
        datasetMetricConfigs: [
          {
            taskType: 'Custom',
            dataset: {
              name: 'registre-qa',
              datasetLocation: { s3Uri: `${BUCKET_PLACEHOLDER}/qa-dataset.jsonl` }
            },
            metricNames: [...metrics]
          }
        ]
      }
    },
    inferenceConfig: {
      ragConfigs: [
        {
          knowledgeBaseConfig: {
            retrieveAndGenerateConfig: {
              type: 'KNOWLEDGE_BASE',
              knowledgeBase: { knowledgeBaseId }
            }
          }
        }
      ]
    }
  };
}
