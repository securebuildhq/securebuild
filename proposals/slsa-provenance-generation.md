# Proposal: SLSA Provenance Generation for SecureBuild Image Rebuilds

**Research document**: [slsa-provenance-generation_research.md](./slsa-provenance-generation_research.md)

---

## TL;DR

When SecureBuild rebuilds an image to patch CVEs, the resulting image has a different digest and lacks SLSA provenance, causing verification failures for customers running `slsa-verifier`. This proposal adds SLSA v1.0 provenance predicate construction and a second keyless attestation call to the existing build pipeline. Because `slsa-verifier` has a hardcoded trusted builder list that will never include SecureBuild, we define a `cosign verify-attestation`-based verification path using the Fulcio signing identity as the trust anchor. No database changes are required.

---

## The Problem

When an upstream project (e.g., replicated-sdk) builds an image via GitHub Actions, `slsa-framework/slsa-github-generator` attaches SLSA L3 provenance to the original digest. SecureBuild rebuilds the image with patched dependencies, producing a new digest. This rebuilt image has cosign signatures and SBOM attestations but **no SLSA provenance**. Customers following the verification guide at `docs.replicated.com/vendor/replicated-sdk-slsa-validating` get:

```
slsa-verifier verify-image: FAILED: no matching provenance found
```

This breaks the supply chain verification workflow for security-conscious customers and undermines confidence in SecureBuild's rebuilt images.

**Who is affected**: Any customer verifying SLSA provenance on images that SecureBuild has rebuilt. The replicated-sdk is the immediate case (per its verify-image.sh script), but this applies to any image with an upstream SLSA attestation.

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

Since `slsa-verifier` only trusts hardcoded builders (GitHub Actions SLSA generators), SecureBuild provenance requires a different verification command:

```bash
# Instead of: slsa-verifier verify-image ...
# Use:
cosign verify-attestation \
  --type slsaprovenance \
  --certificate-identity "<GCP attestor service account email>" \
  --certificate-oidc-issuer "https://accounts.google.com" \
  "${IMAGE_WITH_DIGEST}"
```

This uses the Fulcio signing identity (the GCP service account email in the OIDC token) as the trust anchor. The certificate chain is Fulcio -> ephemeral cert -> Rekor tlog entry, same as the existing SBOM attestation verification.

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

---

## New Subagents / Commands

No new subagents or commands. This feature is entirely within the existing build worker and attestation pipeline.

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

| File | Change |
|------|--------|
| `pkg/cosign/cosign-api.go` | Parameterize `buildCustomSubjectStatement` to accept `predicateType` |
| `pkg/cosign/keyless.go` | Update `CosignAttestKeylessWithCustomSubject` to accept `predicateType` parameter |
| `pkg/cosign/slsa.go` | **New file**: SLSA v1.0 predicate builder |
| `pkg/cosign/slsa_test.go` | **New file**: Unit tests for predicate builder |
| `pkg/cosign/keyless_test.go` | Update tests for new `predicateType` parameter |
| `pkg/listener/update-build-image-status.go` | Add SLSA provenance attestation call after SBOM attestation |

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

```go
package cosign

// SLSAProvenancePredicateType is the predicateType URI for SLSA v1.0 provenance.
const SLSAProvenancePredicateType = "https://slsa.dev/provenance/v1"

// SecureBuildBuildType is the buildType URI for SecureBuild image rebuilds.
const SecureBuildBuildType = "https://securebuild.com/provenance/image-rebuild/v1"

// SecureBuildBuilderID is the builder.id for SecureBuild GCP VM builds.
const SecureBuildBuilderID = "https://securebuild.com/builder/gcp-vm/v1"

// SLSABuildDefinition represents the buildDefinition in SLSA v1.0.
type SLSABuildDefinition struct {
    BuildType            string                  `json:"buildType"`
    ExternalParameters   SLSAExternalParameters  `json:"externalParameters"`
    InternalParameters   SLSAInternalParameters  `json:"internalParameters"`
    ResolvedDependencies []SLSAResourceDescriptor `json:"resolvedDependencies"`
}

type SLSAExternalParameters struct {
    Source SLSASourceParameters `json:"source"`
}

type SLSASourceParameters struct {
    ApkoConfigDigest string   `json:"apkoConfigDigest"`
    Tags             []string `json:"tags"`
}

type SLSAInternalParameters struct {
    BuilderVersion string `json:"builderVersion,omitempty"`
}

type SLSAResourceDescriptor struct {
    URI    string            `json:"uri"`
    Digest map[string]string `json:"digest,omitempty"`
}

// SLSARunDetails represents the runDetails in SLSA v1.0.
type SLSARunDetails struct {
    Builder  SLSABuilder   `json:"builder"`
    Metadata SLSAMetadata  `json:"metadata"`
}

type SLSABuilder struct {
    ID string `json:"id"`
}

type SLSAMetadata struct {
    InvocationID string  `json:"invocationId"`
    StartedOn    *string `json:"startedOn,omitempty"`
    FinishedOn   *string `json:"finishedOn,omitempty"`
}

// SLSAProvenancePredicate is the top-level SLSA v1.0 provenance predicate.
type SLSAProvenancePredicate struct {
    BuildDefinition SLSABuildDefinition `json:"buildDefinition"`
    RunDetails      SLSARunDetails      `json:"runDetails"`
}

// SLSAProvenanceInput holds the metadata needed to build a SLSA provenance predicate.
type SLSAProvenanceInput struct {
    BuildID        string
    BuilderID      string     // VM builder ID
    StartedOn      *time.Time
    FinishedOn     *time.Time
    ApkoYAML       string     // raw APKO config content
    Tags           []string   // resolved image tags
    // Future: source repo, commit, tool versions
}

// BuildSLSAProvenancePredicate constructs a SLSA v1.0 provenance predicate
// from the available build metadata.
func BuildSLSAProvenancePredicate(input SLSAProvenanceInput) SLSAProvenancePredicate {
    // Hash the APKO config for the externalParameters
    apkoDigest := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(input.ApkoYAML)))

    predicate := SLSAProvenancePredicate{
        BuildDefinition: SLSABuildDefinition{
            BuildType: SecureBuildBuildType,
            ExternalParameters: SLSAExternalParameters{
                Source: SLSASourceParameters{
                    ApkoConfigDigest: apkoDigest,
                    Tags:             input.Tags,
                },
            },
            // resolvedDependencies left empty for now;
            // future: parse Syft SBOM for APK package URIs
        },
        RunDetails: SLSARunDetails{
            Builder: SLSABuilder{
                ID: SecureBuildBuilderID,
            },
            Metadata: SLSAMetadata{
                InvocationID: input.BuildID,
                StartedOn:    formatTimePtr(input.StartedOn),
                FinishedOn:   formatTimePtr(input.FinishedOn),
            },
        },
    }
    return predicate
}

func formatTimePtr(t *time.Time) *string {
    if t == nil { return nil }
    s := t.Format(time.RFC3339)
    return &s
}
```

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
        ctx, slsaPath, cosign.SLSAProvenancePredicateType,
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
- `github.com/in-toto/attestation v1.2.0` (indirect, in go.mod)
- `github.com/sigstore/cosign/v2 v2.6.2`
- `github.com/sigstore/fulcio v1.8.5`
- `github.com/sigstore/rekor v1.5.1`

No new dependencies required. The SLSA predicate is constructed as plain Go structs and serialized to JSON.

---

## Checkpoints (PR Plan)

### PR 1: Parameterize predicateType and add SLSA predicate builder

**Scope:**
- Parameterize `buildCustomSubjectStatement` to accept `predicateType`
- Parameterize `CosignAttestKeylessWithCustomSubject` to accept `predicateType`
- Update `CosignAttestWithCustomSubject` (key-based) to pass SPDX predicateType
- Update existing callers and tests
- Add `pkg/cosign/slsa.go` with SLSA v1.0 predicate types and `BuildSLSAProvenancePredicate`
- Add `pkg/cosign/slsa_test.go`

This PR is safe to merge independently -- it changes no runtime behavior (existing callers pass the same SPDX predicate type they were hardcoded to before).

### PR 2: Wire SLSA provenance into build pipeline + verification docs

**Scope:**
- Thread `buildID` and `imageBuild` through to `processImageTag`
- Add SLSA provenance attestation call after SBOM attestation
- Add integration test: build produces provenance, `cosign verify-attestation --type slsaprovenance` succeeds
- Update/create customer-facing verification documentation

This PR activates the feature. Once merged, all new builds produce SLSA provenance.
