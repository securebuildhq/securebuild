package cli

import (
	"context"
	"fmt"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"
)

// downloadAndExtractImage downloads an OCI image and extracts its metadata
func downloadAndExtractImage(ctx context.Context, imagePath, username, password string) (*ImageInfo, error) {
	// Parse the image reference
	ref, err := name.ParseReference(imagePath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse image reference: %w", err)
	}

	// Set up authentication
	var auth authn.Authenticator = authn.Anonymous
	if username != "" && password != "" {
		auth = &authn.Basic{
			Username: username,
			Password: password,
		}
	}

	// Get the image
	img, err := remote.Image(ref, remote.WithAuth(auth), remote.WithContext(ctx))
	if err != nil {
		return nil, fmt.Errorf("failed to fetch image: %w", err)
	}

	// Get image digest
	digest, err := img.Digest()
	if err != nil {
		return nil, fmt.Errorf("failed to get image digest: %w", err)
	}

	// Get image config
	configFile, err := img.ConfigFile()
	if err != nil {
		return nil, fmt.Errorf("failed to get image config: %w", err)
	}

	// Extract registry, repository, and tag from the reference
	registry := ref.Context().Registry.Name()
	repository := ref.Context().RepositoryStr()
	tag := "latest"
	if tagged, ok := ref.(name.Tag); ok {
		tag = tagged.TagStr()
	}

	// Extract metadata from the config
	config := configFile.Config
	imageInfo := &ImageInfo{
		Registry:   registry,
		Repository: repository,
		Tag:        tag,
		Digest:     digest.String(),
		Entrypoint: config.Entrypoint,
		Cmd:        config.Cmd,
		Env:        config.Env,
		WorkingDir: config.WorkingDir,
		User:       config.User,
	}

	// Extract Args from Entrypoint and Cmd combination
	if len(config.Entrypoint) > 0 && len(config.Cmd) > 0 {
		imageInfo.Args = config.Cmd
	}

	fmt.Printf("  Registry: %s\n", imageInfo.Registry)
	fmt.Printf("  Repository: %s\n", imageInfo.Repository)
	fmt.Printf("  Tag: %s\n", imageInfo.Tag)
	fmt.Printf("  Digest: %s\n", imageInfo.Digest)
	fmt.Printf("  Entrypoint: %v\n", imageInfo.Entrypoint)
	fmt.Printf("  Cmd: %v\n", imageInfo.Cmd)
	fmt.Printf("  Env: %v\n", imageInfo.Env)
	fmt.Printf("  WorkingDir: %s\n", imageInfo.WorkingDir)
	fmt.Printf("  User: %s\n", imageInfo.User)

	return imageInfo, nil
}

// min returns the minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
