#!/usr/bin/env bash
# Builds both SPAs against the deployed stacks' outputs, uploads them to S3,
# and invalidates the CloudFront caches. Usage: ./scripts/deploy-frontends.sh dev|prod
set -euo pipefail

ENV="${1:?usage: deploy-frontends.sh <dev|prod>}"

get_output() { # stack-suffix output-key
  aws cloudformation describe-stacks \
    --stack-name "JJ-${ENV}-$1" \
    --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" \
    --output text
}

export VITE_CUSTOMER_POOL_ID="$(get_output Auth CustomerPoolId)"
export VITE_CUSTOMER_CLIENT_ID="$(get_output Auth CustomerClientId)"
export VITE_ADMIN_POOL_ID="$(get_output Auth AdminPoolId)"
export VITE_ADMIN_CLIENT_ID="$(get_output Auth AdminClientId)"
# API is reached same-origin through CloudFront's /api/* behavior.
export VITE_API_BASE=""

CUSTOMER_BUCKET="$(get_output Frontend customerBucketName)"
CUSTOMER_DIST="$(get_output Frontend customerDistributionId)"
CUSTOMER_URL="$(get_output Frontend customerUrl)"
ADMIN_BUCKET="$(get_output Frontend adminBucketName)"
ADMIN_DIST="$(get_output Frontend adminDistributionId)"
ADMIN_URL="$(get_output Frontend adminUrl)"

echo "Building customer-web…"
pnpm --filter @jj/customer-web build
echo "Building admin-web…"
pnpm --filter @jj/admin-web build

echo "Uploading…"
# Hashed assets: cache forever. index.html: always revalidate.
aws s3 sync apps/customer-web/dist "s3://${CUSTOMER_BUCKET}" --delete \
  --cache-control "public,max-age=31536000,immutable" --exclude index.html
aws s3 cp apps/customer-web/dist/index.html "s3://${CUSTOMER_BUCKET}/index.html" \
  --cache-control "no-cache"
aws s3 sync apps/admin-web/dist "s3://${ADMIN_BUCKET}" --delete \
  --cache-control "public,max-age=31536000,immutable" --exclude index.html
aws s3 cp apps/admin-web/dist/index.html "s3://${ADMIN_BUCKET}/index.html" \
  --cache-control "no-cache"

echo "Invalidating CloudFront…"
aws cloudfront create-invalidation --distribution-id "${CUSTOMER_DIST}" --paths "/index.html" >/dev/null
aws cloudfront create-invalidation --distribution-id "${ADMIN_DIST}" --paths "/index.html" >/dev/null

echo "Done."
echo "  customer: ${CUSTOMER_URL}"
echo "  admin:    ${ADMIN_URL}"
