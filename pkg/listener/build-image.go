package listener

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"text/template"
	"time"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/builder"
	cosign "github.com/securebuildhq/securebuild/pkg/cosign"
	image "github.com/securebuildhq/securebuild/pkg/image"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	oci "github.com/securebuildhq/securebuild/pkg/oci"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

type BuildImagePayload struct {
	ID string `json:"id"`
}

type BuildImageWithVMAssignedPayload struct {
	VMID    string `json:"vmId"`
	BuildID string `json:"buildId"`
	WorkDir string `json:"workDir,omitempty"`
}

const (
	ArchX86_64  = "x86_64"
	ArchAarch64 = "aarch64"
)

// handleBuildImage orchestrates the full image build, push, scan, SBOM, and attestation process for a given image payload.
// High-level flow:
//  1. Parse payload and fetch image metadata
//  2. For each APKO config:
//     a. Prepare temp build directory and write apko.yaml
//     b. Build OCI image and generate SBOMs
//     c. Push image to registry and store index manifest
//     d. Attribute and read SBOMs
//     e. Scan images (main and alternate)
//     f. For each tag:
//     i.   Fetch index, store platform manifests
//     ii.  Create catalog image in DB
//     iii. Attach SBOM attestations (platform and index)
//     iv.  Generate and store signature artifacts
//     v.   Write scan results
//  3. Publish catalog images and enqueue external registry push if needed
//
// Errors are returned immediately for fatal issues; warnings are logged for non-fatal issues (e.g., manifest storage failures).
func handleBuildImage(ctx context.Context, payload string) error {
	var buildImagePayload BuildImagePayload
	if err := json.Unmarshal([]byte(payload), &buildImagePayload); err != nil {
		return fmt.Errorf("failed to unmarshal build image payload: %w", err)
	}

	logger.Info("building image", zap.String("id", buildImagePayload.ID))

	img, err := image.GetImage(ctx, buildImagePayload.ID)
	if err != nil {
		return fmt.Errorf("failed to get image: %w", err)
	}

	// Create image build records for each APKO version
	var imageBuilds []*imagetypes.ImageBuild
	for _, apko := range img.APKOs {
		imageBuild, err := image.CreateImageBuild(ctx, apko.LatestVersion.ID)
		if err != nil {
			return fmt.Errorf("failed to create image build record for APKO %s: %w", apko.ID, err)
		}

		logger.Debug("created image build record",
			zap.String("buildID", imageBuild.ID),
			zap.String("imageApkoVersionID", apko.LatestVersion.ID),
			zap.String("imageName", img.Name),
			zap.String("apkoID", apko.ID))

		// Update status to queued
		if err := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusQueued); err != nil {
			logger.Warn("failed to update image build status to queued", zap.Error(err))
		}

		imageBuilds = append(imageBuilds, imageBuild)
	}

	// Process each APKO build
	for i, apko := range img.APKOs {
		imageBuild := imageBuilds[i]

		// Assign VM for image building using the active backend
		vmID, workDir, err := assignVMForImageBuild(ctx, imageBuild.ID)
		if err != nil {
			logger.Warn("IMAGE BUILD FAILED: VM assignment failure - could not assign VM for image build",
				zap.String("imageApkoVersionID", apko.LatestVersion.ID),
				zap.String("imageName", img.Name),
				zap.String("buildID", imageBuild.ID),
				zap.String("apkoID", apko.ID),
				zap.Error(err))

			// Mark build as failed
			if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("VM assignment failure: %w", err)); statusErr != nil {
				logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
			}

			continue // Continue with other APKOs
		}

		// Update build record with VM ID
		if err := image.SetImageBuildBuilderID(ctx, imageBuild.ID, vmID); err != nil {
			logger.Warn("failed to set image build builder ID", zap.Error(err))
		}

		// Queue the image building with VM assigned
		buildImageWithVMAssignedPayload := BuildImageWithVMAssignedPayload{
			VMID:    vmID,
			BuildID: imageBuild.ID,
			WorkDir: workDir,
		}

		marshalledPayload, err := json.Marshal(buildImageWithVMAssignedPayload)
		if err != nil {
			// Mark build as failed
			if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("JSON marshalling failure: %w", err)); statusErr != nil {
				logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
			}
			continue
		}

		if err := persistence.EnqueueWork(ctx, "build_image_with_vm_assigned", string(marshalledPayload)); err != nil {
			// Mark build as failed
			if statusErr := image.UpdateImageBuildStatus(ctx, imageBuild.ID, imagetypes.ImageBuildStatusFailed, fmt.Errorf("work queue enqueue failure: %w", err)); statusErr != nil {
				logger.Warn("failed to update image build status to failed", zap.Error(statusErr))
			}
			continue
		}
	}

	return nil
}

func assignVMForImageBuild(ctx context.Context, buildID string) (string, string, error) {
	logger.Debug("assigning VM for image build",
		zap.String("buildID", buildID),
	)

	backend := buildbackend.GetBackend(ctx)
	if backend == nil {
		// Fallback: create backend from config
		var backendErr error
		backend, backendErr = buildbackend.GetActiveBackend(ctx)
		if backendErr != nil {
			logger.Warn("failed to create build backend, falling back to CMX", zap.Error(backendErr))
			backend, _ = buildbackend.NewCMXBackend(ctx)
		}
	}

	// Select architecture based on backend type
	var selectedArch string
	switch backend.Type() {
	case buildbackend.BackendCMX:
		// CMX: use existing logic to pick best arch based on pool availability
		var err error
		selectedArch, err = builder.SelectBestArchitectureForImageBuild(ctx)
		if err != nil {
			return "", "", fmt.Errorf("failed to select architecture for image build: %w", err)
		}
	default:
		// Local/Static: pick the first available architecture
		arches, err := backend.AvailableArchitectures(ctx)
		if err != nil {
			return "", "", fmt.Errorf("failed to get available architectures: %w", err)
		}
		if len(arches) == 0 {
			return "", "", fmt.Errorf("no architectures available for image build")
		}
		selectedArch = arches[0]
	}

	logger.Debug("selected architecture for image build",
		zap.String("buildID", buildID),
		zap.String("architecture", selectedArch))

	machine, err := backend.AcquireBuildMachine(ctx, buildbackend.AcquireOptions{
		Architecture: selectedArch,
		TaskType:     "build_image",
		TaskID:       buildID,
	})
	if err != nil {
		return "", "", fmt.Errorf("failed to acquire %s machine for image build: %w", selectedArch, err)
	}

	return machine.ID, machine.WorkDir, nil
}

// getAlternateImageRef checks if the alternate image:tag exists and returns its reference string if it does, or an empty string otherwise.
func getAlternateImageRef(ctx context.Context, alternateImage, tag string) (string, error) {
	if alternateImage == "" {
		return "", nil
	}
	ref := fmt.Sprintf("%s:%s", alternateImage, tag)
	exists, err := image.AlternateImageExists(ctx, ref)
	if err != nil {
		return "", fmt.Errorf("failed to check if alternate image tag exists: %w", err)
	}
	if exists {
		return ref, nil
	}
	logger.Debug("alternate image tag does not exist, skipping alternate scan", zap.String("alternate_image", alternateImage), zap.String("tag", tag))
	return "", nil
}

// Helper to extract manifest info from either v1.Manifest or legacy map[string]interface{}
func parseManifestInfo(manifest interface{}, sigRef string) (subjectDigest, artifactType, mediaType string, annotations map[string]interface{}) {
	annotations = make(map[string]interface{})

	switch m := manifest.(type) {
	case *v1.Manifest:
		if m.Subject != nil {
			subjectDigest = m.Subject.Digest.String()
		}
		mediaType = string(m.MediaType)
		if m.Annotations != nil {
			for k, v := range m.Annotations {
				annotations[k] = v
			}
		}
		// v1.Manifest doesn't have ArtifactType, will use fallback below
	case map[string]interface{}:
		// Remove 'layers' field if present
		delete(m, "layers")
		if subj, ok := m["subject"].(map[string]interface{}); ok {
			if digest, ok := subj["digest"].(string); ok {
				subjectDigest = digest
			}
		}
		mediaType = safeString(m["mediaType"])
		if ann, ok := m["annotations"].(map[string]interface{}); ok {
			annotations = ann
		}
		artifactType = safeString(m["artifactType"])
	}

	// Fallback logic for subject digest (regex from tag)
	if subjectDigest == "" {
		if idx := strings.LastIndex(sigRef, ":"); idx != -1 {
			tagPart := sigRef[idx+1:]
			re := regexp.MustCompile(`sha256-([a-f0-9]{64})\.(sig|att)$`)
			if matches := re.FindStringSubmatch(tagPart); len(matches) == 3 {
				subjectDigest = "sha256:" + matches[1]
			}
		}
	}

	// Fallback logic for artifact type
	if artifactType == "" {
		// Check for legacy cosign signature by layer media type
		switch m := manifest.(type) {
		case *v1.Manifest:
			if len(m.Layers) > 0 && string(m.Layers[0].MediaType) == "application/vnd.dev.cosign.simplesigning.v1+json" {
				artifactType = "application/vnd.dev.cosign.simplesigning.v1+json"
			}
		case map[string]interface{}:
			if layers, ok := m["layers"].([]interface{}); ok && len(layers) > 0 {
				if layer, ok := layers[0].(map[string]interface{}); ok {
					if layerMediaType := safeString(layer["mediaType"]); layerMediaType == "application/vnd.dev.cosign.simplesigning.v1+json" {
						artifactType = "application/vnd.dev.cosign.simplesigning.v1+json"
					}
				}
			}
		}
		// If still empty, fall back based on file extension
		if artifactType == "" {
			if strings.HasSuffix(sigRef, ".sig") {
				artifactType = "application/vnd.dev.cosign.simplesigning.v1+json"
			} else if strings.HasSuffix(sigRef, ".att") {
				artifactType = "application/vnd.in-toto+json"
			}
		}
	}

	return subjectDigest, artifactType, mediaType, annotations
}

// attachSBOMAttestations attaches SBOM attestations to a given digestRef using cosign, and returns any created artifact manifests.
// Steps:
//  1. Write cosign key to temp file (handled by caller)
//  2. Check for multi-arch SBOM (index-level); if not present, use per-arch SBOMs
//  3. For each SBOM:
//     a. Add SecureBuild attribution
//     b. Attest SBOM to digestRef using cosign
//     c. Log success or error
//  4. Return any created artifact manifests (currently unused, but may be extended)
func attachSBOMAttestations(ctx context.Context, imageCatalogID string, tmpDir string, digestRef string, tags []string) ([]oci.ArtifactManifest, error) {
	logger.Debug("[DEBUG] attachSBOMAttestations called", zap.String("imageCatalogID", imageCatalogID), zap.String("digestRef", digestRef))
	var manifests []oci.ArtifactManifest
	privateKeyPath := filepath.Join(tmpDir, "cosign.key")
	decodedPrivateKey, err := base64.StdEncoding.DecodeString(param.GetParam(ctx).CosignKey)
	if err != nil {
		return nil, fmt.Errorf("failed to decode cosign key: %w", err)
	}
	if err := os.WriteFile(privateKeyPath, decodedPrivateKey, 0600); err != nil {
		return nil, fmt.Errorf("failed to write cosign key: %w", err)
	}
	defer func() {
		if err := cosign.SecurelyDeleteFile(privateKeyPath); err != nil {
			logger.Warn("failed to securely delete cosign key", zap.String("path", privateKeyPath), zap.Error(err))
		}
	}()

	// Read the multi-arch SBOM (index SBOM covers both architectures)
	sbomIndexPath := filepath.Join(tmpDir, "sbom-index.spdx.json")
	sbomIndexExists := true
	if _, err := os.Stat(sbomIndexPath); os.IsNotExist(err) {
		sbomIndexExists = false
		logger.Debug("sbom-index.spdx.json not found, will use architecture-specific SBOMs")
	}

	attestSBOM := func(predicatePath, sbomLabel string) error {
		if err := cosign.CosignAttestWithCustomSubject(ctx, predicatePath, sbomLabel, digestRef, privateKeyPath, imageCatalogID); err != nil {
			return fmt.Errorf("failed to attach %s SBOM attestation to %s: %w", sbomLabel, digestRef, err)
		}
		logger.Debug("successfully attached SBOM attestation", zap.String("ref", digestRef), zap.String("sbom", sbomLabel))

		return nil
	}

	if sbomIndexExists {
		// Create a modified SBOM with SecureBuild attribution
		modifiedSBOMPath := filepath.Join(tmpDir, "sbom-index-with-securebuild.spdx.json")
		if err := addSecureBuildToSBOM(sbomIndexPath, modifiedSBOMPath); err != nil {
			logger.Warn("failed to add SecureBuild attribution, using original SBOM", zap.Error(err))
			modifiedSBOMPath = sbomIndexPath
		}
		if err := attestSBOM(modifiedSBOMPath, "index"); err != nil {
			return manifests, err
		}
	} else {
		sbomFiles := []struct {
			path string
			arch string
		}{
			{filepath.Join(tmpDir, "sbom-"+ArchX86_64+".spdx.json"), ArchX86_64},
			{filepath.Join(tmpDir, "sbom-"+ArchAarch64+".spdx.json"), ArchAarch64},
		}
		for _, sbomFile := range sbomFiles {
			if _, err := os.Stat(sbomFile.path); os.IsNotExist(err) {
				logger.Warn("SBOM file not found", zap.String("path", sbomFile.path))
				continue
			}

			// Create modified SBOM with SecureBuild attribution
			modifiedSBOMPath := filepath.Join(tmpDir, fmt.Sprintf("sbom-%s-with-securebuild.spdx.json", sbomFile.arch))
			if err := addSecureBuildToSBOM(sbomFile.path, modifiedSBOMPath); err != nil {
				logger.Warn("failed to add SecureBuild attribution, using original SBOM", zap.Error(err))
				modifiedSBOMPath = sbomFile.path
			}
			if err := attestSBOM(modifiedSBOMPath, sbomFile.arch); err != nil {
				return manifests, err
			}
		}
	}
	return manifests, nil
}

// attachAndStoreSBOMAttestations calls attachSBOMAttestations and stores the returned manifests in the DB, logging appropriately.
func attachAndStoreSBOMAttestations(ctx context.Context, imageCatalogID, tmpDir, digestRef string, tags []string, scope string) {
	manifests, err := attachSBOMAttestations(ctx, imageCatalogID, tmpDir, digestRef, tags)
	if err != nil {
		logger.Warn("failed to attach SBOM attestation", zap.String("scope", scope), zap.String("digestRef", digestRef), zap.Error(err))
		return
	}
	for _, artifactManifest := range manifests {
		if err := oci.StoreArtifactManifest(ctx, artifactManifest); err != nil {
			logger.Warn("failed to store SBOM artifact manifest in DB", zap.String("scope", scope), zap.String("sbomRef", artifactManifest.ID))
		}
		logger.Debug("SBOM artifact manifest created and stored",
			zap.String("scope", scope),
			zap.String("artifactID", artifactManifest.ID),
			zap.String("subjectDigest", artifactManifest.SubjectDigest),
			zap.String("imageCatalogID", artifactManifest.ImageCatalogID))
	}
}

func executeTemplate(tag string, packages []imagetypes.APKPackageVersion) (string, error) {
	// If it's just "latest", return as-is
	if tag == "latest" {
		return "latest", nil
	}

	// Create a map of packages for easy lookup
	packageMap := make(map[string]imagetypes.APKPackageVersion)
	for _, pkg := range packages {
		packageMap[pkg.Name] = pkg
	}

	// Create template with custom functions
	tmpl := template.New("tag").Funcs(template.FuncMap{
		"semver": func(component string, pkg imagetypes.APKPackageVersion) string {
			switch component {
			case "major":
				return pkg.Major
			case "minor":
				return pkg.Minor
			case "patch":
				return pkg.Patch
			case "version":
				return pkg.Version
			case "release":
				return pkg.Release
			default:
				return ""
			}
		},
	})

	// Parse the template
	tmpl, err := tmpl.Parse(tag)
	if err != nil {
		return "", fmt.Errorf("failed to parse template: %w", err)
	}

	// Create template data
	data := struct {
		Packages map[string]imagetypes.APKPackageVersion
	}{
		Packages: packageMap,
	}

	// Execute template
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("failed to execute template: %w", err)
	}

	return buf.String(), nil
}

// addSecureBuildToSBOM adds SecureBuild attribution to the SBOM at the given path and writes the modified SBOM to a new path.
func addSecureBuildToSBOM(originalSBOMPath, modifiedSBOMPath string) error {
	logger.Debug("modifying SBOM", zap.String("original", originalSBOMPath), zap.String("modified", modifiedSBOMPath))

	// Read the original SBOM
	sbomData, err := os.ReadFile(originalSBOMPath)
	if err != nil {
		return fmt.Errorf("failed to read original SBOM: %w", err)
	}

	var sbom map[string]interface{}
	if err := json.Unmarshal(sbomData, &sbom); err != nil {
		return fmt.Errorf("failed to unmarshal SBOM: %w", err)
	}

	logger.Debug("original SBOM structure", zap.Any("sbom_keys", getKeys(sbom)))

	// Add SecureBuild to the creators field if it exists
	if creationInfo, ok := sbom["creationInfo"].(map[string]interface{}); ok {
		logger.Debug("found creationInfo", zap.Any("creationInfo_keys", getKeys(creationInfo)))

		// Replace creators entirely with Replicated/SecureBuild
		newCreators := []interface{}{
			"Organization: Replicated, Inc.",
			"Tool: SecureBuild",
		}

		if _, ok := creationInfo["creators"].([]interface{}); ok {
			logger.Debug("found existing creators, replacing with Replicated/SecureBuild creators")
		} else {
			logger.Debug("no existing creators found, creating new creators field")
		}

		creationInfo["creators"] = newCreators
		logger.Debug("set creators", zap.Any("new_creators", newCreators))
	} else {
		// If no creationInfo exists, create it with Replicated/SecureBuild
		sbom["creationInfo"] = map[string]interface{}{
			"creators": []interface{}{
				"Organization: Replicated, Inc.",
				"Tool: SecureBuild",
			},
		}
		logger.Debug("created new creationInfo with Replicated/SecureBuild creators")
	}

	// Write the modified SBOM
	modifiedSBOMData, err := json.MarshalIndent(sbom, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal modified SBOM: %w", err)
	}

	if err := os.WriteFile(modifiedSBOMPath, modifiedSBOMData, 0644); err != nil {
		return fmt.Errorf("failed to write modified SBOM: %w", err)
	}

	// DEBUG: Log first/last character and first 100 bytes of the file
	fileBytes, err := os.ReadFile(modifiedSBOMPath)
	if err != nil {
		logger.Warn("failed to read back modified SBOM for debug", zap.String("path", modifiedSBOMPath), zap.Error(err))
	} else {
		firstChar := string(fileBytes[0])
		lastChar := string(fileBytes[len(fileBytes)-1])
		preview := string(fileBytes)
		if len(fileBytes) > 100 {
			preview = string(fileBytes[:100]) + "..."
		}
		logger.Debug("Modified SBOM file written", zap.String("path", modifiedSBOMPath), zap.Int("size", len(fileBytes)), zap.String("firstChar", firstChar), zap.String("lastChar", lastChar), zap.String("preview", preview))
	}

	logger.Debug("successfully wrote modified SBOM", zap.String("path", modifiedSBOMPath))
	return nil
}

// attributeSBOMs adds SecureBuild attribution to SBOMs for the given architectures and returns a map of arch to attributed SBOM file path.
func attributeSBOMs(tmpDir string, arches []string) (map[string]string, error) {
	attributedSBOMs := make(map[string]string)
	for _, arch := range arches {
		sbomPath := filepath.Join(tmpDir, fmt.Sprintf("sbom-%s.spdx.json", arch))
		outPath := filepath.Join(tmpDir, fmt.Sprintf("sbom-%s-with-securebuild.spdx.json", arch))
		if err := addSecureBuildToSBOM(sbomPath, outPath); err != nil {
			return nil, fmt.Errorf("failed to add SecureBuild attribution to %s SBOM: %w", arch, err)
		}
		attributedSBOMs[arch] = outPath
	}
	return attributedSBOMs, nil
}

// readAttributedSBOMs reads the attributed SBOM files for each architecture and returns a map of arch to SBOM bytes.
func readAttributedSBOMs(attributedSBOMs map[string]string) (map[string][]byte, error) {
	sboms := make(map[string][]byte)
	for arch, path := range attributedSBOMs {
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("failed to read attributed %s SBOM: %w", arch, err)
		}
		sboms[arch] = data
	}
	return sboms, nil
}

// Helper function to get keys from a map for debugging
func getKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// generateImageArtifacts signs the image in the registry for each tag and fetches the signature artifact manifest
func generateImageArtifacts(ctx context.Context, imageCatalogID string, tmpDir string, digestRef string, tags []string) ([]oci.ArtifactManifest, error) {
	var manifests []oci.ArtifactManifest

	// Sign the image in the registry using digestRef
	logger.Debug("signing image in registry with cosign", zap.String("ref", digestRef))
	cosign.CosignSignWithKey(ctx, digestRef, param.GetParam(ctx).CosignKey, param.GetParam(ctx).CosignPassword, param.GetParam(ctx).RegistryUsername, param.GetParam(ctx).RegistryPassword)

	// After signing, fetch the signature artifact manifest and log its values
	// Use cosign triangulate to get the signature digest or tag
	sigRefRaw, err := cosign.CosignTriangulate(ctx, digestRef, "signature")
	if err != nil {
		logger.Error(err)
		logger.Warn("failed to triangulate signature digest", zap.String("ref", digestRef))
		return manifests, nil
	}
	logger.Debug("cosign triangulate raw output", zap.String("sigRefRaw", string(sigRefRaw)))
	sigRef := string(bytes.TrimSpace([]byte(sigRefRaw)))
	logger.Debug("cosign signature reference (parsed)", zap.String("sigRef", sigRef))

	importedRef, err := parseSignatureReference(sigRef, digestRef)
	if err != nil {
		return manifests, nil
	}

	auth := authn.FromConfig(authn.AuthConfig{
		Username: param.GetParam(ctx).RegistryUsername,
		Password: param.GetParam(ctx).RegistryPassword,
	})
	manifestDesc, err := remote.Get(importedRef, remote.WithAuth(auth), remote.WithContext(ctx))
	if err != nil {
		logger.Error(err)
		logger.Warn("failed to fetch signature manifest from registry", zap.String("ref", digestRef), zap.String("sigRef", sigRef))
		return manifests, nil
	}
	// Log the manifest bytes (truncated to 500 chars for debug)
	manifestStr := string(manifestDesc.Manifest)
	if len(manifestStr) > 500 {
		manifestStr = manifestStr[:500] + "... (truncated)"
	}
	logger.Debug("fetched signature manifest JSON", zap.String("manifest", manifestStr))

	// Parse the manifest as JSON
	var manifest v1.Manifest
	var manifestPtr interface{} = &manifest
	if err := json.Unmarshal(manifestDesc.Manifest, &manifest); err != nil {
		// fallback to legacy
		var legacyManifest map[string]interface{}
		if err := json.Unmarshal(manifestDesc.Manifest, &legacyManifest); err != nil {
			logger.Error(err)
			logger.Warn("failed to unmarshal signature manifest as both v1.Manifest and legacy map", zap.String("sigRef", sigRef))
			return manifests, nil
		}
		manifestPtr = legacyManifest
	}

	subjectDigest, artifactType, mediaType, annotations := parseManifestInfo(manifestPtr, sigRef)
	if subjectDigest == "" {
		logger.Warn("could not extract subject digest from manifest", zap.String("sigRef", sigRef))
		return manifests, nil
	}

	var imageID string
	if subjectDigest != "" {
		imageID, err = image.GetImageIDByDigest(ctx, subjectDigest)
		if err != nil || imageID == "" {
			if err != nil {
				logger.Error(err)
			}
			logger.Warn("could not find image for subject digest", zap.String("subject_digest", subjectDigest))
			return manifests, nil
		}
	} else {
		logger.Warn("could not extract subject digest from signature reference", zap.String("sigRef", sigRef))
		return manifests, nil
	}

	artifactID := manifestDesc.Digest.String()
	artifactManifest := oci.ArtifactManifest{
		ID:             artifactID,
		ImageCatalogID: imageCatalogID,
		SubjectDigest:  subjectDigest,
		MediaType:      mediaType,
		ArtifactType:   artifactType,
		ManifestSize:   int64(len(manifestDesc.Manifest)),
		Annotations:    annotations,
		AttestID:       nil, // Use nil for signatures and non-attestation artifacts
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	manifests = append(manifests, artifactManifest)

	// --- Generate and store OCI artifact manifest locally if attestation ---
	if artifactType == "application/vnd.in-toto+json" {
		// Store the exact manifest bytes as fetched from the registry
		logger.Debug("[DEBUG] StoreFullArtifactManifest (attestation)",
			zap.String("imageCatalogID", imageCatalogID),
			zap.String("subjectDigest", subjectDigest),
			zap.String("artifactType", artifactType))
		err = oci.StoreFullArtifactManifest(ctx, manifestDesc.Manifest, imageCatalogID, nil)
		if err != nil {
			logger.Warn("failed to store full OCI artifact manifest in DB", zap.Error(err))
		} else {
			logger.Debug("stored full OCI artifact manifest in DB")
		}
	}
	// --- END NEW ---
	return manifests, nil
}

// Helper to preserve the exact parsing logic for signature reference
func parseSignatureReference(sigRef, digestRef string) (name.Reference, error) {
	ref, err := name.ParseReference(sigRef)
	if err != nil {
		logger.Error(err)
		logger.Warn("failed to parse signature reference", zap.String("sigRef", sigRef))
		return nil, err
	}
	return ref, nil
}

// Helper to extract artifact ID (preserves logic)
func extractArtifactID(sigRef string) string {
	ref, err := name.ParseReference(sigRef)
	if err != nil {
		return sigRef // fallback to original string if parsing fails
	}
	switch r := ref.(type) {
	case name.Tag:
		return r.TagStr()
	case name.Digest:
		return r.DigestStr()
	default:
		return sigRef
	}
}

// Helper to safely extract string from interface
func safeString(val interface{}) string {
	if v, ok := val.(string); ok {
		return v
	}
	return ""
}

// Helper to calculate SHA256 hash of a byte slice
func sha256Sum(data []byte) []byte {
	hash := sha256.Sum256(data)
	return hash[:]
}

// storePlatformManifests stores platform manifests in the database for each architecture and returns sizes and digests for amd64 and arm64.
func storePlatformManifests(ctx context.Context, imageIndex v1.ImageIndex) (x86Size, aarch64Size int64, x86Digest, aarch64Digest string, err error) {
	manifest, err := imageIndex.IndexManifest()
	if err != nil {
		return 0, 0, "", "", fmt.Errorf("failed to get index manifest: %w", err)
	}
	for _, manifestDesc := range manifest.Manifests {
		if manifestDesc.Platform != nil {
			img, err := imageIndex.Image(manifestDesc.Digest)
			if err != nil {
				logger.Warn("failed to get image for platform",
					zap.String("arch", manifestDesc.Platform.Architecture),
					zap.Error(err))
				continue
			}
			imgManifest, err := img.Manifest()
			if err != nil {
				logger.Warn("failed to get image manifest for platform",
					zap.String("arch", manifestDesc.Platform.Architecture),
					zap.Error(err))
				continue
			}
			manifestBytes, err := img.RawManifest()
			if err != nil {
				logger.Warn("failed to get raw manifest bytes for platform",
					zap.String("arch", manifestDesc.Platform.Architecture),
					zap.Error(err))
			} else {
				manifestDigest := manifestDesc.Digest.String()
				mediaType := string(imgManifest.MediaType)
				if err := oci.StoreArtifactBlob(ctx, manifestDigest, mediaType, manifestBytes); err != nil {
					logger.Warn("failed to store platform manifest in oci_artifact_blob",
						zap.String("digest", manifestDigest),
						zap.Error(err))
				} else {
					logger.Debug("stored platform manifest in oci_artifact_blob",
						zap.String("digest", manifestDigest),
						zap.String("arch", manifestDesc.Platform.Architecture))
				}
			}

			// Calculate total compressed size (what we store/transmit)
			var compressedSize int64
			for _, layer := range imgManifest.Layers {
				compressedSize += layer.Size
			}
			// Add config size
			compressedSize += imgManifest.Config.Size

			// Try to calculate uncompressed size (what Docker shows)
			var uncompressedSize int64
			layers, err := img.Layers()
			if err != nil {
				logger.Warn("failed to get layers for uncompressed size calculation", zap.Error(err))
				uncompressedSize = compressedSize // fallback to compressed size
			} else {
				for _, layer := range layers {
					layerSize, err := layer.Size()
					if err != nil {
						logger.Warn("failed to get layer size", zap.Error(err))
						continue
					}
					uncompressedSize += layerSize
				}
			}

			// Get the image digest (this is what docker pull shows)
			imgDigest, err := img.Digest()
			if err != nil {
				logger.Warn("failed to get image digest for platform",
					zap.String("arch", manifestDesc.Platform.Architecture),
					zap.Error(err))
				continue
			}

			switch manifestDesc.Platform.Architecture {
			case "amd64":
				x86Size = uncompressedSize // Use uncompressed to match Docker
				x86Digest = imgDigest.String()
			case "arm64":
				aarch64Size = uncompressedSize // Use uncompressed to match Docker
				aarch64Digest = imgDigest.String()
			}
		}
	}
	return x86Size, aarch64Size, x86Digest, aarch64Digest, nil
}
