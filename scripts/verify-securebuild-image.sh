#!/bin/bash
set -euo pipefail

# verify-securebuild-image.sh
#
# Verifies supply chain artifacts for images rebuilt by SecureBuild.
# Checks three things:
#   1. SLSA v1.0 provenance attestation
#   2. Cosign image signature
#   3. SBOM (SPDX) attestation
#
# All artifacts are signed using keyless signing (Sigstore Fulcio + Rekor),
# verified by the GCP service account identity that performed the signing.
#
# Prerequisites:
#   - cosign (https://docs.sigstore.dev/cosign/system_config/installation/)
#   - jq (optional, for provenance detail output)
#
# Usage:
#   ./verify-securebuild-image.sh <image-with-digest> [--identity <email>] [--issuer <url>]
#
# Examples:
#   ./verify-securebuild-image.sh registry.example.com/myimage@sha256:abc123
#   ./verify-securebuild-image.sh registry.example.com/myimage@sha256:abc123 \
#     --identity attestor@project.iam.gserviceaccount.com
#
# Environment variables (alternative to flags):
#   SECUREBUILD_IDENTITY    - Fulcio certificate identity (GCP service account email)
#   SECUREBUILD_OIDC_ISSUER - OIDC issuer URL (default: https://accounts.google.com)

SECUREBUILD_OIDC_ISSUER="${SECUREBUILD_OIDC_ISSUER:-https://accounts.google.com}"
SECUREBUILD_IDENTITY="${SECUREBUILD_IDENTITY:-}"

usage() {
    echo "Usage: $0 <image-with-digest> [--identity <email>] [--issuer <url>]"
    echo ""
    echo "Verifies SLSA provenance, cosign signature, and SBOM attestation"
    echo "for images rebuilt by SecureBuild."
    echo ""
    echo "Arguments:"
    echo "  image-with-digest   Image reference with digest (e.g., registry.example.com/image@sha256:abc123)"
    echo ""
    echo "Options:"
    echo "  --identity <email>  Fulcio certificate identity (GCP service account email)"
    echo "                      Can also be set via SECUREBUILD_IDENTITY env var"
    echo "  --issuer <url>      OIDC issuer URL (default: https://accounts.google.com)"
    echo "                      Can also be set via SECUREBUILD_OIDC_ISSUER env var"
    echo "  --help              Show this help message"
    exit 1
}

# Parse arguments
IMAGE=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --identity)
            SECUREBUILD_IDENTITY="$2"
            shift 2
            ;;
        --issuer)
            SECUREBUILD_OIDC_ISSUER="$2"
            shift 2
            ;;
        --help|-h)
            usage
            ;;
        -*)
            echo "Error: Unknown option $1"
            usage
            ;;
        *)
            if [[ -z "$IMAGE" ]]; then
                IMAGE="$1"
            else
                echo "Error: Unexpected argument $1"
                usage
            fi
            shift
            ;;
    esac
done

if [[ -z "$IMAGE" ]]; then
    echo "Error: Image reference is required"
    usage
fi

if [[ -z "$SECUREBUILD_IDENTITY" ]]; then
    echo "Error: SecureBuild signing identity is required."
    echo "Set via --identity flag or SECUREBUILD_IDENTITY environment variable."
    echo ""
    echo "Contact your SecureBuild administrator for the signing identity."
    exit 1
fi

# Validate image has a digest
if [[ "$IMAGE" != *"@sha256:"* ]]; then
    echo "Error: Image must be referenced by digest (e.g., image@sha256:abc123)"
    echo "Received: $IMAGE"
    echo ""
    echo "To get the digest for a tag, run:"
    echo "  crane digest <image:tag>"
    exit 1
fi

# Check for cosign
if ! command -v cosign &> /dev/null; then
    echo "Error: cosign is not installed"
    echo "Install from: https://docs.sigstore.dev/cosign/system_config/installation/"
    exit 1
fi

PASSED=0
FAILED=0

echo "Verifying SecureBuild image: $IMAGE"
echo "Identity: $SECUREBUILD_IDENTITY"
echo "Issuer:   $SECUREBUILD_OIDC_ISSUER"
echo ""

# Step 1: Verify SLSA Provenance
echo "Step 1/3: Verifying SLSA provenance attestation..."
if cosign verify-attestation \
    --type https://slsa.dev/provenance/v1 \
    --certificate-identity "${SECUREBUILD_IDENTITY}" \
    --certificate-oidc-issuer "${SECUREBUILD_OIDC_ISSUER}" \
    "${IMAGE}" > /tmp/securebuild-slsa-output.json 2>/dev/null; then
    echo "  PASSED: SLSA provenance verified"

    # Show provenance details if jq is available
    if command -v jq &> /dev/null; then
        jq -r '
            .payload | @base64d | fromjson |
            "  Build Type:  \(.predicate.buildDefinition.buildType)",
            "  Builder:     \(.predicate.runDetails.builder.id)",
            "  Build ID:    \(.predicate.runDetails.metadata.invocationId)",
            "  Started:     \(.predicate.runDetails.metadata.startedOn // "N/A")",
            "  Finished:    \(.predicate.runDetails.metadata.finishedOn // "N/A")"
        ' /tmp/securebuild-slsa-output.json 2>/dev/null || true
    fi
    PASSED=$((PASSED + 1))
else
    echo "  FAILED: SLSA provenance verification failed"
    FAILED=$((FAILED + 1))
fi
rm -f /tmp/securebuild-slsa-output.json
echo ""

# Step 2: Verify Image Signature
echo "Step 2/3: Verifying image signature..."
if cosign verify \
    --certificate-identity "${SECUREBUILD_IDENTITY}" \
    --certificate-oidc-issuer "${SECUREBUILD_OIDC_ISSUER}" \
    "${IMAGE}" > /dev/null 2>&1; then
    echo "  PASSED: Image signature verified"
    PASSED=$((PASSED + 1))
else
    echo "  FAILED: Image signature verification failed"
    FAILED=$((FAILED + 1))
fi
echo ""

# Step 3: Verify SBOM Attestation
echo "Step 3/3: Verifying SBOM attestation..."
if cosign verify-attestation \
    --type https://spdx.dev/Document \
    --certificate-identity "${SECUREBUILD_IDENTITY}" \
    --certificate-oidc-issuer "${SECUREBUILD_OIDC_ISSUER}" \
    "${IMAGE}" > /dev/null 2>&1; then
    echo "  PASSED: SBOM attestation verified"
    PASSED=$((PASSED + 1))
else
    echo "  FAILED: SBOM attestation verification failed"
    FAILED=$((FAILED + 1))
fi
echo ""

# Summary
echo "========================================="
echo "Verification Summary: $PASSED/3 passed, $FAILED/3 failed"
echo "========================================="

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi

echo ""
echo "All verification steps passed."
