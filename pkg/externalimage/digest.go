package externalimage

import (
	"context"
	"fmt"

	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/securebuildhq/securebuild/pkg/registry"
)

// GetImageDigest fetches the digest of an image from a container registry.
// It uses the registry package to handle authentication, including automatic
// ECR token refresh for AWS ECR registries.
func GetImageDigest(ctx context.Context, registryHost string, imageName string, tag string, username string, password string) (string, error) {
	refStr := fmt.Sprintf("%s/%s:%s", registryHost, imageName, tag)
	ref, err := name.ParseReference(refStr)
	if err != nil {
		return "", fmt.Errorf("failed to parse image reference %q: %w", refStr, err)
	}

	// Use the registry package to get appropriate credentials.
	// For ECR registries, this will fetch a fresh token using the stored AWS credentials.
	authenticator, err := registry.GetCredentialsForEndpoint(ctx, registryHost, username, password)
	if err != nil {
		return "", fmt.Errorf("failed to get credentials for registry %s: %w", registryHost, err)
	}

	desc, err := remote.Get(ref, remote.WithAuth(authenticator), remote.WithContext(ctx))
	if err != nil {
		return "", fmt.Errorf("failed to fetch image descriptor: %w", err)
	}

	return desc.Digest.String(), nil
}
