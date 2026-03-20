package cli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// generateAPKOConfigs generates APKO configurations for the minimal image
func generateAPKOConfigs(ctx context.Context, imageInfo *ImageInfo, filteredSBOM *FilteredSBOM, outputDir string) error {
	fmt.Println("  Generating APKO configurations...")

	// Create apko directory
	apkoDir := filepath.Join(outputDir, "apko")
	if err := os.MkdirAll(apkoDir, 0755); err != nil {
		return fmt.Errorf("failed to create apko directory: %w", err)
	}

	// Generate the main APKO configuration
	config, err := generateAPKOConfig(ctx, imageInfo, filteredSBOM)
	if err != nil {
		return fmt.Errorf("failed to generate APKO config: %w", err)
	}

	// Write the main APKO configuration
	apkoFile := filepath.Join(apkoDir, "apko.yaml")
	yamlData, err := yaml.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal APKO config: %w", err)
	}

	if err := os.WriteFile(apkoFile, yamlData, 0644); err != nil {
		return fmt.Errorf("failed to write APKO config: %w", err)
	}

	fmt.Printf("    ✓ Generated APKO configuration: %s\n", apkoFile)
	fmt.Printf("    ✓ Included %d packages\n", len(config.Contents.Packages))

	return nil
}

// generateAPKOConfig creates an APKO configuration structure
func generateAPKOConfig(ctx context.Context, imageInfo *ImageInfo, filteredSBOM *FilteredSBOM) (*APKOConfig, error) {
	// Build the package list from filtered SBOM
	packages := buildPackageList(filteredSBOM)

	// Use APK repository from environment (required)
	apkRepo := os.Getenv("APK_REPOSITORY")
	if apkRepo == "" {
		return nil, fmt.Errorf("APK_REPOSITORY environment variable is required")
	}
	apkKeyName := os.Getenv("APK_PUBLIC_KEY_NAME")
	if apkKeyName == "" {
		return nil, fmt.Errorf("APK_PUBLIC_KEY_NAME environment variable is required")
	}
	repositories := []string{
		apkRepo,
	}
	keyring := []string{
		apkRepo + "/key/" + apkKeyName,
	}

	// Create the APKO configuration
	config := &APKOConfig{
		Contents: APKOContents{
			Repositories: repositories,
			Keyring:      keyring,
			Packages:     packages,
		},
		WorkDir:     imageInfo.WorkingDir,
		Environment: buildEnvironmentMap(imageInfo.Env),
	}

	// Set entrypoint only if it's not empty
	if len(imageInfo.Entrypoint) > 0 {
		// Join entrypoint array into a single command string
		entrypointCmd := strings.Join(imageInfo.Entrypoint, " ")
		config.Entrypoint = APKOEntrypoint{
			Command: entrypointCmd,
		}
	}

	// Set cmd only if it's not empty
	if len(imageInfo.Cmd) > 0 {
		// Join cmd array into a single command string
		config.Cmd = strings.Join(imageInfo.Cmd, " ")
	}

	// Set up user/account configuration
	if imageInfo.User != "" {
		config.Accounts = APKOAccounts{
			RunAs: imageInfo.User,
		}
	}

	// Add architecture-specific configurations
	config.Archs = []string{"x86_64", "aarch64"}

	return config, nil
}

// buildPackageList builds a list of packages from the filtered SBOM
func buildPackageList(filteredSBOM *FilteredSBOM) []string {
	var packages []string

	// Add essential base packages
	essentialPackages := []string{
		"ca-certificates-bundle",
		"tzdata",
	}

	// Add essential packages first
	for _, pkg := range essentialPackages {
		if !contains(packages, pkg) {
			packages = append(packages, pkg)
		}
	}

	// Add filtered SBOM packages
	for _, pkg := range filteredSBOM.Packages {
		converted := convertPackageName(pkg.Name)
		if converted != "" && !contains(packages, converted) {
			packages = append(packages, converted)
		}
	}

	return packages
}

// convertPackageName normalizes a package name, mapping known aliases and
// skipping packages that are not available in the APK ecosystem.
func convertPackageName(name string) string {
	// Common package name mappings
	nameMappings := map[string]string{
		"busybox":                "busybox",
		"ca-certificates-bundle": "ca-certificates-bundle",
		"ca-certificates":        "ca-certificates-bundle",
		"zlib":                   "zlib",
		"libssl":                 "openssl",
		"openssl":                "openssl",
		"tzdata":                 "tzdata",
		"bash":                   "bash",
		"curl":                   "curl",
		"wget":                   "wget",
		"glibc":                  "glibc",
		"libc6":                  "glibc",
		"libcurl":                "curl",
		"libcurl4":               "curl",
		"ncurses":                "ncurses",
		"readline":               "readline",
		"sqlite":                 "sqlite",
		"libsqlite3":             "sqlite",
		"python3":                "python-3.12",
		"python":                 "python-3.12",
		"git":                    "git",
		"make":                   "make",
		"gcc":                    "gcc",
		"binutils":               "binutils",
		"pkgconf":                "pkgconf",
		"pkg-config":             "pkgconf",
	}

	if mapped, exists := nameMappings[name]; exists {
		return mapped
	}

	// Skip packages that are distro-specific or problematic
	skipPackages := map[string]bool{
		"musl":         true, // glibc-based, not musl
		"alpine-base":  true, // Alpine-specific
		"alpine-keys":  true, // Alpine-specific
		"apk-tools":    true, // May cause issues
		"scanelf":      true, // Alpine-specific
		"ssl_client":   true, // Alpine-specific
		"libcrypto1.1": true, // Use openssl instead
		"libssl1.1":    true, // Use openssl instead
		"libcrypto3":   true, // Use openssl instead
		"libssl3":      true, // Use openssl instead
		"zlib1g":       true, // Use zlib instead
		"zlib1g-dev":   true, // Use zlib instead
	}

	if skipPackages[name] {
		return ""
	}

	return name
}

// buildEnvironmentMap builds environment variables map from the image info
func buildEnvironmentMap(envVars []string) map[string]string {
	env := make(map[string]string)

	for _, envVar := range envVars {
		parts := strings.SplitN(envVar, "=", 2)
		if len(parts) == 2 {
			env[parts[0]] = parts[1]
		}
	}

	return env
}

// contains checks if a slice contains a string
func contains(slice []string, item string) bool {
	for _, s := range slice {
		if s == item {
			return true
		}
	}
	return false
}

// writeAPKOConfig writes the APKO configuration to a YAML file
func writeAPKOConfig(config *APKOConfig, filepath string) error {
	yamlData, err := yaml.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal APKO config to YAML: %w", err)
	}

	if err := os.WriteFile(filepath, yamlData, 0644); err != nil {
		return fmt.Errorf("failed to write APKO config file: %w", err)
	}

	return nil
}

// generateMultiArchAPKOConfigs generates architecture-specific APKO configurations
func generateMultiArchAPKOConfigs(ctx context.Context, imageInfo *ImageInfo, filteredSBOM *FilteredSBOM, outputDir string) error {
	architectures := []string{"x86_64", "aarch64"}

	for _, arch := range architectures {
		// Generate architecture-specific configuration
		config, err := generateAPKOConfig(ctx, imageInfo, filteredSBOM)
		if err != nil {
			return fmt.Errorf("failed to generate APKO config for %s: %w", arch, err)
		}

		// Set architecture-specific settings
		config.Archs = []string{arch}

		// Write architecture-specific config
		archPath := filepath.Join(outputDir, fmt.Sprintf("apko-%s.yaml", arch))
		if err := writeAPKOConfig(config, archPath); err != nil {
			return fmt.Errorf("failed to write APKO config for %s: %w", arch, err)
		}

		fmt.Printf("    ✓ Generated architecture-specific config: %s\n", archPath)
	}

	return nil
}

// generateAPKOWithLLM generates APKO configuration using LLM (future implementation)
func generateAPKOWithLLM(ctx context.Context, imageInfo *ImageInfo, filteredSBOM *FilteredSBOM) (*APKOConfig, error) {
	// Create a prompt for the LLM to generate APKO YAML
	prompt := createAPKOPrompt(imageInfo, filteredSBOM)

	// TODO: Implement LLM integration
	// This would use the existing LLM service to generate APKO configuration
	// apkoYAML, err := llm.GenerateAPKOFromMelanage(ctx, prompt)
	// if err != nil {
	//     return nil, fmt.Errorf("failed to generate APKO YAML: %w", err)
	// }

	// For now, fall back to the standard generation
	_ = prompt // Use the prompt variable to avoid unused variable warning
	return generateAPKOConfig(ctx, imageInfo, filteredSBOM)
}

// createAPKOPrompt creates a prompt for the LLM to generate APKO YAML
func createAPKOPrompt(imageInfo *ImageInfo, filteredSBOM *FilteredSBOM) string {
	packages := []string{}
	for _, pkg := range filteredSBOM.Packages {
		packages = append(packages, fmt.Sprintf("%s@%s", pkg.Name, pkg.Version))
	}

	return fmt.Sprintf(`Generate an APKO YAML configuration for the following container image:

Image Information:
- Registry: %s
- Repository: %s
- Tag: %s
- Entrypoint: %v
- Cmd: %v
- WorkingDir: %s
- User: %s
- Environment Variables: %v

Required Packages:
%s

Please create a complete APKO YAML that:
1. Includes all required packages
2. Sets up proper entrypoint and command
3. Configures environment variables
4. Sets working directory and user
5. Uses CVE0 repository as primary source
6. Includes proper keyring configuration
7. Supports both x86_64 and aarch64 architectures

The APKO YAML should be production-ready and create a minimal, secure container image.`,
		imageInfo.Registry,
		imageInfo.Repository,
		imageInfo.Tag,
		imageInfo.Entrypoint,
		imageInfo.Cmd,
		imageInfo.WorkingDir,
		imageInfo.User,
		imageInfo.Env,
		strings.Join(packages, "\n"))
}

// validateAPKOConfig validates an APKO configuration
func validateAPKOConfig(config *APKOConfig) error {
	if len(config.Contents.Packages) == 0 {
		return fmt.Errorf("APKO config must include at least one package")
	}

	if len(config.Contents.Repositories) == 0 {
		return fmt.Errorf("APKO config must include at least one repository")
	}

	if len(config.Entrypoint.Command) == 0 {
		return fmt.Errorf("APKO config must include an entrypoint command")
	}

	return nil
}

// APKOConfig represents the structure of an APKO configuration file
type APKOConfig struct {
	Contents    APKOContents      `yaml:"contents"`
	Entrypoint  APKOEntrypoint    `yaml:"entrypoint,omitempty"`
	Cmd         string            `yaml:"cmd,omitempty"`
	WorkDir     string            `yaml:"work-dir,omitempty"`
	Environment map[string]string `yaml:"environment,omitempty"`
	Accounts    APKOAccounts      `yaml:"accounts,omitempty"`
	Archs       []string          `yaml:"archs,omitempty"`
}

// APKOContents represents the contents section of an APKO configuration
type APKOContents struct {
	Repositories []string `yaml:"repositories"`
	Keyring      []string `yaml:"keyring"`
	Packages     []string `yaml:"packages"`
}

// APKOEntrypoint represents the entrypoint section of an APKO configuration
type APKOEntrypoint struct {
	Command string `yaml:"command"`
}

// APKOAccounts represents the accounts section of an APKO configuration
type APKOAccounts struct {
	RunAs string `yaml:"run-as,omitempty"`
}
