package listener

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/securebuildhq/securebuild/pkg/image"
	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/registry"
	"go.uber.org/zap"
)

type PushImageToExternalRegistryPayload struct {
	ImageCatalogIDs []string `json:"imageCatalogIds"`
	RegistryIDs     []string `json:"registryIds"`
}

func handlePushImageToExternalRegistry(ctx context.Context, payload string) error {
	logger.Info("pushing image to external registry", zap.String("payload", payload))

	var pie PushImageToExternalRegistryPayload
	if err := json.Unmarshal([]byte(payload), &pie); err != nil {
		return fmt.Errorf("failed to unmarshal push image to external registry payload: %w", err)
	}

	externalRegistries := []imagetypes.ImageExternalRegistry{}
	for _, registryID := range pie.RegistryIDs {
		externalRegistry, err := image.GetImageExternalRegistry(ctx, registryID)
		if err != nil {
			return fmt.Errorf("failed to get image external registry: %w", err)
		}

		externalRegistries = append(externalRegistries, *externalRegistry)
	}

	for _, imageCatalogID := range pie.ImageCatalogIDs {
		imageCatalogItem, err := image.GetImageCatalogItem(ctx, imageCatalogID)
		if err != nil {
			return fmt.Errorf("failed to get image catalog item: %w", err)
		}

		// if the item is not published, skip it
		if !imageCatalogItem.IsPublished {
			continue
		}

		// if the item is published, push it to the external registry
		for _, externalRegistry := range externalRegistries {
			if err := copyImageToExternalRegistry(ctx, imageCatalogItem, &externalRegistry); err != nil {
				return fmt.Errorf("failed to copy image to external registry: %w", err)
			}
		}
	}

	return nil
}

func copyImageToExternalRegistry(ctx context.Context, imageCatalogItem *imagetypes.ImageCatalogItem, externalRegistry *imagetypes.ImageExternalRegistry) error {
	// Construct the source image reference
	sourcePath := registry.ImageRefWithTag(param.GetParam(ctx).RegistryImagePrefix, imageCatalogItem.Name, imageCatalogItem.Tag)

	// Construct the destination image reference
	// The registry URL already contains the full image path, just append the tag
	destImagePath := externalRegistry.RegistryURL
	// Remove protocol if present
	if len(destImagePath) >= 8 && destImagePath[:8] == "https://" {
		destImagePath = destImagePath[8:]
	} else if len(destImagePath) >= 7 && destImagePath[:7] == "http://" {
		destImagePath = destImagePath[7:]
	}

	destPath := fmt.Sprintf("%s:%s", destImagePath, imageCatalogItem.Tag)

	logger.Info("copying multi-arch image to external registry",
		zap.String("source", sourcePath),
		zap.String("destination", destPath),
		zap.String("registryID", externalRegistry.ID))

	// Parse source and destination references
	srcRef, err := name.ParseReference(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to parse source reference %s: %w", sourcePath, err)
	}

	destRef, err := name.ParseReference(destPath)
	if err != nil {
		return fmt.Errorf("failed to parse destination reference %s: %w", destPath, err)
	}

	// Set up authentication for source registry (SecureBuild/Replicated)
	sourceAuth := authn.FromConfig(authn.AuthConfig{
		Username: param.GetParam(ctx).RegistryUsername,
		Password: param.GetParam(ctx).RegistryPassword,
	})

	// Set up authentication for destination registry
	destAuth := authn.FromConfig(authn.AuthConfig{
		Username: externalRegistry.Username,
		Password: externalRegistry.Password,
	})

	// Read the multi-arch image index from source
	imageIndex, err := remote.Index(srcRef, remote.WithAuth(sourceAuth), remote.WithContext(ctx))
	if err != nil {
		return fmt.Errorf("failed to read image index from source %s: %w", sourcePath, err)
	}

	// Push the multi-arch image index to destination registry
	logger.Info("pushing multi-arch image index to external registry", zap.String("destination", destPath))
	if err := remote.WriteIndex(destRef, imageIndex, remote.WithAuth(destAuth), remote.WithContext(ctx)); err != nil {
		return fmt.Errorf("failed to push image index to destination %s: %w", destPath, err)
	}

	logger.Info("successfully copied multi-arch image to external registry",
		zap.String("source", sourcePath),
		zap.String("destination", destPath))

	// Copy SBOM attestations using go-containerregistry
	if err := copyImageAttestations(ctx, sourcePath, destPath, sourceAuth, destAuth); err != nil {
		// Log warning but don't fail the entire operation if attestation copy fails
		logger.Warn("failed to copy SBOM attestations",
			zap.String("source", sourcePath),
			zap.String("destination", destPath),
			zap.Error(err))
	}

	return nil
}

func copyImageAttestations(ctx context.Context, sourcePath, destPath string, sourceAuth, destAuth authn.Authenticator) error {

	// Parse source and destination references
	srcRef, err := name.ParseReference(sourcePath)
	if err != nil {
		return fmt.Errorf("failed to parse source reference: %w", err)
	}

	destRef, err := name.ParseReference(destPath)
	if err != nil {
		return fmt.Errorf("failed to parse destination reference: %w", err)
	}

	// Get the image index from source (this includes all manifests and artifacts)
	imageIndex, err := remote.Index(srcRef, remote.WithAuth(sourceAuth), remote.WithContext(ctx))
	if err != nil {
		// If it's not a multi-arch index, try as a single image
		image, err := remote.Image(srcRef, remote.WithAuth(sourceAuth), remote.WithContext(ctx))
		if err != nil {
			return fmt.Errorf("failed to read image from source %s: %w", sourcePath, err)
		}

		// Copy the single image to destination
		if err := remote.Write(destRef, image, remote.WithAuth(destAuth), remote.WithContext(ctx)); err != nil {
			return fmt.Errorf("failed to write image to destination %s: %w", destPath, err)
		}

		logger.Info("successfully copied single image with attestations",
			zap.String("source", sourcePath),
			zap.String("destination", destPath))
		return nil
	}

	// Get the index manifest to understand what we're dealing with
	indexManifest, err := imageIndex.IndexManifest()
	if err != nil {
		return fmt.Errorf("failed to get index manifest: %w", err)
	}

	logger.Info("copying image index with artifacts",
		zap.String("source", sourcePath),
		zap.String("destination", destPath),
		zap.Int("manifestCount", len(indexManifest.Manifests)))

	// Write the complete index (including all manifests and artifacts) to destination
	if err := remote.WriteIndex(destRef, imageIndex, remote.WithAuth(destAuth), remote.WithContext(ctx)); err != nil {
		return fmt.Errorf("failed to write image index with artifacts to destination %s: %w", destPath, err)
	}

	logger.Info("successfully copied image index with all artifacts and attestations",
		zap.String("source", sourcePath),
		zap.String("destination", destPath))

	return nil
}
