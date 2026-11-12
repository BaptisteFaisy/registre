#!/usr/bin/env bash
# Read-only inventory of the deployed instance.
#
# Every call here is a Describe/List/Get: it changes nothing and costs nothing.
# Run it after `aws login` to know exactly what is live, what is empty and what
# the account has spent so far.
#
#   infra/scripts/inventory.sh            # full inventory
#   REGISTRE_REGION=eu-west-1 infra/scripts/inventory.sh
set -euo pipefail

REGION="${REGISTRE_REGION:-eu-central-1}"
BUDGET="${REGISTRE_BUDGET:-registre-monthly}"

section() { printf '\n=== %s ===\n' "$*"; }
run() { timeout 60 "$@" 2>&1 | head -"${INVENTORY_LINES:-20}"; }

section "identity (read-only)"
run aws sts get-caller-identity --query 'Arn' --output text

section "CloudFormation stacks ($REGION)"
run aws cloudformation list-stacks --region "$REGION" \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE CREATE_IN_PROGRESS CREATE_FAILED \
    ROLLBACK_COMPLETE UPDATE_ROLLBACK_COMPLETE DELETE_IN_PROGRESS \
  --query 'StackSummaries[].[StackName,StackStatus]' --output text

section "public endpoints"
run aws cloudformation describe-stacks --stack-name Registre-Portal --region "$REGION" \
  --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text
run aws cloudformation describe-stacks --stack-name Registre-Api --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' --output text

section "Bedrock knowledge bases / Data Automation / guardrails"
run aws bedrock-agent list-knowledge-bases --region "$REGION" \
  --query 'knowledgeBaseSummaries[].[knowledgeBaseId,name,status]' --output text
run aws bedrock-data-automation list-data-automation-projects --region "$REGION" \
  --query 'projects[].[projectName,projectStage,projectType]' --output text
run aws bedrock list-guardrails --region "$REGION" --query 'guardrails[].[id,name]' --output text

section "storage (vault must hold the demonstration corpus once ingested)"
run aws s3api list-buckets --query 'Buckets[?starts_with(Name,`registre-`)].Name' --output text
for bucket in $(aws s3api list-buckets --query 'Buckets[?starts_with(Name,`registre-`)].Name' --output text); do
  count=$(aws s3api list-objects-v2 --bucket "$bucket" --region "$REGION" --query 'length(Contents)' --output text 2>/dev/null || echo 0)
  printf '%-40s %s objects\n' "$bucket" "${count:-0}"
done
run aws dynamodb list-tables --region "$REGION" --query 'TableNames' --output text

section "identities and notifications"
run aws cognito-idp list-user-pools --max-results 20 --region "$REGION" \
  --query 'UserPools[].[Id,Name]' --output text
run aws sesv2 list-email-identities --region "$REGION" \
  --query 'EmailIdentities[].[IdentityName,IdentityType,VerifiedForSendingStatus]' --output text

section "pipeline runs and alarms not OK"
run aws stepfunctions list-state-machines --region "$REGION" \
  --query 'stateMachines[].[name,stateMachineArn]' --output text
run aws cloudwatch describe-alarms --region "$REGION" --state ALARM \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output text

section "resources that would bill while idle"
run aws ec2 describe-instances --region "$REGION" \
  --filters Name=instance-state-name,Values=running,pending \
  --query 'Reservations[].Instances[].[InstanceId,InstanceType]' --output text
run aws ec2 describe-nat-gateways --region "$REGION" \
  --query 'NatGateways[?State!=`deleted`].[NatGatewayId,State]' --output text
run aws opensearchserverless list-collections --region "$REGION" \
  --query 'collectionSummaries[].name' --output text
run aws kms list-keys --region "$REGION" --query 'length(Keys)' --output text

section "budget and spend"
run aws budgets describe-budget --account-id "$(aws sts get-caller-identity --query Account --output text)" \
  --budget-name "$BUDGET" --query 'Budget.[BudgetLimit.Amount,BudgetLimit.Unit,CalculatedSpend.ActualSpend.Amount]' --output text
run aws ce get-cost-and-usage \
  --time-period "Start=$(date -d '-30 days' +%F),End=$(date +%F)" --granularity MONTHLY \
  --metrics UnblendedCost --query 'ResultsByTime[].Total.UnblendedCost.Amount' --output text

printf '\nInventory done — no write call was made.\n'
