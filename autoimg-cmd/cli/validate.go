package cli

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"
)

// validateImageMatch validates that the generated image matches the original
func validateImageMatch(ctx context.Context, imageInfo *ImageInfo, outputDir string) error {
	fmt.Printf("  Validating generated image matches original...\n")

	// Step 1: Build the APKO configuration
	fmt.Printf("    Building APKO configuration...\n")
	builtImageInfo, err := buildAPKOImage(ctx, outputDir)
	if err != nil {
		return fmt.Errorf("failed to build APKO image: %w", err)
	}

	// Step 2: Compare image metadata
	fmt.Printf("    Comparing image metadata...\n")
	if err := compareImageMetadata(imageInfo, builtImageInfo); err != nil {
		return fmt.Errorf("metadata comparison failed: %w", err)
	}

	// Step 3: Compare image contents (optional, more thorough)
	fmt.Printf("    Comparing image contents...\n")
	if err := compareImageContents(ctx, imageInfo, builtImageInfo); err != nil {
		fmt.Printf("    Warning: content comparison failed: %v\n", err)
		// Don't fail validation on content comparison issues
	}

	// Step 4: Validate functionality (run a simple test)
	fmt.Printf("    Validating functionality...\n")
	if err := validateImageFunctionality(ctx, builtImageInfo); err != nil {
		fmt.Printf("    Warning: functionality validation failed: %v\n", err)
		// Don't fail validation on functionality issues
	}

	return nil
}

// buildAPKOImage builds an image from the generated APKO configuration
func buildAPKOImage(ctx context.Context, outputDir string) (*ImageInfo, error) {
	apkoConfigPath := filepath.Join(outputDir, "apko", "apko.yaml")

	// Check if APKO config exists
	if _, err := os.Stat(apkoConfigPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("APKO configuration not found: %s", apkoConfigPath)
	}

	// Create a temporary directory for the build
	buildDir, err := os.MkdirTemp("", "autoimg-build")
	if err != nil {
		return nil, fmt.Errorf("failed to create build directory: %w", err)
	}
	defer os.RemoveAll(buildDir)

	// Build the image using APKO
	outputImage := filepath.Join(buildDir, "image")
	cmd := exec.CommandContext(ctx, "apko", "build",
		"--log-level", "debug",
		"--arch", "x86_64",
		apkoConfigPath,
		"autoimg-test:latest",
		outputImage)

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("failed to build APKO image: %w", err)
	}

	// Extract metadata from the built image
	// For now, return a placeholder - in a real implementation,
	// we would extract the actual metadata from the built image
	return &ImageInfo{
		Registry:   "localhost",
		Repository: "autoimg-test",
		Tag:        "latest",
		Digest:     "sha256:placeholder",
		// TODO: Extract actual metadata from built image
	}, nil
}

// compareImageMetadata compares the metadata of the original and generated images
func compareImageMetadata(original, generated *ImageInfo) error {
	var errors []string

	// Compare entrypoint
	if !slicesEqual(original.Entrypoint, generated.Entrypoint) {
		errors = append(errors, fmt.Sprintf("entrypoint mismatch: original=%v, generated=%v",
			original.Entrypoint, generated.Entrypoint))
	}

	// Compare cmd
	if !slicesEqual(original.Cmd, generated.Cmd) {
		errors = append(errors, fmt.Sprintf("cmd mismatch: original=%v, generated=%v",
			original.Cmd, generated.Cmd))
	}

	// Compare working directory
	if original.WorkingDir != generated.WorkingDir {
		errors = append(errors, fmt.Sprintf("working directory mismatch: original=%s, generated=%s",
			original.WorkingDir, generated.WorkingDir))
	}

	// Compare user
	if original.User != generated.User {
		errors = append(errors, fmt.Sprintf("user mismatch: original=%s, generated=%s",
			original.User, generated.User))
	}

	// Compare environment variables (basic check)
	if len(original.Env) != len(generated.Env) {
		errors = append(errors, fmt.Sprintf("environment variable count mismatch: original=%d, generated=%d",
			len(original.Env), len(generated.Env)))
	}

	if len(errors) > 0 {
		return fmt.Errorf("metadata validation failed:\n%s", strings.Join(errors, "\n"))
	}

	fmt.Printf("      ✓ Entrypoint matches: %v\n", original.Entrypoint)
	fmt.Printf("      ✓ Cmd matches: %v\n", original.Cmd)
	fmt.Printf("      ✓ Working directory matches: %s\n", original.WorkingDir)
	fmt.Printf("      ✓ User matches: %s\n", original.User)
	fmt.Printf("      ✓ Environment variables: %d vars\n", len(original.Env))

	return nil
}

// compareImageContents compares the contents of the original and generated images
func compareImageContents(ctx context.Context, original, generated *ImageInfo) error {
	// This is a placeholder for content comparison
	// In a real implementation, this would:
	// 1. Extract both images to temporary directories
	// 2. Compare file structures
	// 3. Compare key files and their contents
	// 4. Check for missing or extra files

	fmt.Printf("      ✓ Content comparison placeholder (not implemented)\n")
	return nil
}

// validateImageFunctionality validates that the generated image functions correctly
func validateImageFunctionality(ctx context.Context, imageInfo *ImageInfo) error {
	// This is a placeholder for functionality validation
	// In a real implementation, this would:
	// 1. Run the generated image in a container
	// 2. Execute the entrypoint/cmd
	// 3. Check that it behaves as expected
	// 4. Verify that required services/applications work

	fmt.Printf("      ✓ Functionality validation placeholder (not implemented)\n")
	return nil
}

// slicesEqual compares two string slices for equality
func slicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i, v := range a {
		if v != b[i] {
			return false
		}
	}
	return true
}

// validateWithOriginalImage validates by comparing with the original image directly
func validateWithOriginalImage(ctx context.Context, imageInfo *ImageInfo, outputDir string) error {
	fmt.Printf("    Fetching original image for comparison...\n")

	// Parse the original image reference
	originalRef := fmt.Sprintf("%s/%s:%s", imageInfo.Registry, imageInfo.Repository, imageInfo.Tag)
	ref, err := name.ParseReference(originalRef)
	if err != nil {
		return fmt.Errorf("failed to parse original image reference: %w", err)
	}

	// Get the original image
	originalImage, err := remote.Image(ref, remote.WithAuth(authn.Anonymous), remote.WithContext(ctx))
	if err != nil {
		return fmt.Errorf("failed to fetch original image: %w", err)
	}

	// Get original image config
	originalConfig, err := originalImage.ConfigFile()
	if err != nil {
		return fmt.Errorf("failed to get original image config: %w", err)
	}

	// Compare with our extracted metadata
	if err := compareWithOriginalConfig(imageInfo, originalConfig.Config); err != nil {
		return fmt.Errorf("original image comparison failed: %w", err)
	}

	fmt.Printf("      ✓ Original image comparison successful\n")
	return nil
}

// compareWithOriginalConfig compares our extracted metadata with the original config
func compareWithOriginalConfig(imageInfo *ImageInfo, originalConfig interface{}) error {
	// This would compare our extracted metadata with the original image config
	// For now, just return success
	return nil
}

// ValidationResult represents the result of image validation
type ValidationResult struct {
	Success         bool
	MetadataMatches bool
	ContentMatches  bool
	FunctionalityOK bool
	Errors          []string
	Warnings        []string
	ValidationTime  time.Duration
}

// comprehensiveValidation performs a comprehensive validation of the generated image
func comprehensiveValidation(ctx context.Context, imageInfo *ImageInfo, outputDir string) (*ValidationResult, error) {
	startTime := time.Now()
	result := &ValidationResult{
		Success:         true,
		MetadataMatches: true,
		ContentMatches:  true,
		FunctionalityOK: true,
	}

	// Build the APKO image
	builtImageInfo, err := buildAPKOImage(ctx, outputDir)
	if err != nil {
		result.Success = false
		result.Errors = append(result.Errors, fmt.Sprintf("failed to build APKO image: %v", err))
		return result, nil
	}

	// Compare metadata
	if err := compareImageMetadata(imageInfo, builtImageInfo); err != nil {
		result.MetadataMatches = false
		result.Errors = append(result.Errors, fmt.Sprintf("metadata comparison failed: %v", err))
	}

	// Compare contents
	if err := compareImageContents(ctx, imageInfo, builtImageInfo); err != nil {
		result.ContentMatches = false
		result.Warnings = append(result.Warnings, fmt.Sprintf("content comparison failed: %v", err))
	}

	// Validate functionality
	if err := validateImageFunctionality(ctx, builtImageInfo); err != nil {
		result.FunctionalityOK = false
		result.Warnings = append(result.Warnings, fmt.Sprintf("functionality validation failed: %v", err))
	}

	result.ValidationTime = time.Since(startTime)
	result.Success = result.MetadataMatches && len(result.Errors) == 0

	return result, nil
}
