# Proposal: Supply Chain Verification for SecureBuild-Rebuilt Images

**Research document**: [slsa-provenance-generation_research.md](./slsa-provenance-generation_research.md)

---

## TL;DR

When SecureBuild rebuilds an image to patch CVEs, **all three verification steps** in the upstream verification script break — not just SLSA provenance, but also cosign signature verification and SBOM attestation verification. This is because the upstream script is tied to the original build pipeline's identity (GitHub Actions SLSA generators, Replicated's cosign signing keys). This proposal: (1) adds SLSA v1.0 provenance generation to SecureBuild, (2) provides a SecureBuild-owned verification script/API that customers can use for rebuilt images, and (3) documents the verification lifecycle across original and rebuilt images. No database changes are required.

---

## The Problem

When an upstream project (e.g., replicated-sdk) builds an image via GitHub Actions, the build pipeline attaches three supply chain artifacts:

1. **SLSA L3 provenance** — via `slsa-framework/slsa-github-generator`
2. **Cosign signature** — signed with Replicated's environment-specific keys (`cosign-prod.pub`)
3. **SBOM attestation** — signed with the same keys, type `spdxjson`

Customers verify all three using `verify-image.sh` from the replicated-sdk repo. When SecureBuild rebuilds the image ~6 hours later, **all three verification steps fail**:

| Step | What `verify-image.sh` does | Why it fails after rebuild |
|------|---------------------------|---------------------------|
| 1. SLSA | `slsa-verifier verify-image --source-uri github.com/replicatedhq/replicated-sdk` | Provenance is bound to original digest; `slsa-verifier` only trusts GitHub Actions builders |
| 2. Cosign signature | `cosign verify-attestation --key ./cosign-prod.pub --type spdxjson` | SecureBuild uses keyless signing (Fulcio/GCP SA), not Replicated's `cosign-prod.pub` key |
| 3. SBOM download | `cosign download attestation --predicate-type spdxjson` | SecureBuild attests with `predicateType: https://spdx.dev/Document`; download may work but signature verification in Step 2 already failed |

### The Verification Gap

There is no single verification method that works across the full lifecycle of a tag:

```
T+0h    Tag v1.18.2 created, original build pushed
        → verify-image.sh      ✅ (all 3 steps pass)
        → SecureBuild verify    ❌ (no SecureBuild attestations yet)

T+6h    SecureBuild rebuilds, pushes new digest to same tag
        → verify-image.sh      ❌ (all 3 steps fail)
        → SecureBuild verify    ✅ (SecureBuild attestations present)
```

This is a fundamental tension: SLSA L3 proves an artifact came from a specific source+builder pair, and SecureBuild is by definition a *different builder* producing a *different artifact* (with patched CVEs). These are two valid but competing security goals — provenance purity vs. CVE remediation.

**Who is affected**: Any customer verifying supply chain artifacts on images that SecureBuild has rebuilt. The replicated-sdk is the immediate case (per its `verify-image.sh` script), but this applies to any image with upstream verification tooling.

Today, SecureBuild has **no customer-facing verification tooling** — no scripts, no documentation, no published signing identity. Customers have no way to verify SecureBuild-rebuilt images even if they wanted to.

---

## Prototype / Design

### Data Flow

```
VM Build Completes
       |
       v
processImageBuildResults()
       |
       v
processImageTag()
       |
       +---> CosignSignKeylessWithCustomSubject()     [existing: cosign signature]
       |
       +---> CosignAttestKeylessWithCustomSubject()    [existing: SBOM attestation]
       |
       +---> BuildSLSAProvenancePredicate()            [NEW: construct v1.0 predicate]
       |           |
       |           v
       |     Write predicate JSON to tmpDir
       |           |
       |           v
       +---> CosignAttestKeylessWithCustomSubject()    [NEW call: provenance attestation]
                   |
                   v
             Fulcio cert + Rekor tlog + DSSE envelope + OCI artifact manifest
                   |
                   v
             Stored in oci_artifact_blob + oci_artifact_manifest (existing tables)
                   |
                   v
             Served via OCI proxy referrers API (no proxy changes needed)
```

### SLSA Provenance Predicate (v1.0)

```json
{
  "buildDefinition": {
    "buildType": "https://securebuild.com/provenance/image-rebuild/v1",
    "externalParameters": {
      "source": {
        "apkoConfig": "<sha256 of APKO YAML>",
        "tags": ["v1.16.2", "v1.16", "latest"]
      }
    },
    "internalParameters": {
      "builderVersion": "securebuild-worker/<git-sha-or-version>"
    },
    "resolvedDependencies": [
      {
        "uri": "pkg:apk/wolfi/zlib@1.3.1-r2",
        "digest": { "sha256": "..." }
      }
    ]
  },
  "runDetails": {
    "builder": {
      "id": "https://securebuild.com/builder/gcp-vm/v1"
    },
    "metadata": {
      "invocationId": "<imageBuild.ID>",
      "startedOn": "2025-01-15T10:00:00Z",
      "finishedOn": "2025-01-15T10:05:00Z"
    }
  }
}
```

### Verification Path for Customers

Since `slsa-verifier` only trusts hardcoded builders (GitHub Actions SLSA generators), SecureBuild provenance requires a different verification approach. **SecureBuild should own the verification tooling** for its rebuilt images, rather than expecting customers to figure it out.

#### SecureBuild Verification Script (`verify-securebuild-image.sh`)

SecureBuild provides a verification script that mirrors the structure of upstream verification scripts (like replicated-sdk's `verify-image.sh`) but uses SecureBuild's signing identity:

```bash
#!/bin/bash
# verify-securebuild-image.sh
# Verifies supply chain artifacts for SecureBuild-rebuilt images

SECUREBUILD_IDENTITY="<GCP attestor service account email>"
SECUREBUILD_OIDC_ISSUER="https://accounts.google.com"

# Step 1: Verify SLSA Provenance
echo "Step 1: Verifying SLSA provenance..."
cosign verify-attestation \
  --type slsaprovenance \
  --certificate-identity "${SECUREBUILD_IDENTITY}" \
  --certificate-oidc-issuer "${SECUREBUILD_OIDC_ISSUER}" \
  "${IMAGE_WITH_DIGEST}" | jq -r '
    .payload | @base64d | fromjson |
    "Build Type: \(.predicate.buildDefinition.buildType)",
    "Builder: \(.predicate.runDetails.builder.id)",
    "Build ID: \(.predicate.runDetails.metadata.invocationId)",
    "Started: \(.predicate.runDetails.metadata.startedOn)",
    "Finished: \(.predicate.runDetails.metadata.finishedOn)"
  '

# Step 2: Verify Image Signature
echo "Step 2: Verifying image signature..."
cosign verify \
  --certificate-identity "${SECUREBUILD_IDENTITY}" \
  --certificate-oidc-issuer "${SECUREBUILD_OIDC_ISSUER}" \
  "${IMAGE_WITH_DIGEST}"

# Step 3: Verify SBOM Attestation
echo "Step 3: Verifying SBOM attestation..."
cosign verify-attestation \
  --type https://spdx.dev/Document \
  --certificate-identity "${SECUREBUILD_IDENTITY}" \
  --certificate-oidc-issuer "${SECUREBUILD_OIDC_ISSUER}" \
  "${IMAGE_WITH_DIGEST}"
```

#### Unified Verification (Original + SecureBuild)

For customers who want a single script that handles both original and rebuilt images, we provide guidance for a "try both" approach:

```bash
# Try upstream verification first (works for original builds within ~6h of tag)
if slsa-verifier verify-image "${IMAGE_WITH_DIGEST}" --source-uri ... 2>/dev/null; then
  echo "Verified via upstream SLSA provenance"
else
  # Fall back to SecureBuild verification (works after SecureBuild rebuilds)
  if cosign verify-attestation --type slsaprovenance \
    --certificate-identity "${SECUREBUILD_IDENTITY}" \
    --certificate-oidc-issuer "${SECUREBUILD_OIDC_ISSUER}" \
    "${IMAGE_WITH_DIGEST}" 2>/dev/null; then
    echo "Verified via SecureBuild provenance"
  else
    echo "FAILED: No valid provenance found"
    exit 1
  fi
fi
```

#### Where the Script Lives

Options (not mutually exclusive):

| Option | Pros | Cons |
|--------|------|------|
| **A. API endpoint** (`GET /api/verify-image-script`) | Always up-to-date, can be version-specific | Requires network access to fetch |
| **B. Published in SecureBuild docs/repo** | Discoverable, can be vendored | May go stale if identity changes |
| **C. Generated per-image in the web UI** | Pre-filled with correct digest/identity | Requires UI work |

**Recommendation**: Start with **B** (published script with the signing identity baked in) and add **C** (web UI with copy-paste commands) later. The signing identity is stable (it's the GCP service account), so staleness risk is low.

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SLSA predicate version | v1.0 | Forward-compatible, better structure, cosign supports it |
| SLSA level claimed | L2 (informational) | L3 requires hardened build platform audit; we have isolated VMs but no formal audit yet |
| buildType URI | `https://securebuild.com/provenance/image-rebuild/v1` | Customer-facing, permanent, versioned |
| builder.id | `https://securebuild.com/builder/gcp-vm/v1` | Identifies the build platform, not the specific VM |
| What digest to attest | Index digest (same as SBOM attestation) | Consistent with existing attestation behavior; per-arch attestation can follow later |
| Key-based path | No SLSA provenance | Only the keyless VM path has the metadata and identity to produce meaningful provenance |
| Verification tool | `cosign verify-attestation` | `slsa-verifier` has hardcoded trusted builders; cosign is the pragmatic path |
| Verification script ownership | SecureBuild provides it | SecureBuild changes the verification story, so it should own the tooling |

---

## New Subagents / Commands

No new subagents or commands for the build pipeline changes. The verification script is a standalone bash script distributed to customers (not a SecureBuild internal component).

---

## Database

**No database changes required.**

The existing `oci_artifact_blob` and `oci_artifact_manifest` tables already support arbitrary OCI artifact types. The SLSA provenance attestation will be stored as:

- `oci_artifact_blob`: DSSE envelope containing the SLSA provenance in-toto statement
- `oci_artifact_manifest`: OCI artifact manifest with `artifact_type = "application/vnd.in-toto+json"` and layer annotation `dev.cosignproject.cosign/predicateType = "https://slsa.dev/provenance/v1"`

The `predicateType` annotation on the layer descriptor is what differentiates SLSA provenance from SBOM attestations when served through the proxy.

---

## Implementation Plan

### Files to Touch

| File | Change | PR |
|------|--------|----|
| `pkg/cosign/cosign-api.go` | Parameterize `buildCustomSubjectStatement` to accept `predicateType` | 1 |
| `pkg/cosign/keyless.go` | Update `CosignAttestKeylessWithCustomSubject` to accept `predicateType` parameter | 1 |
| `pkg/cosign/slsa.go` | **New file**: SLSA v1.0 predicate builder | 1 |
| `pkg/cosign/slsa_test.go` | **New file**: Unit tests for predicate builder | 1 |
| `pkg/cosign/keyless_test.go` | Update tests for new `predicateType` parameter | 1 |
| `pkg/listener/update-build-image-status.go` | Add SLSA provenance attestation call after SBOM attestation | 2 |
| `certs/verify-securebuild-image.sh` | **New file**: Customer-facing verification script (3 steps) | 3 |
| `securebuild-app/` (TBD) | Verification commands in web UI image detail page | 3 (optional) |

### Pseudo Code

#### 1. Parameterize `buildCustomSubjectStatement` (`pkg/cosign/cosign-api.go`)

```go
// BEFORE:
func buildCustomSubjectStatement(ctx context.Context, digest string, predicate interface{}) InTotoStatement {
    // ...
    return InTotoStatement{
        PredicateType: "https://spdx.dev/Document",  // hardcoded
        // ...
    }
}

// AFTER:
func buildCustomSubjectStatement(ctx context.Context, digest string, predicateType string, predicate interface{}) InTotoStatement {
    // ...
    return InTotoStatement{
        PredicateType: predicateType,
        // ...
    }
}
```

Update all callers:
- `CosignAttestWithCustomSubject` -> pass `"https://spdx.dev/Document"`
- `CosignAttestKeylessWithCustomSubject` -> pass the predicateType parameter

#### 2. Update `CosignAttestKeylessWithCustomSubject` signature (`pkg/cosign/keyless.go`)

```go
// BEFORE:
func CosignAttestKeylessWithCustomSubject(
    ctx context.Context,
    predicatePath string,
    digestRef string,
    oidcProvider oidc.OIDCProvider,
    imageCatalogID string,
) error {

// AFTER:
func CosignAttestKeylessWithCustomSubject(
    ctx context.Context,
    predicatePath string,
    predicateType string,       // NEW: e.g. "https://spdx.dev/Document" or "https://slsa.dev/provenance/v1"
    digestRef string,
    oidcProvider oidc.OIDCProvider,
    imageCatalogID string,
) error {
    // ... existing code, but pass predicateType to buildCustomSubjectStatement
    statement := buildCustomSubjectStatement(ctx, digest, predicateType, predicate)
    // ... rest unchanged
}
```

#### 3. SLSA v1.0 Predicate Builder (`pkg/cosign/slsa.go` -- new file)

Uses the official `github.com/in-toto/in-toto-golang/in_toto/slsa_provenance/v1` types (already an indirect dependency in go.mod). Only SecureBuild-specific types are defined locally.

```go
package cosign

import (
    slsav1 "github.com/in-toto/in-toto-golang/in_toto/slsa_provenance/v1"
)

const SecureBuildBuildType = "https://securebuild.com/provenance/image-rebuild/v1"
const SecureBuildBuilderID = "https://securebuild.com/builder/gcp-vm/v1"

// SecureBuildSourceParameters holds build inputs specific to SecureBuild.
type SecureBuildSourceParameters struct {
    ApkoConfigDigest string   `json:"apkoConfigDigest"`
    Tags             []string `json:"tags"`
}

// SLSAProvenanceInput holds the metadata needed to build a SLSA provenance predicate.
type SLSAProvenanceInput struct {
    BuildID, BuilderID string
    StartedOn, FinishedOn *time.Time
    ApkoYAML string
    Tags []string
}

// BuildSLSAProvenancePredicate constructs a SLSA v1.0 provenance predicate
// using the official in-toto types.
func BuildSLSAProvenancePredicate(input SLSAProvenanceInput) slsav1.ProvenancePredicate {
    apkoDigest := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(input.ApkoYAML)))

    return slsav1.ProvenancePredicate{
        BuildDefinition: slsav1.ProvenanceBuildDefinition{
            BuildType: SecureBuildBuildType,
            ExternalParameters: SecureBuildSourceParameters{
                ApkoConfigDigest: apkoDigest,
                Tags:             input.Tags,
            },
            ResolvedDependencies: []slsav1.ResourceDescriptor{},
        },
        RunDetails: slsav1.ProvenanceRunDetails{
            Builder:       slsav1.Builder{ID: SecureBuildBuilderID},
            BuildMetadata: slsav1.BuildMetadata{
                InvocationID: input.BuildID,
                StartedOn:    input.StartedOn,
                FinishedOn:   input.FinishedOn,
            },
        },
    }
}
```

The predicate type constant is `slsav1.PredicateSLSAProvenance` (`"https://slsa.dev/provenance/v1"`).

#### 4. Integrate into Build Pipeline (`pkg/listener/update-build-image-status.go`)

```go
// In processImageTag(), after the existing SBOM attestation block (line ~657):

// Keyless SLSA provenance attestation
imageBuild, err := image.GetImageBuildByID(ctx, /* buildID from caller */)
if err == nil {
    slsaInput := cosign.SLSAProvenanceInput{
        BuildID:    imageBuild.ID,
        BuilderID:  derefString(imageBuild.BuilderID),
        StartedOn:  imageBuild.BuildStartedAt,
        FinishedOn: imageBuild.BuildFinishedAt,
        ApkoYAML:   apko.LatestVersion.APKOYAML,
        Tags:       actualTags,  // need to thread this through
    }
    slsaPredicate := cosign.BuildSLSAProvenancePredicate(slsaInput)

    // Write predicate to temp file
    slsaPredicateBytes, _ := json.Marshal(slsaPredicate)
    slsaPath := filepath.Join(tmpDir, "slsa-provenance.json")
    os.WriteFile(slsaPath, slsaPredicateBytes, 0644)

    if err := cosign.CosignAttestKeylessWithCustomSubject(
        ctx, slsaPath, slsav1.PredicateSLSAProvenance,
        digestRef, provider, imageCatalogID,
    ); err != nil {
        logger.Warn("keyless SLSA provenance attestation failed", zap.Error(err))
    }
}
```

Note: `processImageTag` currently does not receive `buildID` or `imageBuild` directly. We need to thread `buildID` through from `processImageBuildResults` (which does have it). This requires adding `buildID` as a parameter to `processImageTag`.

#### 5. Thread buildID through to processImageTag

```go
// BEFORE (line ~357):
imageCatalogID, err := processImageTag(ctx, img, apko, actualTag, ociPathWithoutTag, scanAt, ...)

// AFTER:
imageCatalogID, err := processImageTag(ctx, img, apko, actualTag, ociPathWithoutTag, scanAt,
    buildID, imageBuild, actualTags, ...)  // add buildID, imageBuild, and full actualTags list
```

### Toggle Strategy

**No feature flag initially.** Rationale:
- SLSA provenance is additive (a new attestation alongside existing ones)
- It does not modify existing signatures or SBOM attestations
- The OCI proxy serves attestations based on what exists in the DB; extra attestations are harmless
- Customers must explicitly opt in by running `cosign verify-attestation --type slsaprovenance`

If we need to disable it quickly, we can add a config parameter (`SLSA_PROVENANCE_ENABLED=true/false`) checked in `processImageTag` before the SLSA attestation block.

### External Contracts

**APIs consumed:**
- Fulcio (`fulcio.sigstore.dev`) -- signing certificate (existing)
- Rekor (`rekor.sigstore.dev`) -- transparency log (existing)

**APIs emitted:**
- OCI referrers API -- an additional artifact manifest with `predicateType: https://slsa.dev/provenance/v1` will appear in referrers responses for attested digests

**No new API endpoints.** The OCI proxy already serves all artifact manifests linked to a subject digest.

---

## Testing

### Unit Tests (`pkg/cosign/slsa_test.go`)

```go
func TestBuildSLSAProvenancePredicate(t *testing.T) {
    // Test that predicate has correct buildType, builder.id
    // Test with nil timestamps
    // Test that APKO config is hashed correctly
    // Test that tags are included in externalParameters
}
```

Pattern: Follow the existing pattern in `keyless_test.go` using function variable injection for mocking external dependencies.

### Unit Tests for Updated `CosignAttestKeylessWithCustomSubject`

Update `TestCosignAttestKeylessWithCustomSubject` in `keyless_test.go` to:
- Pass the new `predicateType` parameter
- Assert that the stored DSSE envelope contains the correct predicateType in the in-toto statement
- Add a second test case using `SLSAProvenancePredicateType` instead of SPDX

### Integration Tests

- Verify that a build produces both SBOM and SLSA provenance attestations
- Verify that `cosign verify-attestation --type slsaprovenance` succeeds against the proxy
- Verify that the OCI referrers API returns both attestation types

### Test Data / Fixtures

- Stub SLSA predicate JSON file
- Reuse existing `stubOIDCProvider`, `stubFulcio` from `keyless_test.go`

---

## Backward Compatibility

### API Compatibility
- The OCI referrers API response will include an additional artifact manifest. Clients that enumerate referrers will see one more entry. This is additive and does not break existing clients.
- Existing SBOM attestation verification is unchanged.
- Existing cosign signature verification is unchanged.

### Function Signature Change
- `CosignAttestKeylessWithCustomSubject` gains a new `predicateType` parameter. This is a **breaking change** for any internal callers. There are exactly two call sites:
  1. `pkg/listener/update-build-image-status.go:657` (SBOM attestation)
  2. The new SLSA provenance call

  Both will be updated in the same PR.

- `buildCustomSubjectStatement` gains a new `predicateType` parameter. This is package-private and called from:
  1. `CosignAttestWithCustomSubject` (key-based, cosign-api.go)
  2. `CosignAttestKeylessWithCustomSubject` (keyless, keyless.go)

  Both updated in the same PR.

---

## Migrations

**No database migrations required.** The feature uses existing tables with no schema changes.

**Deployment requires no special handling.** The SLSA provenance attestation is additive. Once the new code is deployed, all subsequent builds will produce provenance attestations. Existing images (already built) will not retroactively gain provenance.

---

## Trade-offs

| Trade-off | What we chose | What we gave up | Why |
|-----------|---------------|-----------------|-----|
| SLSA level | L2 (informational) | L3 claim | L3 requires formal audit of build platform hardening; we can upgrade the claim later without code changes |
| Verification tool | `cosign verify-attestation` | `slsa-verifier` compatibility | `slsa-verifier` has hardcoded trusted builders; getting SecureBuild added is a long-term effort |
| Predicate version | v1.0 | v0.2 backward compat | v1.0 is the current spec; cosign supports both |
| resolvedDependencies | Initially empty | Full APK dependency list | Parsing Syft SBOMs for resolved deps adds complexity; can iterate later |
| Per-arch attestation | Index digest only | Per-architecture provenance | Consistent with existing SBOM attestation approach; can add later |
| Key-based path | No provenance | Provenance for local builds | Local builder lacks the metadata and identity model for meaningful provenance |
| Verification gap | Accept 2 modes (original vs. rebuilt) | Seamless single-tool verification | Fundamental: SLSA L3 and CVE rebuilds are different builders; no way around this |
| Verification script ownership | SecureBuild provides and maintains | Upstream scripts handle both | SecureBuild changes the identity model; it should own the verification story |

---

## Alternative Solutions Considered

### 1. Fork/patch slsa-verifier to add SecureBuild as a trusted builder
**Rejected.** slsa-verifier's trusted builder list is a security-critical component maintained by the SLSA framework. Customers use the upstream binary, so a fork wouldn't help. We could submit a PR to add SecureBuild, but this requires meeting SLSA L3 build platform requirements and going through the framework's review process. This is a long-term goal, not a short-term solution.

### 2. Use SLSA v0.2 predicate format
**Rejected.** v0.2 is being superseded by v1.0. Starting with v1.0 avoids a migration later. cosign's `--type slsaprovenance` flag handles both versions.

### 3. Re-attach the original upstream provenance to the rebuilt image
**Rejected.** The original provenance is bound to the original digest. Re-attaching it to a different digest would be cryptographically invalid and semantically incorrect (the provenance describes a different build).

### 4. Generate a Verification Summary Attestation (VSA) instead of provenance
**Considered for future.** A VSA attests that an artifact was verified against a policy. This could complement provenance (e.g., "SecureBuild verified this image against CVE policy X and rebuilt it"). However, VSA is a different concept and does not replace provenance. We may add VSA later.

### 5. Add a new dedicated attestation function instead of parameterizing the existing one
**Rejected.** The keyless attestation flow (OIDC -> Fulcio -> PAE signing -> DSSE -> Rekor -> OCI storage) is identical regardless of predicate type. Parameterizing `predicateType` keeps the code DRY and reduces the surface area for bugs.

---

## Research

### Prior Art in Codebase
- `pkg/cosign/cosign-api.go` -- `InTotoStatement`, `buildCustomSubjectStatement`, `CosignAttestWithCustomSubject`
- `pkg/cosign/keyless.go` -- `CosignAttestKeylessWithCustomSubject`, full Fulcio+Rekor keyless flow
- `pkg/oci/artifact.go` -- OCI artifact storage, referrers API serving
- `pkg/listener/update-build-image-status.go:611-661` -- attestation invocation in build pipeline

### External References
- [SLSA v1.0 Provenance spec](https://slsa.dev/spec/v1.0/provenance)
- [SLSA v1.0 Levels](https://slsa.dev/spec/v1.0/levels)
- [in-toto Statement spec v1.0](https://github.com/in-toto/attestation/tree/main/spec/v1)
- [cosign verify-attestation](https://docs.sigstore.dev/cosign/verifying/attestation/)
- [slsa-verifier trusted builders](https://github.com/slsa-framework/slsa-verifier/blob/main/verifiers/internal/gha/builder.go)
- [replicated-sdk SLSA verification docs](https://docs.replicated.com/vendor/replicated-sdk-slsa-validating)
- [DSSE envelope spec](https://github.com/secure-systems-lab/dsse/blob/master/envelope.md)

### Dependencies Already Available
- `github.com/in-toto/in-toto-golang v0.10.0` (indirect, in go.mod) -- provides official SLSA v1.0 provenance types (`slsa_provenance/v1.ProvenancePredicate`, etc.) and `PredicateSLSAProvenance` constant
- `github.com/in-toto/attestation v1.2.0` (indirect, in go.mod)
- `github.com/sigstore/cosign/v2 v2.6.2`
- `github.com/sigstore/fulcio v1.8.5`
- `github.com/sigstore/rekor v1.5.1`

No new dependencies required. The SLSA predicate uses the official `in-toto-golang` types.

---

## Impact on Upstream Verification Scripts

### replicated-sdk `verify-image.sh`

The existing script (`certs/verify-image.sh`) will fail on all three steps for SecureBuild-rebuilt images. There are two paths forward:

**Option 1: Replicated updates their script to handle both modes**

Replicated modifies `verify-image.sh` to detect whether the image was rebuilt by SecureBuild and branch accordingly. This requires coordination with the Replicated team and depends on them adopting SecureBuild's signing identity.

**Option 2: SecureBuild provides a replacement/companion script**

SecureBuild publishes `verify-securebuild-image.sh` that customers use specifically for SecureBuild-rebuilt images. The customer's CI/CD decides which script to run based on whether they're pulling from the upstream registry or SecureBuild's proxy.

**Recommendation**: Option 2 in the short term (SecureBuild owns it), with a path toward Option 1 as a long-term collaboration with upstream projects. The verification script should be published alongside SecureBuild's documentation and discoverable from the web UI.

### What Customers Need to Know

Documentation should clearly explain:

1. **Why verification changes** — SecureBuild rebuilds the image with patched dependencies, producing a new digest signed with SecureBuild's identity
2. **What's verified** — Same three things (provenance, signature, SBOM), different trust anchor (SecureBuild's Fulcio identity instead of upstream's cosign keys)
3. **How to verify** — Provide the exact commands with SecureBuild's signing identity pre-filled
4. **The security trade-off** — Customers gain CVE remediation but lose `slsa-verifier` compatibility; `cosign verify-attestation` provides equivalent cryptographic guarantees with a different trust model

---

## Checkpoints (PR Plan)

### PR 1: Parameterize predicateType and add SLSA predicate builder ✅ IMPLEMENTED

**Scope:**
- Parameterize `buildCustomSubjectStatement` to accept `predicateType`
- Parameterize `CosignAttestKeylessWithCustomSubject` to accept `predicateType`
- Update `CosignAttestWithCustomSubject` (key-based) to pass SPDX predicateType
- Update existing callers and tests
- Add `pkg/cosign/slsa.go` with `BuildSLSAProvenancePredicate` using official `in-toto/in-toto-golang` SLSA v1.0 types
- Add `pkg/cosign/slsa_test.go`

This PR is safe to merge independently -- it changes no runtime behavior (existing callers pass the same SPDX predicate type they were hardcoded to before).

### PR 2: Wire SLSA provenance into build pipeline

**Scope:**
- Thread `buildID` and `imageBuild` through to `processImageTag`
- Add SLSA provenance attestation call after SBOM attestation
- Add integration test: build produces provenance, `cosign verify-attestation --type slsaprovenance` succeeds

This PR activates provenance generation. Once merged, all new builds produce SLSA provenance.

### PR 3: SecureBuild verification script and documentation

**Scope:**
- Add `verify-securebuild-image.sh` script (covers all 3 verification steps)
- Publish SecureBuild's signing identity (GCP service account email)
- Add verification documentation (why, what, how)
- Optionally: Add verification commands to the web UI image detail page

This PR makes the verification story customer-facing.
