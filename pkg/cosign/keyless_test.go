package cosign

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"hash"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/go-openapi/strfmt"
	oci "github.com/securebuildhq/securebuild/pkg/oci"
	"github.com/securebuildhq/securebuild/pkg/oidc"
	"github.com/securebuildhq/securebuild/pkg/param"
	fulcioclient "github.com/sigstore/fulcio/pkg/api"
	generatedclient "github.com/sigstore/rekor/pkg/generated/client"
	rekorModels "github.com/sigstore/rekor/pkg/generated/models"
	"google.golang.org/api/option"
)

// -----------------------------------------------------------------------------
// Test helpers / stubs
// -----------------------------------------------------------------------------

type stubOIDCProvider struct{}

func (s stubOIDCProvider) GetIDToken(ctx context.Context, aud string) (string, error) {
	// Minimal unsigned JWT: header {"alg":"none"}, payload {"email":"test@example.com"}
	return "eyJhbGciOiJub25lIn0.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.", nil
}

type stubFulcio struct{}

func (s *stubFulcio) SigningCert(req fulcioclient.CertificateRequest, token string) (*fulcioclient.CertificateResponse, error) {
	// Return a minimal but valid PEM encoded cert (fake)
	return &fulcioclient.CertificateResponse{CertPEM: []byte("-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----")}, nil
}

// -----------------------------------------------------------------------------
// Unit test
// -----------------------------------------------------------------------------

func TestCosignSignKeylessWithCustomSubject(t *testing.T) {
	t.Setenv("OCI_IMAGE_PREFIX", "dummy-host/dummy-slug")
	t.Setenv("REGISTRY_IMAGE_PREFIX", "dummy-host/dummy-slug")
	t.Setenv("REGISTRY_USERNAME", "test")
	t.Setenv("REGISTRY_PASSWORD", "test")

	// Detect whether we should run live (real Fulcio/Rekor) or stubbed.
	live := strings.EqualFold(os.Getenv("KEYLESS_LIVE_SIGNING"), "true")

	// Prepare minimal Param needed by the function.
	var ctx context.Context
	var err error
	if live {
		// Load parameters from environment (populated by Doppler).
		ctx, err = param.Init(param.InitSourceEnvironment, nil)
		if err != nil {
			t.Fatalf("failed to init params from env: %v", err)
		}
	} else {
		// Offline/stubbed mode still requires parameters from environment; initialise
		// and fail fast if mandatory values are missing.
		ctx, err = param.Init(param.InitSourceEnvironment, nil)
		if err != nil {
			t.Fatalf("failed to init params from env (offline mode): %v", err)
		}
		ociPrefix := param.GetParam(ctx).OCIImagePrefix
		if ociPrefix == "" {
			ociPrefix = param.GetParam(ctx).RegistryImagePrefix
		}
		if ociPrefix == "" {
			t.Fatalf("OCI_IMAGE_PREFIX or REGISTRY_IMAGE_PREFIX must be set for offline mode test")
		}
	}

	// Image reference to sign
	digest := strings.Repeat("a", 64)
	imageRef := "registry.example.com/my-app@sha256:" + digest

	// ---- Optionally stub external side-effect functions ----
	originalNewFulcio := newFulcioClient
	originalGetRekor := getRekorClient
	originalTlogUpload := tlogUpload
	originalStoreBlob := storeArtifactBlob
	originalGetBlob := getArtifactBlobByDigest
	originalNewManifest := newOCIImageManifest
	originalStoreManifest := storeFullArtifactManifest

	defer func() {
		newFulcioClient = originalNewFulcio
		getRekorClient = originalGetRekor
		tlogUpload = originalTlogUpload
		storeArtifactBlob = originalStoreBlob
		getArtifactBlobByDigest = originalGetBlob
		newOCIImageManifest = originalNewManifest
		storeFullArtifactManifest = originalStoreManifest
	}()

	if !live {
		// -------------------------------------------
		// Stub Fulcio/Rekor for fast, offline testing
		// -------------------------------------------

		// Fulcio stub
		newFulcioClient = func(u *url.URL) fulcioSigningClient { return &stubFulcio{} }

		// Rekor stubs
		getRekorClient = func(_ string) (*generatedclient.Rekor, error) { return nil, nil }

		tlogUpload = func(ctx context.Context, rc *generatedclient.Rekor, sig []byte, h hash.Hash, cert []byte) (*rekorModels.LogEntryAnon, error) {
			// Return a minimal log entry sufficient for EntryToBundle
			now := int64(1)
			logID := strings.Repeat("b", 64)
			return &rekorModels.LogEntryAnon{
				Body:           "{}",
				IntegratedTime: &now,
				LogIndex:       &now,
				LogID:          &logID,
				Verification: &rekorModels.LogEntryAnonVerification{
					SignedEntryTimestamp: strfmt.Base64([]byte("sig")),
				},
			}, nil
		}
	}

	// Capture store calls
	var (
		storedDigest   string
		storedPayload  []byte
		storeBlobCalls int
	)
	storeArtifactBlob = func(ctx context.Context, digest, mediaType string, content []byte) error {
		storeBlobCalls++
		storedDigest = digest
		storedPayload = make([]byte, len(content))
		copy(storedPayload, content)
		return nil
	}

	// getArtifactBlobByDigest returns subject manifest (fake) or stored payload
	getArtifactBlobByDigest = func(ctx context.Context, digest string) ([]byte, string, error) {
		if digest == storedDigest {
			return storedPayload, "application/vnd.dev.cosign.simplesigning.v1+json", nil
		}
		// For subject digest return dummy manifest bytes so size calc works
		return []byte("{\"schemaVersion\":2}"), "application/vnd.oci.image.manifest.v1+json", nil
	}

	// newOCIImageManifest captures subject and layers
	var capturedSubjectDigest string
	var capturedLayerSig string
	var capturedLayerAnn map[string]string
	newOCIImageManifest = func(subject *oci.Descriptor, artifactType string, layers []oci.Descriptor, ann map[string]string) ([]byte, error) {
		capturedSubjectDigest = subject.Digest
		if len(layers) != 1 {
			t.Fatalf("expected 1 layer, got %d", len(layers))
		}
		capturedLayerSig = layers[0].Annotations["dev.cosignproject.cosign/signature"]
		capturedLayerAnn = layers[0].Annotations
		// return placeholder
		return []byte("manifest"), nil
	}

	// storeFullArtifactManifest no-op
	storeFullArtifactManifest = func(ctx context.Context, manifest []byte, imageCatalogID string, attestID *string) error { return nil }

	// Select OIDC provider: stub or real GCP depending on live flag
	var provider interface {
		GetIDToken(context.Context, string) (string, error)
	} // matches oidc.OIDCProvider
	if live {
		p := param.GetParam(ctx)
		sa := p.OIDCGCPAttestorAccount
		keyJSON := p.OIDCGCPAttestorKeyJSON
		if sa == "" || keyJSON == "" {
			t.Fatalf("live signing requires OIDCGCPAttestorAccount and OIDCGCPAttestorKeyJSON params to be set (populated by Doppler)")
		}
		credsOpt := option.WithCredentialsJSON([]byte(keyJSON))
		gcpProv, err := oidc.NewGCPProvider(context.Background(), sa, credsOpt)
		if err != nil {
			t.Fatalf("failed to init GCP OIDC provider: %v", err)
		}
		provider = gcpProv
	} else {
		provider = stubOIDCProvider{}
	}

	// Execute function under test
	err = CosignSignKeylessWithCustomSubject(ctx, imageRef, provider, "ic_test")
	if err != nil {
		t.Fatalf("function returned error: %v", err)
	}

	// Assertions
	if storeBlobCalls != 1 {
		t.Fatalf("expected storeArtifactBlob to be called once, got %d", storeBlobCalls)
	}

	// Parse stored payload JSON and check custom subject
	var payload struct {
		Critical struct {
			Image struct {
				DockerManifestDigest string `json:"docker-manifest-digest"`
			} `json:"image"`
			Identity struct {
				DockerReference string `json:"docker-reference"`
			} `json:"identity"`
		} `json:"critical"`
	}
	if err := json.Unmarshal(storedPayload, &payload); err != nil {
		t.Fatalf("failed to unmarshal stored payload: %v", err)
	}

	expectedDigest := "sha256:" + digest
	if payload.Critical.Image.DockerManifestDigest != expectedDigest {
		t.Fatalf("expected payload digest %s, got %s", expectedDigest, payload.Critical.Image.DockerManifestDigest)
	}

	ociPrefixForExpected := param.GetParam(ctx).OCIImagePrefix
	if ociPrefixForExpected == "" {
		ociPrefixForExpected = param.GetParam(ctx).RegistryImagePrefix
	}
	expectedRef := ociPrefixForExpected
	if payload.Critical.Identity.DockerReference != expectedRef {
		t.Fatalf("expected docker-reference %s, got %s", expectedRef, payload.Critical.Identity.DockerReference)
	}

	if capturedSubjectDigest != expectedDigest {
		t.Fatalf("expected subject digest %s in manifest, got %s", expectedDigest, capturedSubjectDigest)
	}

	if capturedLayerSig == "" {
		t.Fatalf("signature annotation not set in layer descriptor")
	}

	// -----------------------------------------------------------------
	// Verbose output for manual inspection
	// -----------------------------------------------------------------
	trunc := func(s string, n int) string {
		if len(s) <= n {
			return s
		}
		return s[:n] + "…"
	}

	t.Logf("Simple signing payload: %s", trunc(string(storedPayload), 300))
	t.Logf("Layer signature (base64, first 80): %s", trunc(capturedLayerSig, 80))
	if cert, ok := capturedLayerAnn["dev.sigstore.fulcio/certificate"]; ok {
		t.Logf("Certificate PEM (first 120): %s", trunc(cert, 120))
	}
	if bundle, ok := capturedLayerAnn["dev.sigstore.cosign/bundle"]; ok {
		// Existing truncated output for quick glance
		t.Logf("Rekor bundle JSON (first 120): %s", trunc(bundle, 120))

		// Parse the bundle JSON so developers can manually query Rekor.
		var b map[string]interface{}
		if err := json.Unmarshal([]byte(bundle), &b); err == nil {
			if payload, ok := b["Payload"].(map[string]interface{}); ok {
				var (
					logIndex       int64
					integratedTime int64
					logID          string
				)
				if v, ok := payload["logIndex"].(float64); ok {
					logIndex = int64(v)
				}
				if v, ok := payload["integratedTime"].(float64); ok {
					integratedTime = int64(v)
				}
				// logID may appear as a string or nested object depending on Rekor version
				switch id := payload["logID"].(type) {
				case string:
					logID = id
				case map[string]interface{}:
					if key, ok := id["keyID"].(string); ok {
						logID = key
					}
				}

				t.Logf("Rekor transparency log details: logIndex=%d, integratedTime=%d, logID=%s", logIndex, integratedTime, logID)
				if logIndex != 0 {
					t.Logf("To manually inspect the log entry, run: curl -s 'https://rekor.sigstore.dev/api/v1/log/entries?logIndex=%d' | jq '.'", logIndex)
				}
			}
		}
	}
}

// -----------------------------------------------------------------------------
// New test: keyless attestation
// -----------------------------------------------------------------------------
func TestCosignAttestKeylessWithCustomSubject(t *testing.T) {
	// Detect whether we should run live (real Fulcio/Rekor) or stubbed.
	live := strings.EqualFold(os.Getenv("KEYLESS_LIVE_SIGNING"), "true")

	ctx, err := param.Init(param.InitSourceEnvironment, nil)
	if err != nil {
		t.Fatalf("failed to init params from env: %v", err)
	}

	// Prepare temp predicate file
	predFile, err := os.CreateTemp(t.TempDir(), "predicate-*.json")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	predicateContent := []byte(`{"foo":"bar"}`)
	if _, err := predFile.Write(predicateContent); err != nil {
		t.Fatalf("failed to write predicate: %v", err)
	}
	_ = predFile.Close()

	// Image digest reference
	digest := strings.Repeat("b", 64)
	imageRef := "registry.example.com/my-app@sha256:" + digest

	// Save originals
	origStoreBlob := storeArtifactBlob
	origGetBlob := getArtifactBlobByDigest
	origNewManifest := newOCIImageManifest
	origStoreManifest := storeFullArtifactManifest
	origNewFulcio := newFulcioClient
	origGetRekor := getRekorClient
	origTlogUploadDSSE := tlogUploadDSSE

	defer func() {
		storeArtifactBlob = origStoreBlob
		getArtifactBlobByDigest = origGetBlob
		newOCIImageManifest = origNewManifest
		storeFullArtifactManifest = origStoreManifest
		newFulcioClient = origNewFulcio
		getRekorClient = origGetRekor
		tlogUploadDSSE = origTlogUploadDSSE
	}()

	// Capture calls
	var (
		storedDigest         string
		storedBytes          []byte
		manifestArtifactType string
		capturedLayerAnn     map[string]string
	)
	storeArtifactBlob = func(ctx context.Context, digest, mediaType string, content []byte) error {
		storedDigest = digest
		storedBytes = append([]byte(nil), content...)
		return nil
	}
	getArtifactBlobByDigest = func(ctx context.Context, d string) ([]byte, string, error) {
		if d == storedDigest {
			return storedBytes, "application/vnd.dsse.envelope.v1+json", nil
		}
		return []byte("{\"schemaVersion\":2}"), "application/vnd.oci.image.manifest.v1+json", nil
	}
	newOCIImageManifest = func(subject *oci.Descriptor, artifactType string, layers []oci.Descriptor, ann map[string]string) ([]byte, error) {
		manifestArtifactType = artifactType
		if len(layers) > 0 {
			capturedLayerAnn = layers[0].Annotations
		}
		return []byte("manifest"), nil
	}
	storeFullArtifactManifest = func(ctx context.Context, manifest []byte, imageCatalogID string, attestID *string) error { return nil }

	if !live {
		// Stub Fulcio and Rekor similar to sign test
		newFulcioClient = func(u *url.URL) fulcioSigningClient { return &stubFulcio{} }
		getRekorClient = func(_ string) (*generatedclient.Rekor, error) { return nil, nil }
		tlogUploadDSSE = func(ctx context.Context, rc *generatedclient.Rekor, sig []byte, cert []byte) (*rekorModels.LogEntryAnon, error) {
			now := int64(1)
			logID := strings.Repeat("c", 64)
			return &rekorModels.LogEntryAnon{
				Body:           "{}",
				IntegratedTime: &now,
				LogIndex:       &now,
				LogID:          &logID,
				Verification: &rekorModels.LogEntryAnonVerification{
					SignedEntryTimestamp: strfmt.Base64([]byte("sig")),
				},
			}, nil
		}
	}

	// Select OIDC provider (stub vs real)
	var provider interface {
		GetIDToken(context.Context, string) (string, error)
	}
	if live {
		p := param.GetParam(ctx)
		sa := p.OIDCGCPAttestorAccount
		keyJSON := p.OIDCGCPAttestorKeyJSON
		if sa == "" || keyJSON == "" {
			t.Skip("live attestation requires OIDCGCPAttestorAccount and OIDCGCPAttestorKeyJSON params; skipping")
		}
		credsOpt := option.WithCredentialsJSON([]byte(keyJSON))
		gcpProv, err := oidc.NewGCPProvider(context.Background(), sa, credsOpt)
		if err != nil {
			t.Fatalf("failed to init GCP OIDC provider: %v", err)
		}
		provider = gcpProv
	} else {
		provider = stubOIDCProvider{}
	}

	// Call function under test
	if err := CosignAttestKeylessWithCustomSubject(ctx, predFile.Name(), PredicateSPDX, imageRef, provider, "ic_test"); err != nil {
		t.Fatalf("function returned error: %v", err)
	}

	// -----------------------------------------------------------------
	// Verbose output for manual inspection (similar to signing test)
	// -----------------------------------------------------------------
	trunc := func(s string, n int) string {
		if len(s) <= n {
			return s
		}
		return s[:n] + "…"
	}

	t.Logf("DSSE envelope (base64 payload trimmed): %s", trunc(string(storedBytes), 160))

	if sig, ok := capturedLayerAnn["dev.cosignproject.cosign/signature"]; ok {
		t.Logf("Layer signature (base64, first 80): %s", trunc(sig, 80))
	}
	if cert, ok := capturedLayerAnn["dev.sigstore.fulcio/certificate"]; ok {
		t.Logf("Certificate PEM (first 120): %s", trunc(cert, 120))
	}
	if bundle, ok := capturedLayerAnn["dev.sigstore.cosign/bundle"]; ok {
		t.Logf("Rekor bundle JSON (first 120): %s", trunc(bundle, 120))

		// Parse bundle for Rekor details
		var b map[string]interface{}
		if err := json.Unmarshal([]byte(bundle), &b); err == nil {
			if payload, ok := b["Payload"].(map[string]interface{}); ok {
				var (
					logIndex       int64
					integratedTime int64
					logID          string
				)
				if v, ok := payload["logIndex"].(float64); ok {
					logIndex = int64(v)
				}
				if v, ok := payload["integratedTime"].(float64); ok {
					integratedTime = int64(v)
				}
				switch id := payload["logID"].(type) {
				case string:
					logID = id
				case map[string]interface{}:
					if key, ok := id["keyID"].(string); ok {
						logID = key
					}
				}
				t.Logf("Rekor transparency log details: logIndex=%d, integratedTime=%d, logID=%s", logIndex, integratedTime, logID)
				if logIndex != 0 {
					t.Logf("To manually inspect the log entry, run: curl -s 'https://rekor.sigstore.dev/api/v1/log/entries?logIndex=%d' | jq '.'", logIndex)
				}
			}
		}
	}

	if manifestArtifactType != "application/vnd.in-toto+json" {
		t.Fatalf("expected artifactType application/vnd.in-toto+json, got %s", manifestArtifactType)
	}

	// Quick sanity: envelope parses and payload matches digest
	var env struct {
		Payload     string `json:"payload"`
		PayloadType string `json:"payloadType"`
	}
	if err := json.Unmarshal(storedBytes, &env); err != nil {
		t.Fatalf("failed to unmarshal envelope: %v", err)
	}
	payloadDecoded, _ := base64.StdEncoding.DecodeString(env.Payload)
	if !bytes.Contains(payloadDecoded, []byte(digest)) {
		t.Fatalf("envelope payload does not contain digest")
	}
}
