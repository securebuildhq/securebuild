package ociproxy

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	ocidigest "github.com/opencontainers/go-digest"
	specs "github.com/opencontainers/image-spec/specs-go"
	ociv1 "github.com/opencontainers/image-spec/specs-go/v1"
	"github.com/securebuildhq/securebuild/pkg/oci"
)

// Referrers API Types and Constants
//
// We use ociv1.Index and ociv1.Descriptor directly for the referrers response and descriptors,
// as per the OCI Image Spec Go types (github.com/opencontainers/image-spec/specs-go/v1).
//
// Query parameters for the referrers API are parsed into ReferrersQuery below.
// ---

type ReferrersQuery struct {
	ArtifactType string `form:"artifactType" binding:"omitempty"`
	N            int    `form:"n" binding:"omitempty,min=1"`   // not implemented yet
	NextToken    string `form:"nextToken" binding:"omitempty"` // not implemented yet
}

const (
	MediaTypeImageIndex       = "application/vnd.oci.image.index.v1+json"
	MediaTypeImageManifest    = "application/vnd.oci.image.manifest.v1+json"
	MediaTypeArtifactManifest = "application/vnd.oci.artifact.manifest.v1+json"

	HeaderOCISubject        = "OCI-Subject"
	HeaderOCIFiltersApplied = "OCI-Filters-Applied"
	HeaderContentType       = "Content-Type"
)

func (p *OCIProxy) handleReferrers(c *gin.Context, repository, digest string) {
	proxyLogger.Infow("handleReferrers called", "repository", repository, "digest", digest)
	// Validate repo name and digest
	if err := validateOCIRepositoryName(repository); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	_, err := ocidigest.Parse(digest)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid digest"})
		return
	}

	ctx := c.Request.Context()

	// Step 1: Get all images for the repo
	repoImages, err := oci.GetImageIDsAndDigestsByRepo(ctx, repository)
	if err != nil {
		proxyLogger.Errorw("DB error fetching images for repo", "err", err)
		c.Status(http.StatusInternalServerError)
		return
	}
	proxyLogger.Infow("Repo images fetched for repository", "repository", repository, "repoImages", repoImages)
	if len(repoImages) == 0 {
		// Repo does not exist: return empty manifests array, 200 OK
		proxyLogger.Infow("Repo does not exist: returning empty manifests array", "repository", repository)
		index := ociv1.Index{
			Versioned: specs.Versioned{SchemaVersion: 2},
			MediaType: MediaTypeImageIndex,
			Manifests: []ociv1.Descriptor{},
		}
		c.Header("OCI-Subject-Referrers-Support", "true")
		c.Header("Content-Type", MediaTypeImageIndex)
		c.JSON(http.StatusOK, index)
		return
	}

	// Step 2: Collect all digests for these images
	digestBelongsToRepo := false
	imageIDsForDigest := make(map[string]struct{})
	for _, info := range repoImages {
		for _, d := range []string{info.DigestX86, info.DigestAarch64, info.IndexDigest} {
			if d == digest {
				digestBelongsToRepo = true
				imageIDsForDigest[info.ID] = struct{}{}
			}
		}
	}
	proxyLogger.Infow("imageIDsForDigest set built", "digest", digest, "imageIDsForDigest", imageIDsForDigest)

	if !digestBelongsToRepo {
		// Digest does not belong to this repo: return empty manifests array per OCI spec
		proxyLogger.Infow("Digest does not belong to this repo: returning empty manifests array", "digest", digest)
		index := ociv1.Index{
			Versioned: specs.Versioned{SchemaVersion: 2},
			MediaType: MediaTypeImageIndex,
			Manifests: []ociv1.Descriptor{},
		}
		c.Header("OCI-Subject-Referrers-Support", "true")
		c.Header("Content-Type", MediaTypeImageIndex)
		c.JSON(http.StatusOK, index)
		return
	}

	// Step 3: Fetch artifact manifests for this digest, but only for images in this repo
	manifests, err := oci.GetArtifactManifestsBySubjectDigest(ctx, digest)
	if err != nil {
		proxyLogger.Errorw("DB error querying referrers", "err", err)
		c.Status(http.StatusInternalServerError)
		return
	}

	proxyLogger.Infow("DB returned artifact manifests for digest", "digest", digest, "count", len(manifests))
	for _, m := range manifests {
		proxyLogger.Infow("ArtifactManifest from DB", "ID", m.ID, "ImageCatalogID", m.ImageCatalogID, "MediaType", m.MediaType, "ArtifactType", m.ArtifactType, "Size", m.ManifestSize)
	}

	// Filter manifests to only those whose ImageCatalogID is in imageIDsForDigest
	filteredManifests := make([]ociv1.Descriptor, 0, len(manifests))
	for _, m := range manifests {
		if _, ok := imageIDsForDigest[m.ImageCatalogID]; !ok {
			proxyLogger.Debugw("Skipping artifact manifest: ImageCatalogID not in repo image IDs", "ID", m.ID, "ImageCatalogID", m.ImageCatalogID)
			continue
		}
		proxyLogger.Debugw("Including artifact manifest: ImageCatalogID in repo image IDs", "ID", m.ID, "ImageCatalogID", m.ImageCatalogID)
		// Convert annotations to map[string]string if possible
		var annotations map[string]string
		if m.Annotations != nil {
			annotations = make(map[string]string)
			for k, v := range m.Annotations {
				if str, ok := v.(string); ok {
					annotations[k] = str
				} else {
					annotations[k] = ""
				}
			}
		}

		descriptorMediaType := m.MediaType
		descriptorDigest := m.ID
		descriptorSize := m.ManifestSize

		// Advertise old artifact manifests as OCI image manifests so cosign can parse them.
		// The actual conversion happens on the fly in serveArtifactManifestFromDB when
		// the client fetches the manifest by its original digest.
		if m.MediaType == oci.MediaTypeArtifactManifest {
			descriptorMediaType = oci.MediaTypeOCIManifest
		}

		d := ociv1.Descriptor{
			MediaType:    descriptorMediaType,
			Digest:       ocidigest.Digest(descriptorDigest),
			Size:         descriptorSize,
			ArtifactType: m.ArtifactType,
			Annotations:  annotations,
		}
		filteredManifests = append(filteredManifests, d)
	}

	proxyLogger.Infow("Final filtered manifests array", "count", len(filteredManifests))

	index := ociv1.Index{
		Versioned: specs.Versioned{SchemaVersion: 2},
		MediaType: MediaTypeImageIndex,
		Manifests: filteredManifests,
	}

	proxyLogger.Infow("About to send referrers response", "index", index)

	c.Header("OCI-Subject-Referrers-Support", "true")
	c.Header("Content-Type", MediaTypeImageIndex)
	c.JSON(http.StatusOK, index)
}

// validateOCIRepositoryName ensures the repository name complies with the OCI/Docker registry specification.
//
// According to the Docker Registry v2 and OCI Distribution Spec:
//   - A repository name is broken up into path components separated by '/'.
//   - Each component must match: [a-z0-9]+(?:[._-][a-z0-9]+)*
//     That is, one or more lowercase letters or digits, optionally separated by periods, dashes, or underscores.
//   - Allowed characters in each component: lowercase letters (a-z), digits (0-9), dot (.), underscore (_), dash (-)
//   - No uppercase letters or other symbols are allowed.
//   - No empty segments, no leading/trailing or consecutive slashes.
//   - Total length must be <256 characters.
//
// References:
//   - https://forums.docker.com/t/docker-registry-v2-spec-and-repository-naming-rule/5466
//   - https://github.com/opencontainers/distribution-spec/blob/main/spec.md
//
// This function enforces these rules for security and spec compliance.
func validateOCIRepositoryName(name string) error {
	proxyLogger.Infow("validateOCIRepositoryName called", "name", name)
	if name == "" {
		return errors.New("repository name is empty")
	}
	if strings.Contains(name, "..") {
		return errors.New("repository name contains path traversal")
	}
	if strings.HasPrefix(name, "/") || strings.HasSuffix(name, "/") {
		return errors.New("repository name must not start or end with a slash")
	}
	if strings.Contains(name, "//") {
		return errors.New("repository name must not contain consecutive slashes")
	}
	segments := strings.Split(name, "/")
	if len(segments) > 128 {
		return errors.New("repository name has too many segments")
	}
	for _, seg := range segments {
		if seg == "" {
			return errors.New("repository name contains empty segment")
		}
		if len(seg) > 255 {
			return errors.New("repository name segment too long")
		}
		for _, r := range seg {
			// Only allow lowercase letters, digits, dots, underscores, and hyphens
			if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-') {
				return errors.New("repository name contains invalid character: " + string(r))
			}
			if r < 32 || r == 127 {
				return errors.New("repository name contains control characters")
			}
		}
	}
	return nil
}
