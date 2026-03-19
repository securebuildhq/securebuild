// Package builder embeds builder binaries and provides access by architecture or runtime.
// Linux binaries are always embedded (for remote VMs over SSH, which are assumed to be Linux).
// Darwin binaries are only embedded when building for darwin (for local backend on Mac).
package builder

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// ExtractBuilderBinary extracts the embedded builder binary for the specified architecture to a temporary file
// and returns the path to that file. The caller is responsible for cleaning up the file.
func ExtractBuilderBinary(architecture string) (string, error) {
	builderData := GetEmbeddedBuilder(architecture)
	if len(builderData) == 0 {
		return "", fmt.Errorf("embedded builder binary is empty for architecture %s", architecture)
	}

	tmpDir := os.TempDir()
	builderPath := filepath.Join(tmpDir, fmt.Sprintf("securebuild-builder-%s", architecture))

	if runtime.GOOS == "windows" {
		builderPath += ".exe"
	}

	if err := os.WriteFile(builderPath, builderData, 0o755); err != nil {
		return "", fmt.Errorf("failed to write builder binary to temp file: %w", err)
	}

	return builderPath, nil
}

// ExtractBuilderBinaryToPath extracts the embedded builder binary for the specified architecture to a specific path
func ExtractBuilderBinaryToPath(targetPath string, architecture string) error {
	builderData := GetEmbeddedBuilder(architecture)
	if len(builderData) == 0 {
		return fmt.Errorf("embedded builder binary is empty for architecture %s", architecture)
	}

	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	if err := os.WriteFile(targetPath, builderData, 0o755); err != nil {
		return fmt.Errorf("failed to write builder binary to %s: %w", targetPath, err)
	}

	return nil
}

// GetBuilderBinarySize returns the size of the embedded builder binary for the specified architecture
func GetBuilderBinarySize(architecture string) int {
	return len(GetEmbeddedBuilder(architecture))
}

// IsBuilderEmbedded returns true if the builder binary is embedded for the specified architecture (Linux)
func IsBuilderEmbedded(architecture string) bool {
	return len(GetEmbeddedBuilder(architecture)) > 0
}

// Legacy functions for backward compatibility - these use x86_64 as default
// Deprecated: Use architecture-specific functions instead

// GetEmbeddedBuilderLegacy returns the embedded x86_64 builder binary as bytes (deprecated)
func GetEmbeddedBuilderLegacy() []byte {
	return GetEmbeddedBuilder("x86_64")
}

// ExtractBuilderBinaryLegacy extracts the x86_64 builder binary to temp location (deprecated)
func ExtractBuilderBinaryLegacy() (string, error) {
	return ExtractBuilderBinary("x86_64")
}

// ExtractBuilderBinaryToPathLegacy extracts the x86_64 builder binary to specific path (deprecated)
func ExtractBuilderBinaryToPathLegacy(targetPath string) error {
	return ExtractBuilderBinaryToPath(targetPath, "x86_64")
}

// GetBuilderBinarySizeLegacy returns the size of the x86_64 builder binary (deprecated)
func GetBuilderBinarySizeLegacy() int {
	return GetBuilderBinarySize("x86_64")
}

// IsBuilderEmbeddedLegacy returns true if x86_64 builder binary is embedded (deprecated)
func IsBuilderEmbeddedLegacy() bool {
	return IsBuilderEmbedded("x86_64")
}
