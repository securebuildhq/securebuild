#!/bin/bash

# Script to test the Custom APKO API
# This demonstrates the workflow for submitting custom APKO configurations

set -e

API_BASE="http://localhost:3001"
REGISTRY_URL="ttl.sh/dmitriy"
REGISTRY_USERNAME="username"
REGISTRY_PASSWORD="password"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== Custom APKO API Test Script ===${NC}"

# Check if SERVICE_ACCOUNT_TOKEN is set
if [ -z "$SERVICE_ACCOUNT_TOKEN" ]; then
    echo -e "${RED}Error: SERVICE_ACCOUNT_TOKEN environment variable is required${NC}"
    echo "Please set your service account token:"
    echo "export SERVICE_ACCOUNT_TOKEN='your_token_here'"
    exit 1
fi

echo -e "${YELLOW}Using API endpoint: $API_BASE${NC}"
echo -e "${YELLOW}Using registry: $REGISTRY_URL${NC}"
echo

# Step 1: Create external registry credentials first
echo -e "${BLUE}Step 1: Creating external registry credentials...${NC}"

REGISTRY_HOST="ttl.sh"
REGISTRY_PAYLOAD=$(cat <<EOF
{
  "host": "$REGISTRY_HOST",
  "username": "$REGISTRY_USERNAME", 
  "password": "$REGISTRY_PASSWORD"
}
EOF
)

echo "Creating registry credentials..."
REGISTRY_RESPONSE=$(curl -s -X POST "$API_BASE/api/v1/custom-external-registry" \
  -H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$REGISTRY_PAYLOAD")

echo "Registry API Response:"
echo "$REGISTRY_RESPONSE" | jq .

# Check if registry creation was successful
if echo "$REGISTRY_RESPONSE" | jq -e '.success' > /dev/null; then
    REGISTRY_ID=$(echo "$REGISTRY_RESPONSE" | jq -r '.registry_id')
    echo -e "${GREEN}✓ Registry credentials created successfully (ID: $REGISTRY_ID)${NC}"
else
    echo -e "${RED}✗ Failed to create registry credentials${NC}"
    ERROR_MSG=$(echo "$REGISTRY_RESPONSE" | jq -r '.error // "Unknown error"')
    echo "Error: $ERROR_MSG"
    exit 1
fi

echo

# Step 2: Submit APKO configuration
echo -e "${BLUE}Step 2: Submitting APKO configuration...${NC}"

# Create APKO YAML configuration using CVE0
APKO_YAML="contents:
  repositories:
    - https://apk.cve0.io
  keyring:
    - https://apk.cve0.io/key/cve0-signing.rsa.pub
  packages:
    - ca-certificates-bundle
    - busybox
    - curl
entrypoint:
  command: /bin/busybox
cmd: sh
work-dir: /app
environment:
  PATH: /usr/local/bin:/usr/bin:/bin
  HOME: /app
accounts:
  run-as: nobody
archs:
  - x86_64
  - aarch64"

# Base64 encode the APKO YAML to preserve exact formatting
APKO_CONFIG_BASE64=$(echo "$APKO_YAML" | base64 -w 0)

APKO_PAYLOAD=$(cat <<EOF
{
  "name": "test-busybox-$(date +%Y%m%d-%H%M%S)",
  "tags": ["latest", "test-$(date +%s)"],
  "config": "$APKO_CONFIG_BASE64",
  "readme": "Test APKO configuration created by automation script",
  "registry_urls": ["$REGISTRY_URL"]
}
EOF
)

echo "APKO Configuration to submit:"
echo "$APKO_PAYLOAD" | jq .
echo

echo "Submitting APKO configuration..."
APKO_RESPONSE=$(curl -s -X POST "$API_BASE/api/v1/custom-apko" \
  -H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$APKO_PAYLOAD")

echo "APKO API Response:"
echo "$APKO_RESPONSE" | jq .

# Check if APKO creation was successful
if echo "$APKO_RESPONSE" | jq -e '.success' > /dev/null; then
    CUSTOM_IMAGE_ID=$(echo "$APKO_RESPONSE" | jq -r '.custom_image_id')
    CUSTOM_APKO_ID=$(echo "$APKO_RESPONSE" | jq -r '.custom_apko_id')
    echo -e "${GREEN}✓ APKO configuration created successfully${NC}"
    echo "Custom Image ID: $CUSTOM_IMAGE_ID"
    echo "Custom APKO ID: $CUSTOM_APKO_ID"
else
    echo -e "${RED}✗ Failed to create APKO configuration${NC}"
    ERROR_MSG=$(echo "$APKO_RESPONSE" | jq -r '.error // "Unknown error"')
    echo "Error: $ERROR_MSG"
    exit 1
fi

echo


# Step 3: Retrieve the created APKO configuration
echo -e "${BLUE}Step 3: Retrieving APKO configuration...${NC}"

GET_RESPONSE=$(curl -s -X GET "$API_BASE/api/v1/custom-apko?custom_apko_id=$CUSTOM_APKO_ID" \
  -H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN")

echo "Retrieved APKO Configuration:"
echo "$GET_RESPONSE" | jq .

echo
echo "Decoded YAML config:"
echo "$GET_RESPONSE" | jq -r '.config' | base64 -d

if echo "$GET_RESPONSE" | jq -e '.id' > /dev/null; then
    echo -e "${GREEN}✓ Successfully retrieved APKO configuration${NC}"
else
    echo -e "${YELLOW}⚠ Could not retrieve APKO configuration${NC}"
fi

echo

# Step 4: List external registries for the team
echo -e "${BLUE}Step 4: Listing external registries...${NC}"

REGISTRIES_RESPONSE=$(curl -s -X GET "$API_BASE/api/v1/custom-external-registry" \
  -H "Authorization: Bearer $SERVICE_ACCOUNT_TOKEN")

echo "External Registries:"
echo "$REGISTRIES_RESPONSE" | jq .

if echo "$REGISTRIES_RESPONSE" | jq -e '.registries' > /dev/null; then
    REGISTRY_COUNT=$(echo "$REGISTRIES_RESPONSE" | jq '.registries | length')
    echo -e "${GREEN}✓ Found $REGISTRY_COUNT external registr(ies)${NC}"
else
    echo -e "${YELLOW}⚠ No external registries found${NC}"
fi

echo
echo -e "${GREEN}=== Test completed successfully! ===${NC}"
echo
echo "Summary:"
echo "- Custom Image ID: $CUSTOM_IMAGE_ID"
echo "- Custom APKO ID: $CUSTOM_APKO_ID"
echo "- Registry ID: $REGISTRY_ID"
echo "- Registry URL: $REGISTRY_URL"
echo
echo "You can view this custom image in the SecureBuild dashboard at:"
echo "$API_BASE/dashboard/custom-images/$CUSTOM_IMAGE_ID"