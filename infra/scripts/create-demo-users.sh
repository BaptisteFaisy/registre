#!/usr/bin/env bash
# Registre — create the five demo users for the judges (EF-ADM-03).
#
# Cognito passwords are never stored in the repository or in a CloudFormation
# template: this script generates one per user, sets it permanently and prints
# it once. Copy the result into the Devpost testing instructions.
#
# Usage:
#   ./create-demo-users.sh
#   REGISTRE_REGION=eu-central-1 REGISTRE_STACK=Registre-Api ./create-demo-users.sh
#
# Prerequisites: awscli v2, a profile allowed to call cognito-idp:Admin*.
set -euo pipefail

REGION="${REGISTRE_REGION:-eu-west-3}"
STACK="${REGISTRE_STACK:-Registre-Api}"

pool_id="$(aws cloudformation describe-stacks \
  --region "$REGION" --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)"

if [[ -z "$pool_id" || "$pool_id" == "None" ]]; then
  echo "No UserPoolId in stack $STACK ($REGION). Deploy the API stack first." >&2
  exit 1
fi

# login:role:email, one per role of the specification (chapter 6).
USERS=(
  "quality.lead:QUALITY_LEAD:quality.lead@example.com"
  "control.owner:CONTROL_OWNER:control.owner@example.com"
  "executive:EXECUTIVE:executive@example.com"
  "internal.auditor:INTERNAL_AUDITOR:internal.auditor@example.com"
  "admin:ADMIN:admin@example.com"
)

echo "User pool: $pool_id ($REGION)"
printf '%-18s %-18s %s\n' "LOGIN" "ROLE" "PASSWORD"

for entry in "${USERS[@]}"; do
  IFS=':' read -r login role email <<<"$entry"
  # 20 random bytes, base64, stripped of characters the Cognito policy dislikes.
  password="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-20)Aa1!"
  aws cognito-idp admin-create-user \
    --region "$REGION" --user-pool-id "$pool_id" \
    --username "$login" --message-action SUPPRESS \
    --user-attributes "Name=email,Value=$email" "Name=email_verified,Value=true" >/dev/null
  aws cognito-idp admin-set-user-password \
    --region "$REGION" --user-pool-id "$pool_id" --username "$login" \
    --password "$password" --permanent >/dev/null
  aws cognito-idp admin-add-user-to-group \
    --region "$REGION" --user-pool-id "$pool_id" --username "$login" --group-name "$role" >/dev/null
  printf '%-18s %-18s %s\n' "$login" "$role" "$password"
done

echo
echo "Store these credentials in the Devpost testing instructions, never in git."
echo "Rotate with: aws cognito-idp admin-set-user-password --user-pool-id $pool_id --username <login> --password <pw> --permanent"
