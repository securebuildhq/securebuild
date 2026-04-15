package oci

// Package oci provides utilities for managing OCI artifact manifests in the database.

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

// ArtifactManifest represents an artifact manifest in the database.
type ArtifactManifest struct {
	ID             string                 `json:"id"`
	ImageCatalogID string                 `json:"image_catalog_id"`
	SubjectDigest  string                 `json:"subject_digest"`
	MediaType      string                 `json:"media_type"`
	ArtifactType   string                 `json:"artifact_type"`
	ManifestSize   int64                  `json:"manifest_size"`
	Annotations    map[string]interface{} `json:"annotations"`
	AttestID       *string                `json:"attest_id"`
	CreatedAt      time.Time              `json:"created_at"`
	UpdatedAt      time.Time              `json:"updated_at"`
}

// ImageCatalogDigestInfo contains the ID, digests, and index digest for an image catalog.
type ImageCatalogDigestInfo struct {
	ID            string
	DigestX86     string
	DigestAarch64 string
	IndexDigest   string
}

const (
	// MediaTypeOCIManifest is the standard OCI image manifest v1 media type.
	MediaTypeOCIManifest = "application/vnd.oci.image.manifest.v1+json"
	// MediaTypeArtifactManifest is the experimental (withdrawn) artifact manifest media type.
	MediaTypeArtifactManifest = "application/vnd.oci.artifact.manifest.v1+json"
	// EmptyConfigMediaType is the OCI empty config descriptor media type.
	EmptyConfigMediaType = "application/vnd.oci.empty.v1+json"
	// EmptyConfigDigest is the sha256 digest of "{}".
	EmptyConfigDigest = "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
	// EmptyConfigSize is the byte size of "{}".
	EmptyConfigSize = 2
)

// EmptyConfigBytes is the raw bytes of the OCI empty config.
var EmptyConfigBytes = []byte("{}")

// OCIArtifactManifest is a minimal struct for application/vnd.oci.artifact.manifest.v1+json
// See: https://github.com/opencontainers/image-spec/blob/main/artifact.md
type OCIArtifactManifest struct {
	SchemaVersion int               `json:"schemaVersion"`
	MediaType     string            `json:"mediaType"`
	ArtifactType  string            `json:"artifactType"`
	Layers        []Descriptor      `json:"layers"`
	Subject       *Descriptor       `json:"subject,omitempty"`
	Annotations   map[string]string `json:"annotations,omitempty"`
}

// OCIImageManifest is an OCI image manifest v1 with artifactType support (OCI v1.1).
// This is the format that cosign/go-containerregistry can parse.
type OCIImageManifest struct {
	SchemaVersion int               `json:"schemaVersion"`
	MediaType     string            `json:"mediaType"`
	Config        Descriptor        `json:"config"`
	ArtifactType  string            `json:"artifactType,omitempty"`
	Layers        []Descriptor      `json:"layers"`
	Subject       *Descriptor       `json:"subject,omitempty"`
	Annotations   map[string]string `json:"annotations,omitempty"`
}

type Descriptor struct {
	MediaType   string            `json:"mediaType"`
	Digest      string            `json:"digest"`
	Size        int64             `json:"size"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// NewOCIArtifactManifest constructs an OCI image manifest (v1.1 format with artifactType)
// and returns its JSON bytes. Despite the name, this now produces the standard OCI image
// manifest format that cosign and go-containerregistry can parse, rather than the
// experimental artifact manifest format that was never finalized.
func NewOCIArtifactManifest(subject *Descriptor, artifactType string, layers []Descriptor, annotations map[string]string) ([]byte, error) {
	if annotations == nil {
		annotations = map[string]string{}
	}
	manifest := OCIImageManifest{
		SchemaVersion: 2,
		MediaType:     MediaTypeOCIManifest,
		Config: Descriptor{
			MediaType: EmptyConfigMediaType,
			Digest:    EmptyConfigDigest,
			Size:      EmptyConfigSize,
		},
		ArtifactType: artifactType,
		Layers:       layers,
		Subject:      subject,
		Annotations:  annotations,
	}
	return json.Marshal(manifest)
}

// ConvertArtifactToImageManifest converts an old-format artifact manifest to an OCI image
// manifest (v1.1). Returns the converted bytes and its digest. If the manifest is already
// in image manifest format, it is returned unchanged.
func ConvertArtifactToImageManifest(manifestBytes []byte) ([]byte, string, error) {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(manifestBytes, &raw); err != nil {
		return nil, "", fmt.Errorf("failed to parse manifest: %w", err)
	}

	var mediaType string
	if mt, ok := raw["mediaType"]; ok {
		if err := json.Unmarshal(mt, &mediaType); err != nil {
			return nil, "", fmt.Errorf("failed to parse mediaType: %w", err)
		}
	}

	if mediaType != MediaTypeArtifactManifest {
		digest := "sha256:" + fmt.Sprintf("%x", sha256Sum(manifestBytes))
		return manifestBytes, digest, nil
	}

	var artifact OCIArtifactManifest
	if err := json.Unmarshal(manifestBytes, &artifact); err != nil {
		return nil, "", fmt.Errorf("failed to parse artifact manifest: %w", err)
	}

	image := OCIImageManifest{
		SchemaVersion: 2,
		MediaType:     MediaTypeOCIManifest,
		Config: Descriptor{
			MediaType: EmptyConfigMediaType,
			Digest:    EmptyConfigDigest,
			Size:      EmptyConfigSize,
		},
		ArtifactType: artifact.ArtifactType,
		Layers:       artifact.Layers,
		Subject:      artifact.Subject,
		Annotations:  artifact.Annotations,
	}

	converted, err := json.Marshal(image)
	if err != nil {
		return nil, "", fmt.Errorf("failed to marshal converted manifest: %w", err)
	}

	digest := "sha256:" + fmt.Sprintf("%x", sha256Sum(converted))
	return converted, digest, nil
}

func RepositoryExists(ctx context.Context, repository string) (bool, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT EXISTS(SELECT 1 FROM image_catalog WHERE name = $1)`
	row := conn.QueryRow(ctx, query, repository)
	var exists bool
	err := row.Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("failed to check repository existence: %w", err)
	}
	return exists, nil
}

// StoreArtifactManifest inserts or updates an artifact manifest in the database.
func StoreArtifactManifest(ctx context.Context, manifest ArtifactManifest) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	annotationsJSON, err := marshalAnnotations(manifest.Annotations)
	if err != nil {
		logger.Error(err)
		return fmt.Errorf("failed to marshal annotations: %w", err)
	}

	query := `
		INSERT INTO oci_artifact_manifest (
			id, image_catalog_id, subject_digest, media_type, artifact_type,
			manifest_size, annotations, attest_id, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		ON CONFLICT (id) DO UPDATE SET
			updated_at = $10,
			annotations = $7
	`

	_, err = conn.Exec(ctx, query,
		manifest.ID, manifest.ImageCatalogID, manifest.SubjectDigest,
		manifest.MediaType, manifest.ArtifactType, manifest.ManifestSize,
		annotationsJSON, manifest.AttestID, manifest.CreatedAt, manifest.UpdatedAt)

	if err != nil {
		return fmt.Errorf("failed to store artifact manifest: %w", err)
	}

	logger.Info("stored artifact manifest", zap.String("id", manifest.ID), zap.String("subject_digest", manifest.SubjectDigest), zap.Any("attest_id", manifest.AttestID))
	return nil
}

// StoreArtifactBlob inserts a manifest blob into the oci_artifact_blob table.
// The content is stored as JSON (validated, for jsonb column) and the raw bytes (for bytea column).
func StoreArtifactBlob(ctx context.Context, digest, mediaType string, content []byte) error {
	// Validate that content is valid JSON before storing (for jsonb)
	var js interface{}
	if err := json.Unmarshal(content, &js); err != nil {
		return fmt.Errorf("artifact manifest content is not valid JSON: %w", err)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		INSERT INTO oci_artifact_blob (
			digest, media_type, content, raw_content, created_at, updated_at
		) VALUES ($1, $2, $3, $4, now(), now())
		ON CONFLICT (digest) DO UPDATE SET
			content = $3,
			raw_content = $4,
			media_type = $2,
			updated_at = now()
	`

	// Marshal the parsed JSON for the jsonb column
	jsonbContent, err := json.Marshal(js)
	if err != nil {
		return fmt.Errorf("failed to marshal content for jsonb: %w", err)
	}

	_, err = conn.Exec(ctx, query, digest, mediaType, jsonbContent, content)
	if err != nil {
		return fmt.Errorf("failed to store artifact blob: %w", err)
	}

	logger.Info("stored artifact blob", zap.String("digest", digest), zap.String("media_type", mediaType))
	return nil
}

// StoreFullArtifactManifest stores the manifest JSON in oci_artifact_blob and metadata in oci_artifact_manifest atomically.
func StoreFullArtifactManifest(ctx context.Context, manifestBytes []byte, imageCatalogID string, attestID *string) error {
	// Parse manifest JSON to extract subject digest, media type, artifact type, annotations, etc.
	var manifestMap map[string]interface{}
	if err := json.Unmarshal(manifestBytes, &manifestMap); err != nil {
		return fmt.Errorf("failed to unmarshal artifact manifest: %w", err)
	}

	// Ensure annotations is always a non-nil map
	if _, ok := manifestMap["annotations"]; !ok || manifestMap["annotations"] == nil {
		manifestMap["annotations"] = map[string]interface{}{}
	}

	subject, ok := manifestMap["subject"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("invalid manifest: missing or invalid subject")
	}
	digestVal, ok := subject["digest"].(string)
	if !ok {
		return fmt.Errorf("invalid manifest: missing or invalid subject digest")
	}
	mediaType, _ := manifestMap["mediaType"].(string)
	artifactType, _ := manifestMap["artifactType"].(string)
	annotations := make(map[string]interface{})
	if ann, ok := manifestMap["annotations"].(map[string]interface{}); ok {
		annotations = ann
	}

	// Always compute digest from the exact original bytes
	manifestDigest := "sha256:" + fmt.Sprintf("%x", sha256Sum(manifestBytes))
	manifestSize := int64(len(manifestBytes))
	now := time.Now()

	// Store in oci_artifact_blob (stores both jsonb and raw bytes)
	if err := StoreArtifactBlob(ctx, manifestDigest, mediaType, manifestBytes); err != nil {
		return fmt.Errorf("failed to store artifact blob: %w", err)
	}

	manifest := ArtifactManifest{
		ID:             manifestDigest,
		ImageCatalogID: imageCatalogID,
		SubjectDigest:  digestVal,
		MediaType:      mediaType,
		ArtifactType:   artifactType,
		ManifestSize:   manifestSize,
		Annotations:    annotations,
		AttestID:       attestID,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	// Store the manifest metadata in oci_artifact_manifest
	if err := StoreArtifactManifest(ctx, manifest); err != nil {
		return fmt.Errorf("failed to store artifact manifest metadata: %w", err)
	}
	return nil
}

// Helper to compute sha256 digest
func sha256Sum(data []byte) []byte {
	h := sha256.New()
	h.Write(data)
	return h.Sum(nil)
}

// GetArtifactManifestsBySubjectDigest fetches all artifact manifests for a given subject digest.
func GetArtifactManifestsBySubjectDigest(ctx context.Context, subjectDigest string) ([]ArtifactManifest, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT id, image_catalog_id, subject_digest, media_type, artifact_type,
		       manifest_size, annotations, attest_id, created_at, updated_at
		FROM oci_artifact_manifest
		WHERE subject_digest = $1
		ORDER BY created_at DESC
	`

	logger.Info("querying artifact manifests by subject digest", zap.String("subject_digest", subjectDigest))
	rows, err := conn.Query(ctx, query, subjectDigest)
	if err != nil {
		logger.Error(err)
		return nil, fmt.Errorf("failed to query artifact manifests: %w", err)
	}
	defer rows.Close()

	var manifests []ArtifactManifest
	for rows.Next() {
		var manifest ArtifactManifest
		var annotationsJSON []byte
		var attestID *string

		err := rows.Scan(
			&manifest.ID, &manifest.ImageCatalogID, &manifest.SubjectDigest,
			&manifest.MediaType, &manifest.ArtifactType, &manifest.ManifestSize,
			&annotationsJSON, &attestID, &manifest.CreatedAt, &manifest.UpdatedAt)
		if err != nil {
			logger.Error(err)
			return nil, fmt.Errorf("failed to scan artifact manifest: %w", err)
		}

		if err := json.Unmarshal(annotationsJSON, &manifest.Annotations); err != nil {
			logger.Warn("failed to unmarshal annotations for artifact manifest", zap.String("id", manifest.ID), zap.Error(err))
			return nil, fmt.Errorf("failed to unmarshal annotations: %w", err)
		}

		manifest.AttestID = attestID
		manifests = append(manifests, manifest)
	}

	logger.Info("fetched artifact manifests", zap.String("subject_digest", subjectDigest), zap.Int("count", len(manifests)))
	return manifests, nil
}

// GetImageIDsAndDigestsByRepo fetches all image IDs and digests for a given repository.
func GetImageIDsAndDigestsByRepo(ctx context.Context, repoName string) ([]ImageCatalogDigestInfo, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT id, digest_x86, digest_aarch64, index_digest FROM image_catalog WHERE name = $1 AND is_published = true`
	rows, err := conn.Query(ctx, query, repoName)
	if err != nil {
		return nil, fmt.Errorf("failed to query image_catalog: %w", err)
	}
	defer rows.Close()

	var results []ImageCatalogDigestInfo
	for rows.Next() {
		var info ImageCatalogDigestInfo
		if err := rows.Scan(&info.ID, &info.DigestX86, &info.DigestAarch64, &info.IndexDigest); err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		results = append(results, info)
	}
	return results, nil
}

// GetArtifactBlobByDigest fetches the manifest raw bytes and media type for a given digest from oci_artifact_blob.
func GetArtifactBlobByDigest(ctx context.Context, digest string) ([]byte, string, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `
		SELECT raw_content, media_type
		FROM oci_artifact_blob
		WHERE digest = $1
	`

	var rawContent []byte
	var mediaType string
	err := conn.QueryRow(ctx, query, digest).Scan(&rawContent, &mediaType)
	if err != nil {
		return nil, "", fmt.Errorf("artifact blob not found for digest %s: %w", digest, err)
	}

	return rawContent, mediaType, nil
}

// PatchDSSESubject updates the subject in a DSSE envelope to use the given registry host and repo.
func PatchDSSESubject(dsseBytes []byte, newRegistryHost string, repo string) ([]byte, error) {
	logger.Info("patching DSSE subject", zap.String("newRegistryHost", newRegistryHost), zap.String("repo", repo))
	type DSSEEnvelope struct {
		Payload     string `json:"payload"`
		PayloadType string `json:"payloadType"`
		Signatures  []struct {
			KeyID string `json:"keyid"`
			Sig   string `json:"sig"`
		} `json:"signatures"`
	}

	type InTotoStatement struct {
		Type          string `json:"_type"`
		PredicateType string `json:"predicateType"`
		Subject       []struct {
			Name   string            `json:"name"`
			Digest map[string]string `json:"digest"`
		} `json:"subject"`
		Predicate interface{} `json:"predicate"`
	}

	var envelope DSSEEnvelope
	if err := json.Unmarshal(dsseBytes, &envelope); err != nil {
		return nil, err
	}
	payloadBytes, err := base64.StdEncoding.DecodeString(envelope.Payload)
	if err != nil {
		return nil, err
	}
	var statement InTotoStatement
	if err := json.Unmarshal(payloadBytes, &statement); err != nil {
		return nil, err
	}
	for i := range statement.Subject {
		statement.Subject[i].Name = newRegistryHost + "/" + repo
	}
	newPayloadBytes, err := json.Marshal(statement)
	if err != nil {
		return nil, err
	}
	envelope.Payload = base64.StdEncoding.EncodeToString(newPayloadBytes)
	return json.Marshal(envelope)
}

// Helper to compare two byte slices and log the first difference
func LogManifestByteDiff(label string, a, b []byte) {
	minLen := len(a)
	if len(b) < minLen {
		minLen = len(b)
	}
	for i := 0; i < minLen; i++ {
		if a[i] != b[i] {
			logger.Warn("[DEBUG] Manifest byte mismatch", zap.String("label", label), zap.Int("index", i), zap.String("a_byte", hex.EncodeToString([]byte{a[i]})), zap.String("b_byte", hex.EncodeToString([]byte{b[i]})))
			return
		}
	}
	if len(a) != len(b) {
		logger.Warn("[DEBUG] Manifest length mismatch", zap.String("label", label), zap.Int("a_len", len(a)), zap.Int("b_len", len(b)))
	}
}

func marshalAnnotations(annotations map[string]interface{}) ([]byte, error) {
	if annotations == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(annotations)
}
