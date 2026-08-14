package listener

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/static"
	v1types "github.com/google/go-containerregistry/pkg/v1/types"
	cosignpkg "github.com/securebuildhq/securebuild/pkg/cosign"
	"github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/oci"
	"github.com/securebuildhq/securebuild/pkg/param"
	sigcosign "github.com/sigstore/cosign/v2/pkg/cosign"
	cosignremote "github.com/sigstore/cosign/v2/pkg/oci/remote"
	"go.uber.org/zap"
)

type externalRegistryPushResult struct {
	RegistryID  string `json:"registry_id"`
	RegistryURL string `json:"registry_url"`
	Tag         string `json:"tag"`
	Success     bool   `json:"success"`
	Error       string `json:"error,omitempty"`
}

type rawManifest struct {
	content   []byte
	mediaType v1types.MediaType
}

func (m rawManifest) RawManifest() ([]byte, error)          { return m.content, nil }
func (m rawManifest) MediaType() (v1types.MediaType, error) { return m.mediaType, nil }

func readExternalRegistryPushResults(path string) ([]externalRegistryPushResult, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var results []externalRegistryPushResult
	if err := json.Unmarshal(data, &results); err != nil {
		return nil, fmt.Errorf("failed to parse external registry push results: %w", err)
	}
	return results, nil
}

func externalRepository(rawURL string) (name.Repository, error) {
	rawURL = strings.TrimPrefix(strings.TrimPrefix(rawURL, "https://"), "http://")
	return name.NewRepository(strings.TrimSuffix(rawURL, "/"))
}

func publishExternalArtifacts(ctx context.Context, imageCatalogID, subjectDigest string, externalRegistry types.ImageExternalRegistry) error {
	repo, err := externalRepository(externalRegistry.RegistryURL)
	if err != nil {
		return fmt.Errorf("invalid external registry repository: %w", err)
	}
	auth := authn.FromConfig(authn.AuthConfig{Username: externalRegistry.Username, Password: externalRegistry.Password})
	remoteOptions := []remote.Option{remote.WithAuth(auth), remote.WithContext(ctx)}

	artifactManifests, err := oci.GetArtifactManifestsBySubjectDigest(ctx, subjectDigest)
	if err != nil {
		return fmt.Errorf("failed to list signed artifacts: %w", err)
	}

	var signatureManifest []byte
	var attestationLayers []oci.Descriptor
	var referrerManifests [][]byte
	// Signed payloads retain the canonical SecureBuild repository name when copied externally.
	// Cosign binds verification to the immutable digest, which is identical in every registry.
	// Reusing these artifacts avoids signing separately for each configured destination.
	// The external repository only provides another location from which to discover them.
	for _, stored := range artifactManifests {
		if stored.ImageCatalogID != imageCatalogID {
			continue
		}
		manifestBytes, _, err := oci.GetArtifactBlobByDigest(ctx, stored.ID)
		if err != nil {
			return fmt.Errorf("failed to load artifact manifest %s: %w", stored.ID, err)
		}
		var manifest oci.OCIImageManifest
		if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
			return fmt.Errorf("failed to parse artifact manifest %s: %w", stored.ID, err)
		}
		if err := uploadArtifactBlobs(ctx, repo, manifest, remoteOptions); err != nil {
			return err
		}
		referrerManifests = append(referrerManifests, manifestBytes)
		switch stored.ArtifactType {
		case "application/vnd.dev.cosign.simplesigning.v1+json":
			if signatureManifest == nil && isKeylessArtifact(manifest) {
				signatureManifest = manifestBytes
			}
		case "application/vnd.in-toto+json":
			attestationLayers = append(attestationLayers, manifest.Layers...)
		}
	}

	if signatureManifest == nil {
		return fmt.Errorf("keyless signature artifact not found for %s", subjectDigest)
	}
	if len(attestationLayers) < 2 {
		return fmt.Errorf("required SPDX and SLSA attestations not found for %s", subjectDigest)
	}

	legacyBase := "sha256-" + strings.TrimPrefix(subjectDigest, "sha256:")
	if err := putRawManifest(repo.Tag(legacyBase+".sig"), signatureManifest, remoteOptions); err != nil {
		return fmt.Errorf("failed to publish legacy signature: %w", err)
	}
	combinedAttestation, err := oci.NewOCIImageManifest(nil, "application/vnd.in-toto+json", uniqueLayers(attestationLayers), nil)
	if err != nil {
		return fmt.Errorf("failed to build combined attestation manifest: %w", err)
	}
	if err := putRawManifest(repo.Tag(legacyBase+".att"), combinedAttestation, remoteOptions); err != nil {
		return fmt.Errorf("failed to publish legacy attestations: %w", err)
	}

	// Publish the individual subject-bearing manifests by digest as OCI referrers.
	for _, manifestBytes := range referrerManifests {
		hash, _, err := v1.SHA256(strings.NewReader(string(manifestBytes)))
		if err != nil {
			return fmt.Errorf("failed to digest artifact manifest: %w", err)
		}
		if err := putRawManifest(repo.Digest(hash.String()), manifestBytes, remoteOptions); err != nil {
			// Legacy Cosign tags are the compatibility baseline. Registries that
			// do not accept subject-bearing manifests by digest can still verify
			// the artifacts through .sig and .att.
			logger.Warn("external registry does not accept OCI referrer manifest",
				zap.String("registryID", externalRegistry.ID),
				zap.String("artifactDigest", hash.String()),
				zap.Error(err))
		}
	}

	digestRef := repo.Name() + "@" + subjectDigest
	if err := verifyExternalArtifacts(ctx, digestRef, externalRegistry); err != nil {
		return err
	}
	return nil
}

func uploadArtifactBlobs(ctx context.Context, repo name.Repository, manifest oci.OCIImageManifest, options []remote.Option) error {
	if err := remote.WriteLayer(repo, static.NewLayer(oci.EmptyConfigBytes, v1types.MediaType(oci.EmptyConfigMediaType)), options...); err != nil {
		return fmt.Errorf("failed to publish artifact config: %w", err)
	}
	for _, desc := range manifest.Layers {
		blob, mediaType, err := oci.GetArtifactBlobByDigest(ctx, desc.Digest)
		if err != nil {
			return fmt.Errorf("failed to load artifact blob %s: %w", desc.Digest, err)
		}
		if err := remote.WriteLayer(repo, static.NewLayer(blob, v1types.MediaType(mediaType)), options...); err != nil {
			return fmt.Errorf("failed to publish artifact blob %s: %w", desc.Digest, err)
		}
	}
	return nil
}

func putRawManifest(ref name.Reference, content []byte, options []remote.Option) error {
	return remote.Put(ref, rawManifest{content: content, mediaType: v1types.OCIManifestSchema1}, options...)
}

func isKeylessArtifact(manifest oci.OCIImageManifest) bool {
	if manifest.Annotations["dev.cosignproject.cosign/keyless"] == "true" {
		return true
	}
	return len(manifest.Layers) > 0 && manifest.Layers[0].Annotations["dev.cosignproject.cosign/keyless"] == "true"
}

func uniqueLayers(layers []oci.Descriptor) []oci.Descriptor {
	seen := map[string]bool{}
	result := make([]oci.Descriptor, 0, len(layers))
	for _, layer := range layers {
		predicateType := layer.Annotations["dev.cosignproject.cosign/predicateType"]
		key := predicateType + "\x00" + layer.Digest
		if !seen[key] {
			seen[key] = true
			result = append(result, layer)
		}
	}
	return result
}

func verifyExternalArtifacts(ctx context.Context, digestRef string, externalRegistry types.ImageExternalRegistry) error {
	return verifyExternalReference(ctx, digestRef, externalRegistry)
}

var verifyExternalReference = verifyExternalReferenceWithCosign

func verifyExternalReferenceWithCosign(ctx context.Context, digestRef string, externalRegistry types.ImageExternalRegistry) error {
	identity := param.GetParam(ctx).OIDCGCPAttestorAccount
	ref, err := name.ParseReference(digestRef)
	if err != nil {
		return fmt.Errorf("failed to parse external digest reference: %w", err)
	}
	trustedMaterial, err := sigcosign.TrustedRoot()
	if err != nil {
		return fmt.Errorf("failed to load Sigstore trusted root: %w", err)
	}
	registryOptions := []remote.Option{
		remote.WithAuth(authn.FromConfig(authn.AuthConfig{Username: externalRegistry.Username, Password: externalRegistry.Password})),
		remote.WithContext(ctx),
	}
	checkOpts := &sigcosign.CheckOpts{
		RegistryClientOpts: []cosignremote.Option{cosignremote.WithRemoteOptions(registryOptions...)},
		TrustedMaterial:    trustedMaterial,
		Identities: []sigcosign.Identity{{
			Subject: identity,
			Issuer:  "https://accounts.google.com",
		}},
		ClaimVerifier: sigcosign.SimpleClaimVerifier,
	}
	if _, _, err := sigcosign.VerifyImageSignatures(ctx, ref, checkOpts); err != nil {
		return fmt.Errorf("failed to verify external signature for %s: %w", digestRef, err)
	}

	checkOpts.ClaimVerifier = sigcosign.IntotoSubjectClaimVerifier
	attestations, _, err := sigcosign.VerifyImageAttestations(ctx, ref, checkOpts)
	if err != nil {
		return fmt.Errorf("failed to verify external attestations for %s: %w", digestRef, err)
	}
	found := map[string]bool{}
	for _, attestation := range attestations {
		payload, err := attestation.Payload()
		if err != nil {
			continue
		}
		var envelope struct {
			Payload string `json:"payload"`
		}
		if json.Unmarshal(payload, &envelope) != nil {
			continue
		}
		statementBytes, err := base64.StdEncoding.DecodeString(envelope.Payload)
		if err != nil {
			continue
		}
		var statement struct {
			PredicateType string `json:"predicateType"`
		}
		if json.Unmarshal(statementBytes, &statement) == nil {
			found[statement.PredicateType] = true
		}
	}
	for _, predicateType := range []string{cosignpkg.PredicateSPDX, cosignpkg.PredicateSLSAProvenance} {
		if !found[predicateType] {
			return fmt.Errorf("verified external attestation %s not found for %s", predicateType, digestRef)
		}
	}
	return nil
}
