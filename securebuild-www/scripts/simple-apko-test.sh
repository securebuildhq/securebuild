#!/bin/bash

# Simple curl-based test for Custom APKO API
# Usage: SERVICE_ACCOUNT_TOKEN=your_token ./scripts/simple-apko-test.sh

set -e

if [ -z "$SERVICE_ACCOUNT_TOKEN" ]; then
    echo "Error: SERVICE_ACCOUNT_TOKEN environment variable is required"
    exit 1
fi

API_BASE="http://localhost:3001"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

echo "Testing Custom APKO API..."

# Create a test custom image ID
CUSTOM_IMAGE_ID="ci$(openssl rand -hex 16)"

echo "1. Creating external registry..."
curl -X POST "$API_BASE/api/v1/custom-external-registry" \
  -H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "custom_image_id": "'$CUSTOM_IMAGE_ID'",
    "registry_url": "ttl.sh/dmitriy",
    "username": "username",
    "password": "password"
  }' | jq .

echo -e "\n2. Submitting APKO configuration..."
curl -X POST "$API_BASE/api/v1/custom-apko" \
  -H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-busybox-'$TIMESTAMP'",
    "tags": ["latest"],
    "config": "contents:\n  repositories:\n    - https://apk.cve0.io\n  keyring:\n    - https://apk.cve0.io/key/cve0-signing.rsa.pub\n  packages:\n    - ca-certificates-bundle\n    - busybox\nentrypoint:\n  command: /bin/busybox\ncmd: sh\nwork-dir: /app\nenvironment:\n  PATH: /usr/local/bin:/usr/bin:/bin\n  HOME: /app",
    "readme": "Test APKO configuration created by simple script",
    "registry_urls": ["ttl.sh/dmitriy"]
  }' | jq .

echo -e "\nTest completed!"