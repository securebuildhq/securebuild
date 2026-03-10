package cli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// MelangeConfig represents the structure of a melange YAML configuration
type MelangeConfig struct {
	Package     MelangePackage      `yaml:"package"`
	Environment MelangeEnvironment  `yaml:"environment"`
	Pipeline    []MelangePipeline   `yaml:"pipeline"`
	Subpackages []MelangeSubpackage `yaml:"subpackages,omitempty"`
}

type MelangePackage struct {
	Name        string             `yaml:"name"`
	Version     string             `yaml:"version"`
	Description string             `yaml:"description"`
	Copyright   []MelangeCopyright `yaml:"copyright"`
}

type MelangeCopyright struct {
	License string   `yaml:"license"`
	Paths   []string `yaml:"paths"`
}

type MelangeEnvironment struct {
	Contents MelangeContents `yaml:"contents"`
}

type MelangeContents struct {
	Packages []string `yaml:"packages"`
}

type MelangePipeline struct {
	Uses string                 `yaml:"uses"`
	With map[string]interface{} `yaml:"with,omitempty"`
}

type MelangeSubpackage struct {
	Name        string            `yaml:"name"`
	Description string            `yaml:"description"`
	Pipeline    []MelangePipeline `yaml:"pipeline"`
}

// generateMelangeConfigs generates melange YAML configurations for missing packages
func generateMelangeConfigs(ctx context.Context, missingPackages []MissingPackage, outputDir string) error {
	fmt.Printf("  Generating melange configurations for %d packages...\n", len(missingPackages))

	// Create melange directory
	melangeDir := filepath.Join(outputDir, "melange")
	if err := os.MkdirAll(melangeDir, 0755); err != nil {
		return fmt.Errorf("failed to create melange directory: %w", err)
	}

	// Group packages by type for better organization
	packagesByType := make(map[string][]MissingPackage)
	for _, pkg := range missingPackages {
		packagesByType[pkg.Type] = append(packagesByType[pkg.Type], pkg)
	}

	// Create a single melange.yaml file with all packages
	melangeConfig := &MelangeConfig{
		Package: MelangePackage{
			Name:        "securebuild-packages",
			Version:     "1.0.0",
			Description: "SecureBuild generated packages from autoimg",
			Copyright: []MelangeCopyright{
				{
					License: "MIT",
					Paths:   []string{"*"},
				},
			},
		},
		Environment: MelangeEnvironment{
			Contents: MelangeContents{
				Packages: []string{
					"build-base",
					"busybox",
					"ca-certificates-bundle",
				},
			},
		},
		Pipeline: []MelangePipeline{
			{
				Uses: "fetch",
				With: map[string]interface{}{
					"uri":             "https://example.com/source.tar.gz",
					"expected-sha256": "placeholder-sha256",
				},
			},
			{
				Uses: "autoconf/configure",
			},
			{
				Uses: "autoconf/make",
			},
			{
				Uses: "autoconf/make-install",
			},
			{
				Uses: "strip",
			},
		},
		Subpackages: []MelangeSubpackage{},
	}

	// Add subpackages for each missing package
	for _, pkg := range missingPackages {
		subpackage := MelangeSubpackage{
			Name:        pkg.Name,
			Description: fmt.Sprintf("Generated package for %s", pkg.Name),
			Pipeline: []MelangePipeline{
				{
					Uses: "split/by-name",
					With: map[string]interface{}{
						"name": pkg.Name,
					},
				},
			},
		}
		melangeConfig.Subpackages = append(melangeConfig.Subpackages, subpackage)
	}

	// Write the melange configuration
	melangeFile := filepath.Join(melangeDir, "melange.yaml")
	yamlData, err := yaml.Marshal(melangeConfig)
	if err != nil {
		return fmt.Errorf("failed to marshal melange config: %w", err)
	}

	if err := os.WriteFile(melangeFile, yamlData, 0644); err != nil {
		return fmt.Errorf("failed to write melange config: %w", err)
	}

	fmt.Printf("    ✓ Generated melange configuration: %s\n", melangeFile)
	fmt.Printf("    ✓ Included %d packages as subpackages\n", len(missingPackages))

	return nil
}

// groupPackagesByType groups packages by their type for better processing
func groupPackagesByType(packages []MissingPackage) map[string][]MissingPackage {
	groups := make(map[string][]MissingPackage)

	for _, pkg := range packages {
		pkgType := pkg.Type
		if pkgType == "" {
			pkgType = "library"
		}
		groups[pkgType] = append(groups[pkgType], pkg)
	}

	return groups
}

// generateMelangeForPackage generates a melange YAML configuration for a single package
func generateMelangeForPackage(ctx context.Context, pkg MissingPackage, outputDir string) error {
	// Create a prompt for the LLM to generate melange YAML
	prompt := createMelangePrompt(pkg)

	// For now, create a basic melange template
	// In a real implementation, this would use the LLM service with the prompt above
	melangeYAML := generateBasicMelangeYAML(pkg)

	// TODO: Uncomment and use the actual LLM service
	// This would require proper context and configuration
	// melangeYAML, err := llm.GenerateMelange(ctx, prompt)
	// if err != nil {
	//     return fmt.Errorf("failed to generate melange YAML: %w", err)
	// }

	// Validate the generated YAML
	if err := validateMelangeYAML(melangeYAML); err != nil {
		return fmt.Errorf("generated melange YAML is invalid: %w", err)
	}

	// Write the melange YAML to file
	filename := fmt.Sprintf("%s.yaml", sanitizeFilename(pkg.Name))
	filepath := filepath.Join(outputDir, filename)

	if err := os.WriteFile(filepath, []byte(melangeYAML), 0644); err != nil {
		return fmt.Errorf("failed to write melange file: %w", err)
	}

	// Log the prompt for debugging purposes
	_ = prompt // Use the prompt variable to avoid unused variable warning

	return nil
}

// createMelangePrompt creates a prompt for the LLM to generate melange YAML
func createMelangePrompt(pkg MissingPackage) string {
	return fmt.Sprintf(`Generate a melange YAML configuration for the following package:

Package Name: %s
Version: %s
Type: %s

Please create a complete melange YAML that:
1. Builds the package from source
2. Includes all necessary dependencies
3. Follows melange best practices
4. Uses appropriate build tools and commands
5. Includes proper package metadata

The melange YAML should be production-ready and suitable for building in a secure environment.`,
		pkg.Name, pkg.Version, pkg.Type)
}

// generateBasicMelangeYAML generates a basic melange YAML template
func generateBasicMelangeYAML(pkg MissingPackage) string {
	// This is a basic template - in a real implementation,
	// this would be generated by the LLM service

	template := `package:
  name: %s
  version: %s
  epoch: 0
  description: "%s package"
  copyright:
    - license: Apache-2.0

environment:
  contents:
    packages:
      - build-base
      - busybox
      - ca-certificates-bundle

pipeline:
  - uses: fetch
    with:
      expected-sha256: ""
      uri: https://example.com/source.tar.gz
      strip-components: 1

  - uses: autoconf/make

  - uses: autoconf/make-install

  - uses: strip

subpackages:
  - name: %s-dev
    pipeline:
      - uses: split/dev
    dependencies:
      runtime:
        - %s
    description: %s dev

update:
  enabled: true
  release-monitor:
    identifier: 0
`

	description := fmt.Sprintf("%s library", pkg.Name)
	if pkg.Type != "library" {
		description = fmt.Sprintf("%s %s", pkg.Name, pkg.Type)
	}

	return fmt.Sprintf(template,
		pkg.Name,
		pkg.Version,
		description,
		pkg.Name,
		pkg.Name,
		pkg.Name)
}

// sanitizeFilename sanitizes a package name for use as a filename
func sanitizeFilename(name string) string {
	// Replace problematic characters with safe alternatives
	sanitized := strings.ReplaceAll(name, "/", "_")
	sanitized = strings.ReplaceAll(sanitized, ":", "_")
	sanitized = strings.ReplaceAll(sanitized, " ", "_")
	sanitized = strings.ReplaceAll(sanitized, "@", "_")
	sanitized = strings.ToLower(sanitized)

	return sanitized
}

// validateMelangeYAML validates a generated melange YAML configuration
func validateMelangeYAML(melangeYAML string) error {
	// Basic validation - check for required fields
	requiredFields := []string{"package:", "name:", "version:", "pipeline:"}

	for _, field := range requiredFields {
		if !strings.Contains(melangeYAML, field) {
			return fmt.Errorf("missing required field: %s", field)
		}
	}

	return nil
}

// MelangePackageInfo represents information about a melange package
type MelangePackageInfo struct {
	Name         string
	Version      string
	Description  string
	License      string
	Dependencies []string
	BuildSteps   []string
}

// generateMelangeFromTemplate generates melange YAML from a template and package info
func generateMelangeFromTemplate(info MelangePackageInfo) string {
	// This would be a more sophisticated template system
	// For now, return a basic template
	return generateBasicMelangeYAML(MissingPackage{
		Name:    info.Name,
		Version: info.Version,
		Type:    "library",
	})
}
