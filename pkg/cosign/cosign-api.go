package cosign

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"crypto"
	"crypto/ecdsa"
	"crypto/x509"
	"encoding/asn1"
	"encoding/pem"
	"math/big"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"io"

	"github.com/securebuildhq/securebuild/pkg/logger"
	oci "github.com/securebuildhq/securebuild/pkg/oci"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/registry"
	sigcosign "github.com/sigstore/cosign/v2/pkg/cosign"
	"github.com/sigstore/sigstore/pkg/signature/dsse"
	"github.com/sigstore/sigstore/pkg/signature/payload"
	"go.uber.org/zap"
)

type Subject struct {
	Name   string            `json:"name"`
	Digest map[string]string `json:"digest"`
}

type InTotoStatement struct {
	Type          string      `json:"_type"`
	PredicateType string      `json:"predicateType"`
	Subject       []Subject   `json:"subject"`
	Predicate     interface{} `json:"predicate"`
}

// parseDSSEEnvelope extracts the base64 signature from a DSSE envelope
func parseDSSEEnvelope(dsseBytes []byte) (string, error) {
	var dsseEnvelope struct {
		Payload     string `json:"payload"`
		PayloadType string `json:"payloadType"`
		Signatures  []struct {
			KeyID string `json:"keyid"`
			Sig   string `json:"sig"`
		} `json:"signatures"`
	}
	if err := json.Unmarshal(dsseBytes, &dsseEnvelope); err != nil {
		return "", fmt.Errorf("failed to unmarshal DSSE envelope for annotation: %w", err)
	}
	var signatureBase64 string
	if len(dsseEnvelope.Signatures) > 0 {
		signatureBase64 = dsseEnvelope.Signatures[0].Sig
	}
	return signatureBase64, nil
}

// buildCustomSubjectStatement creates an InTotoStatement with the custom subject logic (proxy registry path).
func buildCustomSubjectStatement(ctx context.Context, digest string, predicateType string, predicate interface{}) InTotoStatement {
	// Set the final subject name using the OCI prefix (falls back to registry prefix)
	ociPrefix := registry.NormalizePrefix(param.GetParam(ctx).OCIImagePrefix)
	if ociPrefix == "" {
		ociPrefix = registry.NormalizePrefix(param.GetParam(ctx).RegistryImagePrefix)
	}
	finalSubjectName := ociPrefix

	return InTotoStatement{
		Type:          "https://in-toto.io/Statement/v0.1",
		PredicateType: predicateType,
		Subject: []Subject{{
			Name:   finalSubjectName,
			Digest: map[string]string{"sha256": digest},
		}},
		Predicate: predicate,
	}
}

// CosignAttestWithCustomSubject creates and uploads a DSSE envelope with a custom subject for the attestation
// The main functionality is to set the subject to the OCI Proxy using OCI_IMAGE_PREFIX
func CosignAttestWithCustomSubject(ctx context.Context, predicatePath, sbomLabel, digestRef, privateKeyPath, imageCatalogID string) error {
	// Read the predicate (SBOM)
	predicateBytes, err := os.ReadFile(predicatePath)
	if err != nil {
		return fmt.Errorf("failed to read predicate file: %w", err)
	}

	// Parse the predicate as JSON
	var predicate interface{}
	if err := json.Unmarshal(predicateBytes, &predicate); err != nil {
		return fmt.Errorf("failed to parse predicate as JSON: %w", err)
	}

	// Extract digest from digestRef (e.g., "registry/repo@sha256:abc123" -> "abc123")
	digest := digestRef
	if idx := strings.LastIndex(digestRef, "@"); idx != -1 {
		digest = digestRef[idx+1:]
	}
	digest = strings.TrimPrefix(digest, "sha256:")

	// Use the helper to build the in-toto statement
	statement := buildCustomSubjectStatement(ctx, digest, "https://spdx.dev/Document", predicate)

	jsonPayload, err := json.Marshal(statement)
	if err != nil {
		return fmt.Errorf("failed to marshal statement: %w", err)
	}

	// Load the private key (support password-protected cosign keys)
	keyBytes, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return fmt.Errorf("failed to read private key: %w", err)
	}
	if !bytes.HasPrefix(keyBytes, []byte("-----BEGIN")) {
		decodedKey, decodeErr := base64.StdEncoding.DecodeString(string(keyBytes))
		if decodeErr != nil {
			return fmt.Errorf("failed to base64 decode cosign key: %w", decodeErr)
		}
		keyBytes = decodedKey
	}

	// Use cosign.LoadPrivateKey to support Sigstore JSON-in-PEM format
	privKey, err := sigcosign.LoadPrivateKey(keyBytes, []byte(param.GetParam(ctx).CosignPassword), nil)
	if err != nil {
		return fmt.Errorf("failed to load cosign private key: %w", err)
	}

	// Sign the DSSE envelope with the final payload (no patching after signing)
	wrapped := dsse.WrapSigner(privKey, "application/vnd.in-toto+json")
	dsseBytes, err := wrapped.SignMessage(bytes.NewReader(jsonPayload))
	if err != nil {
		return fmt.Errorf("failed to sign DSSE envelope: %w", err)
	}

	// --- OCI-compliant attestation manifest creation ---
	// 1. Store the DSSE envelope as a blob in the DB
	//    (mediaType: application/vnd.dsse.envelope.v1+json)
	dsseHash := fmt.Sprintf("sha256:%x", sha256.Sum256(dsseBytes))
	if err := oci.StoreArtifactBlob(ctx, dsseHash, "application/vnd.dsse.envelope.v1+json", dsseBytes); err != nil {
		return fmt.Errorf("failed to store DSSE envelope blob: %w", err)
	}

	// --- Round-trip check: fetch the blob back and compare to dsseBytes ---
	// any modification will cause all signature verification to fail
	stored, _, err := oci.GetArtifactBlobByDigest(ctx, dsseHash)
	if err != nil {
		return fmt.Errorf("failed to fetch DSSE envelope blob: %w", err)
	} else if !bytes.Equal(stored, dsseBytes) {
		return fmt.Errorf("DSSE envelope bytes mismatch after store/fetch")
	}

	// 2. Build the OCI artifact manifest (subject = image digest, layer = DSSE envelope)
	subjectDigest := "sha256:" + digest
	subjectBytes, _, err := oci.GetArtifactBlobByDigest(ctx, subjectDigest)
	if err != nil {
		return fmt.Errorf("failed to fetch subject manifest for size: %w", err)
	}
	subjectDesc := oci.Descriptor{
		MediaType: "application/vnd.oci.image.manifest.v1+json", // subject is the image manifest
		Digest:    subjectDigest,
		Size:      int64(len(subjectBytes)),
	}

	// Parse the DSSE envelope to extract the signature
	signatureBase64, err := parseDSSEEnvelope(dsseBytes)
	if err != nil {
		return err
	}

	layerDesc := oci.Descriptor{
		MediaType: "application/vnd.dsse.envelope.v1+json",
		Digest:    dsseHash,
		Size:      int64(len(dsseBytes)),
		Annotations: map[string]string{
			"dev.cosignproject.cosign/predicateType": statement.PredicateType,
			"dev.cosignproject.cosign/signature":     signatureBase64,
		},
	}
	// Generate the OCI artifact manifest
	manifestBytes, err := oci.NewOCIArtifactManifest(&subjectDesc, "application/vnd.in-toto+json", []oci.Descriptor{layerDesc}, nil)
	if err != nil {
		return fmt.Errorf("failed to build OCI artifact manifest: %w", err)
	}

	// 3. Store the manifest in the DB (oci_artifact_blob and oci_artifact_manifest)
	if err := oci.StoreFullArtifactManifest(ctx, manifestBytes, imageCatalogID, nil); err != nil {
		return fmt.Errorf("failed to store full artifact manifest: %w", err)
	}

	logger.Info("uploaded custom attestation to local DB (OCI-compliant)", zap.String("subjectDigest", digest), zap.Int("manifestLength", len(manifestBytes)))
	return nil
}

// CosignSignWithKeyCustomSubject produces a *key-based* cosign simple-signing
// signature for the given image digest reference (e.g.
//
//	localhost:8888/zlib@sha256:<digest>)
//
// and stores both the payload blob (mediaType
// application/vnd.dev.cosign.simplesigning.v1+json) and an OCI artifact
// manifest in the local DB.  Unlike the CLI-based flow, nothing is pushed to
// the upstream registry – the proxy serves the signature directly from the DB.
//
// The docker-reference inside the payload exactly matches the reference that
// end-users (and our tests) will verify ( <OCI_IMAGE_PREFIX>/<image> ), ensuring
// signature validation succeeds through the proxy.
func CosignSignWithKeyCustomSubject(ctx context.Context, imageRef, base64PrivateKey, cosignPassword, imageCatalogID string) error {
	// ------------------------------------------------------------------
	// 1. Decode and load the ECDSA private key
	// ------------------------------------------------------------------
	keyBytes, err := base64.StdEncoding.DecodeString(base64PrivateKey)
	if err != nil {
		return fmt.Errorf("failed to base64-decode cosign private key: %w", err)
	}

	signer, err := sigcosign.LoadPrivateKey(keyBytes, []byte(cosignPassword), nil)
	if err != nil {
		return fmt.Errorf("failed to load cosign private key: %w", err)
	}

	// sigcosign returns crypto.Signer; ensure we can sign directly.
	// The Sign method returns ASN.1-encoded signature bytes.

	// ------------------------------------------------------------------
	// 2. Build the Simple Signing payload with proxy docker-reference
	// ------------------------------------------------------------------
	// Extract digest (without sha256:) from imageRef
	digest := imageRef
	if idx := strings.LastIndex(imageRef, "@"); idx != -1 {
		digest = imageRef[idx+1:]
	}
	digest = strings.TrimPrefix(digest, "sha256:")

	// docker-reference == imageRef without the @sha256:… suffix
	imageRefNoDigest := strings.SplitN(imageRef, "@", 2)[0]

	// ------------------------------------------------------------------
	// Build the Simple-Signing payload using the official cosign type to ensure
	// canonical JSON identical to the CLI implementation.
	// Optional is left nil so the field is omitted exactly as in CLI payloads.
	// ------------------------------------------------------------------
	var scPayload payload.SimpleContainerImage
	scPayload.Critical.Type = "cosign container image signature"
	scPayload.Critical.Image.DockerManifestDigest = "sha256:" + digest
	scPayload.Critical.Identity.DockerReference = imageRefNoDigest

	payloadBytes, err := json.Marshal(scPayload)
	if err != nil {
		return fmt.Errorf("failed to marshal Simple Signing payload: %w", err)
	}

	// ------------------------------------------------------------------
	// 3. Sign the payload (ECDSA-P256 SHA-256) using the cosign key
	//    We hash the payload first to match cosign CLI behaviour.
	// ------------------------------------------------------------------
	payloadHash := sha256.Sum256(payloadBytes)
	csigner, ok := signer.(crypto.Signer)
	if !ok {
		return fmt.Errorf("loaded key does not implement crypto.Signer")
	}
	sigBytes, err := csigner.Sign(rand.Reader, payloadHash[:], crypto.SHA256)
	if err != nil {
		return fmt.Errorf("failed to sign payload: %w", err)
	}
	signatureBase64 := base64.StdEncoding.EncodeToString(sigBytes)

	// ------------------------------------------------------------------
	// 4. Store the payload blob in the DB
	// ------------------------------------------------------------------
	payloadHashHex := fmt.Sprintf("sha256:%x", sha256.Sum256(payloadBytes))
	if err := oci.StoreArtifactBlob(ctx, payloadHashHex, "application/vnd.dev.cosign.simplesigning.v1+json", payloadBytes); err != nil {
		return fmt.Errorf("failed to store signature payload blob: %w", err)
	}

	// Guard round-trip integrity (debug)
	if stored, _, err := oci.GetArtifactBlobByDigest(ctx, payloadHashHex); err != nil {
		return fmt.Errorf("payload blob fetch failed: %w", err)
	} else if !bytes.Equal(stored, payloadBytes) {
		return fmt.Errorf("payload blob mismatch after store/fetch")
	}

	// ------------------------------------------------------------------
	// 5. Build and store the OCI artifact manifest (subject = image digest)
	// ------------------------------------------------------------------
	subjectDigest := "sha256:" + digest
	subjectBytes, _, err := oci.GetArtifactBlobByDigest(ctx, subjectDigest)
	if err != nil {
		return fmt.Errorf("failed to fetch subject manifest blob: %w", err)
	}

	subjectDesc := oci.Descriptor{
		MediaType: "application/vnd.oci.image.manifest.v1+json",
		Digest:    subjectDigest,
		Size:      int64(len(subjectBytes)),
	}

	layerDesc := oci.Descriptor{
		MediaType: "application/vnd.dev.cosign.simplesigning.v1+json",
		Digest:    payloadHashHex,
		Size:      int64(len(payloadBytes)),
		Annotations: map[string]string{
			"dev.cosignproject.cosign/signature": signatureBase64,
			"dev.cosignproject.cosign/keyless":   "false",
		},
	}

	manifestAnnotations := map[string]string{
		"dev.cosignproject.cosign/keyless": "false",
	}

	manifestBytes, err := oci.NewOCIArtifactManifest(&subjectDesc, "application/vnd.dev.cosign.simplesigning.v1+json", []oci.Descriptor{layerDesc}, manifestAnnotations)
	if err != nil {
		return fmt.Errorf("failed to build OCI artifact manifest: %w", err)
	}

	if err := oci.StoreFullArtifactManifest(ctx, manifestBytes, imageCatalogID, nil); err != nil {
		return fmt.Errorf("failed to store signature artifact manifest: %w", err)
	}

	logger.Info("uploaded custom keyed signature to local DB (OCI-compliant)",
		zap.String("subjectDigest", digest),
		zap.Int("manifestLength", len(manifestBytes)))

	return nil
}

// CosignSignKeylessWithCustomSubject has been relocated to keyless.go to isolate keyless logic.

// CosignVerifyWithKeyAPI verifies that the image at imageRef has a valid cosign
// simple-signing signature that can be verified with the supplied ECDSA public
// key (raw PEM or base64-encoded PEM). The function mirrors the behaviour of
// the old CLI-based CosignVerifyWithKey but relies entirely on Go libraries so
// no shelling-out occurs.
func CosignVerifyWithKeyAPI(ctx context.Context, imageRef, base64OrPEMPubKey, registryUsername, registryPassword string) error {
	// ------------------------------------------------------------------
	// 1. Load the public key (ECDSA-P256) from PEM / base64-PEM
	// ------------------------------------------------------------------
	var pemBytes []byte
	if strings.HasPrefix(base64OrPEMPubKey, "-----BEGIN") {
		pemBytes = []byte(base64OrPEMPubKey)
	} else {
		decoded, err := base64.StdEncoding.DecodeString(base64OrPEMPubKey)
		if err != nil {
			return fmt.Errorf("public key is neither PEM nor base64-encoded PEM: %w", err)
		}
		pemBytes = decoded
	}

	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return fmt.Errorf("failed to decode PEM public key")
	}
	pubAny, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return fmt.Errorf("failed to parse public key: %w", err)
	}
	pubKey, ok := pubAny.(*ecdsa.PublicKey)
	if !ok {
		return fmt.Errorf("public key is not ECDSA")
	}

	// ------------------------------------------------------------------
	// 2. Derive the signature reference (<repo>:sha256-<digest>.sig)
	// ------------------------------------------------------------------
	digestRef, err := name.NewDigest(imageRef)
	if err != nil {
		return fmt.Errorf("invalid digest reference %q: %w", imageRef, err)
	}
	digestHash := strings.TrimPrefix(digestRef.DigestStr(), "sha256:")
	sigTagStr := fmt.Sprintf("%s:sha256-%s.sig", digestRef.Repository.String(), digestHash)
	sigRef, err := name.ParseReference(sigTagStr)
	if err != nil {
		return fmt.Errorf("failed to parse signature reference: %w", err)
	}

	// Registry auth (basic static creds)
	auth := authn.FromConfig(authn.AuthConfig{
		Username: registryUsername,
		Password: registryPassword,
	})

	// ------------------------------------------------------------------
	// 3. Fetch the signature manifest and extract payload + signature
	// ------------------------------------------------------------------
	desc, err := remote.Get(sigRef, remote.WithAuth(auth), remote.WithContext(ctx))
	if err != nil {
		return fmt.Errorf("failed to fetch signature manifest: %w", err)
	}

	var manifest v1.Manifest
	if err := json.Unmarshal(desc.Manifest, &manifest); err != nil {
		return fmt.Errorf("failed to unmarshal signature manifest: %w", err)
	}
	if len(manifest.Layers) == 0 {
		return fmt.Errorf("signature manifest contains no layers")
	}
	layerDesc := manifest.Layers[0]
	sigB64, ok := layerDesc.Annotations["dev.cosignproject.cosign/signature"]
	if !ok || sigB64 == "" {
		return fmt.Errorf("signature annotation not found in layer descriptor")
	}

	// ------------------------------------------------------------------
	// 4. Download the payload blob (application/vnd.dev.cosign.simplesigning…)
	// ------------------------------------------------------------------
	// Build a full digest reference <repo>@sha256:...
	payloadDigestRef := fmt.Sprintf("%s@%s", digestRef.Repository.String(), layerDesc.Digest.String())
	digRef, err := name.NewDigest(payloadDigestRef)
	if err != nil {
		return fmt.Errorf("failed to build payload digest ref: %w", err)
	}
	lyr, err := remote.Layer(digRef, remote.WithAuth(auth), remote.WithContext(ctx))
	if err != nil {
		return fmt.Errorf("failed to fetch signature layer: %w", err)
	}
	r, err := lyr.Compressed()
	if err != nil {
		return fmt.Errorf("failed to open layer reader: %w", err)
	}
	defer r.Close()
	payloadBytes, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("failed to read payload blob: %w", err)
	}

	// ------------------------------------------------------------------
	// 5. Cryptographically verify the signature
	// ------------------------------------------------------------------
	hash := sha256.Sum256(payloadBytes)
	sigBytes, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		return fmt.Errorf("failed to decode signature base64: %w", err)
	}
	var rs struct{ R, S *big.Int }
	if _, err := asn1.Unmarshal(sigBytes, &rs); err != nil {
		return fmt.Errorf("failed to unmarshal ASN.1 signature: %w", err)
	}
	if !ecdsa.Verify(pubKey, hash[:], rs.R, rs.S) {
		return fmt.Errorf("signature verification failed (ECDSA verify returned false)")
	}

	return nil
}
