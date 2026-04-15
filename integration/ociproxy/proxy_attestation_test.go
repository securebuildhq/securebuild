package ociproxy_test

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/remote/transport"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/oci"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

func computeDigest(data []byte) string {
	h := sha256.Sum256(data)
	return fmt.Sprintf("sha256:%x", h)
}

// TestOCIProxyAttestationManifests tests the OCI proxy's attestation manifest handling:
// referrers API, manifest fetch with conversion, legacy .att endpoint, and empty config blob.
func TestOCIProxyAttestationManifests(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()

	// Setup test database
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	// Apply seed data
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	seedDataDir := filepath.Join(projectRoot, "integration", "ociproxy", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Setup test registry
	registry := testutil.SetupTestRegistry(ctx, t)
	defer testutil.TeardownTestRegistry(ctx, t, registry)

	// Create and push a minimal test image
	img, err := createTestImage()
	require.NoError(t, err)

	testImageRef := fmt.Sprintf("%s/securebuild/test-image:latest", registry.Address)
	testRef, err := name.ParseReference(testImageRef)
	require.NoError(t, err)

	auth := &authn.Basic{
		Username: registry.StaticUsername,
		Password: registry.StaticPassword,
	}

	baseTransport := http.DefaultTransport.(*http.Transport).Clone()
	baseTransport.TLSClientConfig = registry.TLSConfig

	challenge, err := transport.Ping(ctx, testRef.Context().Registry, baseTransport)
	require.NoError(t, err)

	scopes := []string{testRef.Context().Scope(transport.PushScope)}
	token, err := transport.Exchange(ctx, testRef.Context().Registry, auth, baseTransport, scopes, challenge)
	require.NoError(t, err)

	bearerAuth := &authn.Bearer{Token: token.Token}
	err = remote.Write(testRef, img, remote.WithAuth(bearerAuth), remote.WithTransport(baseTransport))
	require.NoError(t, err)

	imgDigest, err := img.Digest()
	require.NoError(t, err)
	imageDigestStr := imgDigest.String()

	// Start OCI Proxy server (this calls param.Init and persistence.InitPostgres internally)
	proxy := setupTestProxy(ctx, t, testDB, registry)
	defer teardownTestProxy(t, proxy)

	// Get an enriched context with DB_URI for direct persistence calls.
	// setupTestProxy already initialized the pool, we just need the context with DB_URI.
	enrichedCtx, err := param.Init(param.InitSourceEnvironment, map[string]string{
		"DB_URI": testDB.ConnStr,
	})
	require.NoError(t, err)

	// Update the image_catalog index_digest to match the pushed image's digest.
	conn := persistence.MustGetPooledPostgresSession(enrichedCtx)
	_, err = conn.Exec(enrichedCtx,
		`UPDATE image_catalog SET index_digest = $1 WHERE id = 'test-image-catalog-latest'`,
		imageDigestStr)
	conn.Release()
	require.NoError(t, err)

	// --- Create test attestation data ---

	imageCatalogID := "test-image-catalog-latest"
	inTotoArtifactType := "application/vnd.in-toto+json"
	dsseMediaType := "application/vnd.dsse.envelope.v1+json"
	now := time.Now()

	subjectDescriptor := &oci.Descriptor{
		MediaType: "application/vnd.oci.image.index.v1+json",
		Digest:    imageDigestStr,
		Size:      1234,
	}

	// -- SLSA DSSE envelope layer blob --
	slsaDSSEPayload := map[string]interface{}{
		"payloadType": "application/vnd.in-toto+json",
		"payload":     "eyJ0eXBlIjoiaHR0cHM6Ly9pbi10b3RvLmlvL1N0YXRlbWVudC92MSJ9",
		"signatures":  []map[string]string{{"keyid": "", "sig": "dGVzdHNpZw=="}},
	}
	slsaDSSEBytes, err := json.Marshal(slsaDSSEPayload)
	require.NoError(t, err)
	slsaDSSEDigest := computeDigest(slsaDSSEBytes)

	err = oci.StoreArtifactBlob(enrichedCtx, slsaDSSEDigest, dsseMediaType, slsaDSSEBytes)
	require.NoError(t, err)

	slsaLayer := oci.Descriptor{
		MediaType: dsseMediaType,
		Digest:    slsaDSSEDigest,
		Size:      int64(len(slsaDSSEBytes)),
		Annotations: map[string]string{
			"dev.cosignproject.cosign/predicateType": "https://slsa.dev/provenance/v1",
		},
	}

	// -- Build old-format artifact manifest (SLSA) --
	oldManifest := oci.OCIArtifactManifest{
		SchemaVersion: 2,
		MediaType:     oci.MediaTypeArtifactManifest,
		ArtifactType:  inTotoArtifactType,
		Layers:        []oci.Descriptor{slsaLayer},
		Subject:       subjectDescriptor,
	}
	oldManifestBytes, err := json.Marshal(oldManifest)
	require.NoError(t, err)
	oldManifestDigest := computeDigest(oldManifestBytes)

	// Store old manifest blob
	err = oci.StoreArtifactBlob(enrichedCtx, oldManifestDigest, oci.MediaTypeArtifactManifest, oldManifestBytes)
	require.NoError(t, err)

	// Store old manifest metadata
	err = oci.StoreArtifactManifest(enrichedCtx, oci.ArtifactManifest{
		ID:             oldManifestDigest,
		ImageCatalogID: imageCatalogID,
		SubjectDigest:  imageDigestStr,
		MediaType:      oci.MediaTypeArtifactManifest,
		ArtifactType:   inTotoArtifactType,
		ManifestSize:   int64(len(oldManifestBytes)),
		Annotations:    map[string]interface{}{},
		CreatedAt:      now,
		UpdatedAt:      now,
	})
	require.NoError(t, err)

	// -- SBOM DSSE envelope layer blob --
	sbomDSSEPayload := map[string]interface{}{
		"payloadType": "application/vnd.in-toto+json",
		"payload":     "eyJ0eXBlIjoiaHR0cHM6Ly9zcGR4LmRldi9Eb2N1bWVudCJ9",
		"signatures":  []map[string]string{{"keyid": "", "sig": "c2JvbXNpZw=="}},
	}
	sbomDSSEBytes, err := json.Marshal(sbomDSSEPayload)
	require.NoError(t, err)
	sbomDSSEDigest := computeDigest(sbomDSSEBytes)

	err = oci.StoreArtifactBlob(enrichedCtx, sbomDSSEDigest, dsseMediaType, sbomDSSEBytes)
	require.NoError(t, err)

	sbomLayer := oci.Descriptor{
		MediaType: dsseMediaType,
		Digest:    sbomDSSEDigest,
		Size:      int64(len(sbomDSSEBytes)),
		Annotations: map[string]string{
			"dev.cosignproject.cosign/predicateType": "https://spdx.dev/Document",
		},
	}

	// -- Build new-format OCI image manifest (SBOM) --
	newManifestBytes, err := oci.NewOCIImageManifest(subjectDescriptor, inTotoArtifactType, []oci.Descriptor{sbomLayer}, nil)
	require.NoError(t, err)
	newManifestDigest := computeDigest(newManifestBytes)

	// Store new manifest blob
	err = oci.StoreArtifactBlob(enrichedCtx, newManifestDigest, oci.MediaTypeOCIManifest, newManifestBytes)
	require.NoError(t, err)

	// Store new manifest metadata
	err = oci.StoreArtifactManifest(enrichedCtx, oci.ArtifactManifest{
		ID:             newManifestDigest,
		ImageCatalogID: imageCatalogID,
		SubjectDigest:  imageDigestStr,
		MediaType:      oci.MediaTypeOCIManifest,
		ArtifactType:   inTotoArtifactType,
		ManifestSize:   int64(len(newManifestBytes)),
		Annotations:    map[string]interface{}{},
		CreatedAt:      now,
		UpdatedAt:      now,
	})
	require.NoError(t, err)

	// --- Get proxy JWT token ---
	proxyToken := getProxyToken(t, proxy.Address)

	// ===== Test (a): Referrers API =====
	t.Run("referrers_api", func(t *testing.T) {
		url := fmt.Sprintf("http://%s/v2/test-image/referrers/%s", proxy.Address, imageDigestStr)
		req, err := http.NewRequest("GET", url, nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+proxyToken)

		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		require.Equal(t, http.StatusOK, resp.StatusCode, "referrers API should return 200")

		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		var index struct {
			SchemaVersion int    `json:"schemaVersion"`
			MediaType     string `json:"mediaType"`
			Manifests     []struct {
				MediaType    string `json:"mediaType"`
				Digest       string `json:"digest"`
				Size         int64  `json:"size"`
				ArtifactType string `json:"artifactType"`
			} `json:"manifests"`
		}
		err = json.Unmarshal(body, &index)
		require.NoError(t, err)

		require.Len(t, index.Manifests, 2, "should have 2 attestation descriptors")

		for _, desc := range index.Manifests {
			require.Equal(t, oci.MediaTypeOCIManifest, desc.MediaType,
				"all descriptors should be advertised as OCI image manifest, even old-format ones")
			require.Equal(t, inTotoArtifactType, desc.ArtifactType,
				"each descriptor should have the correct artifactType")
		}
	})

	// ===== Test (b): Manifest fetch (old format conversion) =====
	t.Run("manifest_fetch_old_format_conversion", func(t *testing.T) {
		url := fmt.Sprintf("http://%s/v2/test-image/manifests/%s", proxy.Address, oldManifestDigest)
		req, err := http.NewRequest("GET", url, nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+proxyToken)

		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		require.Equal(t, http.StatusOK, resp.StatusCode, "manifest fetch should return 200")

		require.Equal(t, oci.MediaTypeOCIManifest, resp.Header.Get("Content-Type"),
			"Content-Type should be OCI image manifest")

		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		// Parse as JSON to verify it has a config field (converted format)
		var manifest map[string]json.RawMessage
		err = json.Unmarshal(body, &manifest)
		require.NoError(t, err)
		require.Contains(t, manifest, "config", "converted manifest must have a config field")

		// Verify Docker-Content-Digest matches actual body digest
		actualDigest := computeDigest(body)
		require.Equal(t, actualDigest, resp.Header.Get("Docker-Content-Digest"),
			"Docker-Content-Digest header must match sha256 of response body")

		// Verify Content-Length matches body size
		require.Equal(t, fmt.Sprintf("%d", len(body)), resp.Header.Get("Content-Length"),
			"Content-Length should match actual body size")
	})

	// ===== Test (c): Manifest fetch (new format passthrough) =====
	t.Run("manifest_fetch_new_format_passthrough", func(t *testing.T) {
		url := fmt.Sprintf("http://%s/v2/test-image/manifests/%s", proxy.Address, newManifestDigest)
		req, err := http.NewRequest("GET", url, nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+proxyToken)

		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		require.Equal(t, http.StatusOK, resp.StatusCode, "manifest fetch should return 200")

		require.Equal(t, oci.MediaTypeOCIManifest, resp.Header.Get("Content-Type"),
			"Content-Type should be OCI image manifest")

		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		actualDigest := computeDigest(body)
		require.Equal(t, actualDigest, resp.Header.Get("Docker-Content-Digest"),
			"Docker-Content-Digest header must match the digest of the response body")
	})

	// ===== Test (d): Legacy .att endpoint =====
	t.Run("legacy_att_endpoint", func(t *testing.T) {
		// The .att endpoint uses sha256-<hex>.att format (no "sha256:" prefix, uses dash)
		digestHex := strings.TrimPrefix(imageDigestStr, "sha256:")
		url := fmt.Sprintf("http://%s/v2/test-image/manifests/sha256-%s.att", proxy.Address, digestHex)
		req, err := http.NewRequest("GET", url, nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+proxyToken)

		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		require.Equal(t, http.StatusOK, resp.StatusCode, "legacy .att endpoint should return 200")

		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		var manifest oci.OCIImageManifest
		err = json.Unmarshal(body, &manifest)
		require.NoError(t, err)

		// Should contain layers from ALL attestation manifests (both SLSA and SBOM)
		require.Len(t, manifest.Layers, 2,
			"combined .att manifest should contain layers from all attestation manifests")

		for _, layer := range manifest.Layers {
			predicateType, ok := layer.Annotations["dev.cosignproject.cosign/predicateType"]
			require.True(t, ok, "each layer must have dev.cosignproject.cosign/predicateType annotation")
			require.True(t,
				predicateType == "https://slsa.dev/provenance/v1" || predicateType == "https://spdx.dev/Document",
				"predicateType should be SLSA provenance or SPDX document, got: %s", predicateType)
		}
	})

	// ===== Test (e): Empty config blob =====
	t.Run("empty_config_blob", func(t *testing.T) {
		url := fmt.Sprintf("http://%s/v2/test-image/blobs/%s", proxy.Address, oci.EmptyConfigDigest)
		req, err := http.NewRequest("GET", url, nil)
		require.NoError(t, err)
		req.Header.Set("Authorization", "Bearer "+proxyToken)

		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()

		require.Equal(t, http.StatusOK, resp.StatusCode, "empty config blob should return 200")

		body, err := io.ReadAll(resp.Body)
		require.NoError(t, err)

		require.Equal(t, "{}", string(body), "empty config blob body should be {}")
		require.Equal(t, oci.EmptyConfigMediaType, resp.Header.Get("Content-Type"),
			"Content-Type should be OCI empty config media type")
	})
}

// getProxyToken authenticates against the proxy token endpoint and returns a JWT token.
func getProxyToken(t *testing.T, proxyAddress string) string {
	t.Helper()

	tokenURL := fmt.Sprintf("http://%s/v2/token?service=%s&scope=repository:test-image:pull",
		proxyAddress, proxyAddress)
	req, err := http.NewRequest("GET", tokenURL, nil)
	require.NoError(t, err)
	req.SetBasicAuth("testociteam", "testpassword")

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	require.Equal(t, http.StatusOK, resp.StatusCode, "token endpoint should return 200")

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	var tokenResp struct {
		Token string `json:"token"`
	}
	err = json.Unmarshal(body, &tokenResp)
	require.NoError(t, err)
	require.NotEmpty(t, tokenResp.Token, "token should not be empty")

	return tokenResp.Token
}
