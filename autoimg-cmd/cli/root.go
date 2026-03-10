package cli

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
)

type AutoimgFlags struct {
	ImagePath      string
	Username       string
	Password       string
	OutputDir      string
	ValidateOnly   bool
	SkipValidation bool
	Overwrite      bool
	APIEndpoint    string
	SkipAPICheck   bool
	Plan           bool
}

func RootCmd() *cobra.Command {
	flags := &AutoimgFlags{}

	rootCmd := cobra.Command{
		Use:   "autoimg [IMAGE_PATH]",
		Short: "SecureBuild Autoimg process",
		Long: `SecureBuild Image Generator

This tool downloads an OCI image, extracts its metadata, generates an SBOM,
filters it to minimal requirements, creates melange YAML for missing packages,
generates APKO configurations, and validates the result matches the original.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			flags.ImagePath = args[0]
			return runAutoimg(cmd.Context(), flags, flags.ImagePath)
		},
	}

	rootCmd.Flags().StringVarP(&flags.Username, "username", "u", "", "Username for registry authentication")
	rootCmd.Flags().StringVarP(&flags.Password, "password", "p", "", "Password for registry authentication")
	rootCmd.Flags().StringVarP(&flags.OutputDir, "output", "o", "./output", "Output directory for generated files")
	rootCmd.Flags().BoolVar(&flags.ValidateOnly, "validate-only", false, "Only validate without generating files")
	rootCmd.Flags().BoolVar(&flags.SkipValidation, "skip-validation", false, "Skip final validation step")
	rootCmd.Flags().BoolVar(&flags.Overwrite, "overwrite", false, "Overwrite existing files in output directory")
	rootCmd.Flags().StringVar(&flags.APIEndpoint, "api-endpoint", "https://securebuild.com", "API endpoint for package availability checking")
	rootCmd.Flags().BoolVar(&flags.SkipAPICheck, "skip-api-check", false, "Skip API check and treat all packages as missing")
	rootCmd.Flags().BoolVar(&flags.Plan, "plan", false, "Show plan of packages to use/build without generating files")

	return &rootCmd
}

// checkOutputDirectory validates the output directory and creates it if needed
func checkOutputDirectory(outputDir string, overwrite bool) error {
	// Check if directory exists
	if _, err := os.Stat(outputDir); err == nil {
		// Directory exists, check if it's empty
		entries, err := os.ReadDir(outputDir)
		if err != nil {
			return fmt.Errorf("failed to read output directory: %w", err)
		}

		if len(entries) > 0 && !overwrite {
			return fmt.Errorf("output directory %s is not empty. Use --overwrite to overwrite existing files", outputDir)
		}

		if overwrite {
			// Remove all contents if overwrite is enabled
			for _, entry := range entries {
				path := filepath.Join(outputDir, entry.Name())
				if err := os.RemoveAll(path); err != nil {
					return fmt.Errorf("failed to remove existing file %s: %w", path, err)
				}
			}
		}
	} else if os.IsNotExist(err) {
		// Directory doesn't exist, create it
		if err := os.MkdirAll(outputDir, 0755); err != nil {
			return fmt.Errorf("failed to create output directory: %w", err)
		}
	} else {
		return fmt.Errorf("failed to check output directory: %w", err)
	}

	return nil
}

func runAutoimg(ctx context.Context, flags *AutoimgFlags, imagePath string) error {
	fmt.Printf("Processing image: %s\n", imagePath)
	fmt.Printf("Output directory: %s\n", flags.OutputDir)

	// Check and prepare output directory (skip in plan mode)
	if !flags.Plan {
		if err := checkOutputDirectory(flags.OutputDir, flags.Overwrite); err != nil {
			return err
		}
	}

	// Step 1: Download and extract OCI image
	fmt.Println("Step 1: Downloading and extracting OCI image...")
	imageInfo, err := downloadAndExtractImage(ctx, imagePath, flags.Username, flags.Password)
	if err != nil {
		return fmt.Errorf("failed to download and extract image: %w", err)
	}

	// Step 2: Generate SBOM
	fmt.Println("Step 2: Generating SBOM...")
	sbomData, err := generateSBOM(ctx, imageInfo, flags.OutputDir)
	if err != nil {
		return fmt.Errorf("failed to generate SBOM: %w", err)
	}

	// Step 3: Filter SBOM to minimal requirements
	fmt.Println("Step 3: Filtering SBOM to minimal requirements...")
	filteredSBOM, err := filterSBOM(ctx, sbomData, imageInfo, flags.OutputDir)
	if err != nil {
		return fmt.Errorf("failed to filter SBOM: %w", err)
	}

	// Step 4: Check package availability
	fmt.Println("Step 4: Checking package availability...")
	var missingPackages []MissingPackage
	var availablePackages []SBOMPackage

	if flags.SkipAPICheck {
		fmt.Println("    Skipping API check (--skip-api-check enabled)")
		// Treat all packages as missing when skipping API check
		for _, pkg := range filteredSBOM.Packages {
			missingPackages = append(missingPackages, MissingPackage{
				Name:    pkg.Name,
				Version: pkg.Version,
				Type:    pkg.Type,
			})
		}
	} else {
		var err error
		missingPackages, err = checkPackageAvailability(ctx, filteredSBOM, flags.APIEndpoint)
		if err != nil {
			return fmt.Errorf("failed to check package availability: %w", err)
		}

		// Build list of available packages
		missingMap := make(map[string]bool)
		for _, pkg := range missingPackages {
			missingMap[pkg.Name] = true
		}

		for _, pkg := range filteredSBOM.Packages {
			if !missingMap[pkg.Name] {
				availablePackages = append(availablePackages, pkg)
			}
		}
	}

	// If plan mode, show the plan and exit
	if flags.Plan {
		fmt.Println("\n=== PACKAGE PLAN ===")

		fmt.Printf("\nPackages available in upstream repository (%d):\n", len(availablePackages))
		if len(availablePackages) == 0 {
			fmt.Println("  (none)")
		} else {
			for _, pkg := range availablePackages {
				fmt.Printf("  ✓ %s-%s\n", pkg.Name, pkg.Version)
			}
		}

		fmt.Printf("\nPackages that need to be built with melange (%d):\n", len(missingPackages))
		if len(missingPackages) == 0 {
			fmt.Println("  (none)")
		} else {
			for _, pkg := range missingPackages {
				fmt.Printf("  ⚠ %s-%s\n", pkg.Name, pkg.Version)
			}
		}

		fmt.Printf("\nTotal packages: %d\n", len(filteredSBOM.Packages))
		fmt.Printf("Available: %d (%.1f%%)\n", len(availablePackages), float64(len(availablePackages))/float64(len(filteredSBOM.Packages))*100)
		fmt.Printf("Missing: %d (%.1f%%)\n", len(missingPackages), float64(len(missingPackages))/float64(len(filteredSBOM.Packages))*100)

		return nil
	}

	// Step 5: Generate melange YAML for missing packages
	if len(missingPackages) > 0 {
		fmt.Printf("Step 5: Generating melange YAML for %d missing packages...\n", len(missingPackages))
		if err := generateMelangeConfigs(ctx, missingPackages, flags.OutputDir); err != nil {
			return fmt.Errorf("failed to generate melange configs: %w", err)
		}
	} else {
		fmt.Println("Step 5: All packages available in CVE0 database, skipping melange generation")
	}

	// Step 6: Generate APKO configurations
	fmt.Println("Step 6: Generating APKO configurations...")
	if err := generateAPKOConfigs(ctx, imageInfo, filteredSBOM, flags.OutputDir); err != nil {
		return fmt.Errorf("failed to generate APKO configs: %w", err)
	}

	// Step 7: Validate generated image matches original (unless skipped)
	if !flags.SkipValidation {
		fmt.Println("Step 7: Validating generated image matches original...")
		if err := validateImageMatch(ctx, imageInfo, flags.OutputDir); err != nil {
			return fmt.Errorf("validation failed: %w", err)
		}
		fmt.Println("✓ Validation successful!")
	}

	fmt.Println("✓ Autoimg process completed successfully!")
	return nil
}

// Data structures
type ImageInfo struct {
	Registry   string
	Repository string
	Tag        string
	Digest     string
	Entrypoint []string
	Cmd        []string
	Env        []string
	Args       []string
	WorkingDir string
	User       string
}

type SBOMData struct {
	Raw      string
	Packages []SBOMPackage
}

type SBOMPackage struct {
	Name    string
	Version string
	Type    string
}

type FilteredSBOM struct {
	Packages []SBOMPackage
}

type MissingPackage struct {
	Name    string
	Version string
	Type    string
}
