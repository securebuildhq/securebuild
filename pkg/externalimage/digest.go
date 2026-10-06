package externalimage

import (
	"context"
	"fmt"

	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/securebuildhq/securebuild/pkg/registry"
)

type ImageDescriptor struct {
	Digest        string
	Architectures []string
}

// GetImageDigest fetches the digest of an image from a container registry.
// It uses the registry package to handle authentication, including automatic
// ECR token refresh for AWS ECR registries.
func GetImageDigest(ctx context.Context, registryHost string, imageName string, tag string, username string, password string) (string, error) {
	descriptor, err := GetImageDescriptor(ctx, registryHost, imageName, tag, username, password)
	if err != nil {
		return "", err
	}
	return descriptor.Digest, nil
}

// GetImageDescriptor resolves a tag to its immutable digest and the supported
// Linux architectures actually present in the registry descriptor.
func GetImageDescriptor(ctx context.Context, registryHost string, imageName string, tag string, username string, password string) (*ImageDescriptor, error) {
	return getImageDescriptor(ctx, fmt.Sprintf("%s/%s:%s", registryHost, imageName, tag), registryHost, username, password)
}

// GetImageDescriptorForDigest resolves the platforms belonging to an existing
// immutable digest. A platform-manifest digest yields only its own platform.
func GetImageDescriptorForDigest(ctx context.Context, registryHost string, imageName string, digest string, username string, password string) (*ImageDescriptor, error) {
	return getImageDescriptor(ctx, fmt.Sprintf("%s/%s@%s", registryHost, imageName, digest), registryHost, username, password)
}

func getImageDescriptor(ctx context.Context, refStr, registryHost, username, password string) (*ImageDescriptor, error) {
	ref, err := name.ParseReference(refStr)
	if err != nil {
		return nil, fmt.Errorf("failed to parse image reference %q: %w", refStr, err)
	}

	// Use the registry package to get appropriate credentials.
	// For ECR registries, this will fetch a fresh token using the stored AWS credentials.
	authenticator, err := registry.GetCredentialsForEndpoint(ctx, registryHost, username, password)
	if err != nil {
		return nil, fmt.Errorf("failed to get credentials for registry %s: %w", registryHost, err)
	}

	desc, err := remote.Get(ref, remote.WithAuth(authenticator), remote.WithContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("failed to fetch image descriptor: %w", err)
	}

	var architectures []string
	if desc.MediaType.IsSchema1() {
		// Schema 1 manifests do not expose a config from which we can reliably
		// discover the platform. Preserve the resolved digest for compatibility,
		// but do not guess an architecture and enqueue incorrect SBOM work.
		architectures = nil
	} else if desc.MediaType.IsIndex() {
		index, err := desc.ImageIndex()
		if err != nil {
			return nil, fmt.Errorf("failed to read image index: %w", err)
		}
		manifest, err := index.IndexManifest()
		if err != nil {
			return nil, fmt.Errorf("failed to read image index manifest: %w", err)
		}
		architectures = supportedIndexArchitectures(manifest)
	} else if desc.MediaType.IsImage() {
		image, err := desc.Image()
		if err != nil {
			return nil, fmt.Errorf("failed to read image manifest: %w", err)
		}
		config, err := image.ConfigFile()
		if err != nil {
			return nil, fmt.Errorf("failed to read image config: %w", err)
		}
		if architecture, ok := supportedArchitecture(config.OS, config.Architecture); ok {
			architectures = []string{architecture}
		}
	} else {
		return nil, fmt.Errorf("unsupported image descriptor media type %q", desc.MediaType)
	}

	return &ImageDescriptor{Digest: desc.Digest.String(), Architectures: architectures}, nil
}

func supportedIndexArchitectures(manifest *v1.IndexManifest) []string {
	found := map[string]bool{}
	for _, descriptor := range manifest.Manifests {
		if descriptor.Platform == nil {
			continue
		}
		if architecture, ok := supportedArchitecture(descriptor.Platform.OS, descriptor.Platform.Architecture); ok {
			found[architecture] = true
		}
	}

	architectures := make([]string, 0, 2)
	for _, architecture := range []string{"x86_64", "aarch64"} {
		if found[architecture] {
			architectures = append(architectures, architecture)
		}
	}
	return architectures
}

func supportedArchitecture(os, architecture string) (string, bool) {
	if os != "linux" {
		return "", false
	}
	switch architecture {
	case "amd64":
		return "x86_64", true
	case "arm64":
		return "aarch64", true
	default:
		return "", false
	}
}
