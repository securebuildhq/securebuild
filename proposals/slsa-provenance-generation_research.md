# Research: SLSA Provenance Generation for SecureBuild Image Rebuilds

## 1. Existing Attestation Infrastructure

### In-Toto Statement Construction
- **Location**: `pkg/cosign/cosign-api.go:37-87`
- `InTotoStatement` struct with `_type`, `predicateType`, `subject`, `predicate` fields
- `buildCustomSubjectStatement()` constructs statements with custom subject (OCI proxy registry path)
- **Hardcoded**: `PredicateType` is always `"https://spdx.dev/Document"` (SPDX SBOM)
- Statement type is `"https://in-toto.io/Statement/v0.1"`

### Keyless Attestation Path (VM builds)
- **Location**: `pkg/cosign/keyless.go:348-565`
- `CosignAttestKeylessWithCustomSubject()` is the main attestation function
- Accepts any predicate file path, but always uses SPDX predicateType from `buildCustomSubjectStatement()`
- Flow: Load predicate -> Build in-toto statement -> Get OIDC token -> Ephemeral ECDSA key -> Fulcio cert -> PAE signing -> DSSE envelope -> Rekor upload -> Store in DB
- Uses Fulcio (`fulcio.sigstore.dev`) for short-lived certificates
- Uses Rekor (`rekor.sigstore.dev`) for transparency log
- DSSE envelope uploaded to Rekor as dsse_v001 entry type

### Key-Based Attestation Path (local builds)
- **Location**: `pkg/cosign/cosign-api.go:89-202`
- `CosignAttestWithCustomSubject()` uses a private key instead of keyless flow
- Same `buildCustomSubjectStatement()` helper
- No Fulcio/Rekor integration

### OCI Artifact Storage
- **Location**: `pkg/oci/artifact.go`
- `StoreArtifactBlob()` stores DSSE envelopes in `oci_artifact_blob` table (jsonb + bytea)
- `StoreFullArtifactManifest()` stores OCI artifact manifests in `oci_artifact_manifest` table
- `NewOCIArtifactManifest()` constructs OCI artifact manifests with subject, layers, annotations
- Proxy serves attestations via OCI referrers API using the `oci_artifact_manifest.subject_digest` index

### Duplicate InTotoStatement
- `pkg/cosign/cosign-api.go:42-47` defines the primary `InTotoStatement`
- `pkg/oci/artifact.go:321-338` defines a local `InTotoStatement` in `PatchDSSESubject()` (used only for patching, different shape)

## 2. Build Pipeline and Attestation Code Path

### Build Status Lifecycle
- `pkg/listener/update-build-image-status.go` manages build status transitions
- Status flow: `pending -> queued -> building -> testing -> publishing -> success/failed/timed_out`
- On success: `checkAndHandleBuildCompletion()` -> `processImageBuildResults()` -> `processImageTag()`

### Attestation Invocation (`processImageTag`, lines 611-661)
```
processImageTag():
  1. Resolve digest for pushed image tag
  2. Create catalog image entry
  3. Write scan results to database
  4. Build OIDC provider (GCP)
  5. CosignSignKeylessWithCustomSubject() -- keyless signature
  6. CosignAttestKeylessWithCustomSubject() -- SBOM attestation (index SBOM)
```

### Available Build Metadata at Attestation Time
- `imageBuild.ID` -- build identifier
- `imageBuild.BuilderID` -- VM builder ID
- `imageBuild.BuildStartedAt` / `BuildFinishedAt` -- timestamps
- `apkoVersion.APKOYAML` -- APKO config content
- `actualTags` -- resolved image tags
- `digest` -- image digest from registry resolution
- `ociPrefix` -- OCI image prefix (proxy host)
- `img.Name` -- image name
- `apko.ID`, `apko.Tags` -- APKO configuration
- `tmpDir` contents -- SBOMs (Syft), scan results (Grype)
- **NOT directly available**: source repo URL, VCS commit SHA, tool versions (apko version, syft version)

## 3. Sigstore Dependency Versions (go.mod)

- `github.com/sigstore/cosign/v2 v2.6.2`
- `github.com/sigstore/fulcio v1.8.5`
- `github.com/sigstore/rekor v1.5.1`
- `github.com/sigstore/sigstore v1.10.4`
- `github.com/in-toto/attestation v1.2.0` (indirect)
- `github.com/in-toto/in-toto-golang v0.10.0` (indirect)

The `in-toto/attestation` library is already a transitive dependency but not used directly. It contains protobuf definitions for various predicate types (VSA, test_result, release) but does NOT include SLSA provenance predicate types -- those are defined in the `slsa-framework/slsa` repo.

## 4. Database Schema

### oci_artifact_manifest (`db/schema/tables/oci-artifact-manifest.yaml`)
- Primary key: `id` (text, manifest digest)
- `image_catalog_id` (text, FK to image_catalog)
- `subject_digest` (text, digest of referenced image)
- `media_type` (text)
- `artifact_type` (text, e.g., `application/vnd.in-toto+json`)
- `manifest_size` (bigint)
- `annotations` (jsonb)
- `attest_id` (text, nullable, unique)
- Indexes on `subject_digest`, `image_catalog_id`, `attest_id`

### oci_artifact_blob (`db/schema/tables/oci-artifact-blob.yaml`)
- Primary key: `digest`
- `media_type` (text)
- `content` (jsonb)
- `raw_content` (bytea)

**No schema changes needed** -- the existing tables can store any OCI artifact manifest and blob, including SLSA provenance attestations. The `artifact_type` column already differentiates between signatures, SBOM attestations, and (future) provenance attestations.

## 5. Feature Flag Infrastructure

- **Location**: `pkg/team/team.go`, `pkg/team/types/types.go`
- Team-level feature flags stored as `pq.StringArray` in team table
- `HasFeatureFlag(ctx, teamID, flag)` checks if a team has a specific flag
- Feature flags are team-scoped, not global -- this is relevant for rollout strategy
- However, SLSA provenance generation is a build-time operation, not a team-facing feature -- a global feature flag or config param is more appropriate

## 6. OIDC Identity

- **GCP Service Account**: `param.GetParam(ctx).OIDCGCPAttestorAccount`
- Used for workload identity to obtain OIDC tokens for keyless signing
- The signing identity (email/sub claim from the OIDC token) becomes the trust anchor for verification
- This is the identity embedded in Fulcio certificates

## 7. slsa-verifier Compatibility Analysis

### How slsa-verifier works
- slsa-verifier (github.com/slsa-framework/slsa-verifier) has a **hardcoded list of trusted builders**
- Currently trusted builders: `slsa-framework/slsa-github-generator`, `google/ko`, specific GCB builders
- Verification flow: check builder ID against trusted list -> verify Sigstore certificate -> verify Rekor entry -> verify provenance content
- **SecureBuild will NOT be on this trusted list**

### replicated-sdk verification flow (from docs.replicated.com)
- Stage 1: `slsa-verifier verify-image` with `--source-uri` and `--source-tag`
- Stage 2: `cosign verify-attestation` with env-specific public key for SBOM
- Stage 3: `cosign download attestation` for SBOM content

### Implication for SecureBuild
- SecureBuild provenance cannot be verified with `slsa-verifier verify-image`
- Verification must use `cosign verify-attestation` with:
  - `--certificate-identity` (Fulcio signing identity)
  - `--certificate-oidc-issuer` (Google OIDC issuer)
  - `--type slsaprovenance` or `--type slsaprovenance02`
- This is a fundamentally different verification path that requires customer-facing documentation

## 8. SLSA Provenance Predicate Specification

### SLSA v1.0 Provenance (recommended)
- PredicateType: `https://slsa.dev/provenance/v1`
- Key fields: `buildDefinition` (buildType, externalParameters, internalParameters, resolvedDependencies) and `runDetails` (builder, metadata, byproducts)
- `buildType` is a URI that defines the meaning of externalParameters
- `builder.id` is a URI identifying the build platform

### SLSA v0.2 Provenance (legacy)
- PredicateType: `https://slsa.dev/provenance/v0.2`
- Key fields: `builder`, `buildType`, `invocation`, `buildConfig`, `metadata`, `materials`
- Still widely supported but being superseded by v1.0

### Recommendation: Use SLSA v1.0
- More structured, clearer separation of concerns
- Forward-compatible with SLSA specification evolution
- cosign verify-attestation supports `--type slsaprovenance` which handles both versions

## 9. Testing Patterns

- Tests use function variable injection for mocking (see `keyless_test.go`)
- Package-level `var` for external dependencies: `storeArtifactBlob`, `getArtifactBlobByDigest`, `newOCIArtifactManifest`, `storeFullArtifactManifest`, `newFulcioClient`, `getRekorClient`, `tlogUpload`, `tlogUploadDSSE`
- Tests save/restore originals with `defer`
- Stub OIDC provider, Fulcio client, Rekor client
- Both offline (stubbed) and live modes supported via `KEYLESS_LIVE_SIGNING` env var
