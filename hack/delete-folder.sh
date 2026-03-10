#!/bin/bash

set -euo pipefail

# Required environment variables
: "${R2_ACCESS_KEY_ID:?Set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Set R2_SECRET_ACCESS_KEY}"
: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID}"
: "${R2_BUCKET_NAME:?Set R2_BUCKET_NAME}"
: "${R2_FOLDER_PREFIX:?Set R2_FOLDER_PREFIX (e.g., 'some/folder/')}"
: "${AWS_REGION:=auto}"  # R2 ignores region, but aws-cli needs one

ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "Listing objects in s3://${R2_BUCKET_NAME}/${R2_FOLDER_PREFIX}"

aws s3api list-objects-v2 \
  --bucket "$R2_BUCKET_NAME" \
  --prefix "$R2_FOLDER_PREFIX" \
  --endpoint-url "$ENDPOINT" \
  --query 'Contents[].Key' \
  --output text \
  --region "$AWS_REGION" |
  tr '\t' '\n' > keys_to_delete.txt

if [ ! -s keys_to_delete.txt ]; then
  echo "No objects found under prefix '${R2_FOLDER_PREFIX}'."
  exit 0
fi

echo "Found $(wc -l < keys_to_delete.txt) objects. Deleting..."

# Delete in batches of 1000 (S3 limit)
split -l 1000 keys_to_delete.txt delete_batch_

for batch in delete_batch_*; do
  delete_payload=$(jq -R . < "$batch" | jq -s --arg bucket "$R2_BUCKET_NAME" '{Bucket: $bucket, Delete: {Objects: map({Key: .})}}')

  aws s3api delete-objects \
    --endpoint-url "$ENDPOINT" \
    --region "$AWS_REGION" \
    --cli-input-json "$delete_payload"
done

echo "✅ Folder '${R2_FOLDER_PREFIX}' deleted from bucket '${R2_BUCKET_NAME}'."

# Clean up
rm -f keys_to_delete.txt delete_batch_*
