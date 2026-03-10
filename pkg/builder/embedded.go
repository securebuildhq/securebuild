package builder

import (
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

//go:embed builder-linux-amd64
var embeddedBuilderBinaryAMD64 []byte

//go:embed builder-linux-arm64
var embeddedBuilderBinaryARM64 []byte

// GetEmbeddedBuilder returns the embedded builder binary for the specified architecture as bytes
func GetEmbeddedBuilder(architecture string) []byte {
	switch architecture {
	case "x86_64", "amd64":
		return embeddedBuilderBinaryAMD64
	case "aarch64", "arm64":
		return embeddedBuilderBinaryARM64
	default:
		return nil
	}
}

// ExtractBuilderBinary extracts the embedded builder binary for the specified architecture to a temporary file
// and returns the path to that file. The caller is responsible for cleaning up the file.
func ExtractBuilderBinary(architecture string) (string, error) {
	builderData := GetEmbeddedBuilder(architecture)
	if len(builderData) == 0 {
		return "", fmt.Errorf("embedded builder binary is empty for architecture %s", architecture)
	}

	// Create a temporary file
	tmpDir := os.TempDir()
	builderPath := filepath.Join(tmpDir, fmt.Sprintf("securebuild-builder-%s", architecture))

	// On Windows, add .exe extension (though this shouldn't happen since we build for Linux)
	if runtime.GOOS == "windows" {
		builderPath += ".exe"
	}

	// Write the binary to the temporary file
	err := os.WriteFile(builderPath, builderData, 0o755)
	if err != nil {
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

	// Ensure the directory exists
	dir := filepath.Dir(targetPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	// Write the binary to the target path
	err := os.WriteFile(targetPath, builderData, 0o755)
	if err != nil {
		return fmt.Errorf("failed to write builder binary to %s: %w", targetPath, err)
	}

	return nil
}

// GetBuilderBinarySize returns the size of the embedded builder binary for the specified architecture
func GetBuilderBinarySize(architecture string) int {
	return len(GetEmbeddedBuilder(architecture))
}

// IsBuilderEmbedded returns true if the builder binary is embedded for the specified architecture
func IsBuilderEmbedded(architecture string) bool {
	return len(GetEmbeddedBuilder(architecture)) > 0
}

// GetSupportedArchitectures returns a list of architectures for which builder binaries are embedded
func GetSupportedArchitectures() []string {
	var supported []string

	if len(embeddedBuilderBinaryAMD64) > 0 {
		supported = append(supported, "x86_64")
	}

	if len(embeddedBuilderBinaryARM64) > 0 {
		supported = append(supported, "aarch64")
	}

	return supported
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
