package scan

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/securebuildhq/securebuild/pkg/anchore"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"go.uber.org/zap"
)

// StartDatabaseUpdater starts a background goroutine that periodically updates
// the CUSTOM Grype vulnerability database using Vunnel and grype-db
//
// This custom database is used for:
// - SecDB feed generation (cve_package_fix table)
// - Tracking which package versions fix which CVEs
// - Includes: NVD + GitHub providers ONLY (no SecureOS)
// - Used with: useCustomDB=true flag
//
// The standard Grype database (used for WWW display) automatically includes
// all providers including SecureOS, which consumes our secdb feed.
// It is used with: useCustomDB=false flag
func StartDatabaseUpdater(ctx context.Context) error {
	logger.Info("Starting vulnerability database updater")

	// Get configuration from Doppler
	grypeDBRoot := param.GetParam(ctx).GrypeDBRoot
	if grypeDBRoot == "" {
		logger.Info("GRYPE_DATABASE_ROOT not configured, database updater will not run")
		return nil
	}

	// Convert to absolute path if relative
	absGrypeDBRoot, err := filepath.Abs(grypeDBRoot)
	if err != nil {
		return fmt.Errorf("failed to get absolute path for GRYPE_DATABASE_ROOT: %w", err)
	}
	grypeDBRoot = absGrypeDBRoot

	logger.Info("Using grype database root", zap.String("grype_db_root", grypeDBRoot))

	// Check if vunnel config exists
	vunnelConfig := filepath.Join(grypeDBRoot, "vunnel.yaml")
	if _, err := os.Stat(vunnelConfig); os.IsNotExist(err) {
		logger.Info("Vunnel config not found, database updater will not run", zap.String("config_path", vunnelConfig))
		return nil
	}

	// Run initial update immediately
	logger.Info("Running initial vulnerability database update")
	if err := updateDatabase(ctx, grypeDBRoot); err != nil {
		logger.Warn("initial database update failed, will retry on next cycle", zap.Error(err))
		// Continue anyway - the updater will retry on the next cycle
	}

	// Start periodic update loop (every 1 hour)
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			logger.Info("Database updater stopped")
			return nil
		case <-ticker.C:
			logger.Info("Starting scheduled vulnerability database update")
			if err := updateDatabase(ctx, grypeDBRoot); err != nil {
				logger.Warn("scheduled database update failed, will retry on next cycle", zap.Error(err))
				// Continue running - will retry on next cycle
			}
		}
	}
}

// updateDatabase runs the full database update pipeline:
// 1. Run vunnel to download CVE data from NVD and GitHub
// 2. Run grype-db to build the SQLite database
// 3. Atomically swap the new database into place
func updateDatabase(ctx context.Context, grypeDBRoot string) error {
	startTime := time.Now()
	logger.Info("Starting vulnerability database update")

	dataDir := filepath.Join(grypeDBRoot, "data")

	// Step 1: Run vunnel for NVD provider
	logger.Info("Running vunnel for NVD provider")
	if err := runVunnel(ctx, grypeDBRoot, "nvd"); err != nil {
		return fmt.Errorf("vunnel nvd failed: %w", err)
	}

	// Step 2: Run vunnel for GitHub provider
	logger.Info("Running vunnel for GitHub provider")
	if err := runVunnel(ctx, grypeDBRoot, "github"); err != nil {
		return fmt.Errorf("vunnel github failed: %w", err)
	}

	// Step 3: Build grype database
	logger.Info("Building grype database from vunnel data")
	builtDBPath := filepath.Join(dataDir, "vulnerability.db")
	if err := buildGrypeDB(ctx, grypeDBRoot); err != nil {
		return fmt.Errorf("grype-db build failed: %w", err)
	}

	// Step 4: Import database into grype using anchore package
	logger.Info("Importing database into grype")
	if err := anchore.ImportGrypeDatabase(ctx, grypeDBRoot, builtDBPath); err != nil {
		return fmt.Errorf("grype db import failed: %w", err)
	}

	duration := time.Since(startTime)
	logger.Info("Vulnerability database update completed",
		zap.String("duration", duration.String()))

	return nil
}

// defaultVunnelImage is the default container image used to run vunnel.
// Override via the VUNNEL_IMAGE param to pin a different version.
const defaultVunnelImage = "ghcr.io/anchore/vunnel:v0.55.3"

// runVunnel executes vunnel for a specific provider inside a container.
// The grypeDBRoot directory is mounted into the container so vunnel can
// read its config and write provider data.
func runVunnel(ctx context.Context, grypeDBRoot, provider string) error {
	image := param.GetParam(ctx).VunnelImage
	if image == "" {
		image = defaultVunnelImage
	}

	// Mount the entire grypeDBRoot as /data inside the container.
	// The config file path needs to be translated to the container path.
	containerDataDir := "/data"
	containerConfigPath := containerDataDir + "/vunnel.yaml"

	// Use a static container name per provider to ensure only one instance
	// runs at a time. If a previous run is still active, docker will refuse
	// to start a second container with the same name.
	containerName := "vunnel-" + provider

	cmd := exec.CommandContext(ctx, "docker", "run",
		"--rm",
		"--name", containerName,
		"-v", grypeDBRoot+":"+containerDataDir,
		image,
		"--config", containerConfigPath,
		"run",
		provider,
	)

	logger.Info("running vunnel in container",
		zap.String("image", image),
		zap.String("container", containerName),
		zap.String("provider", provider),
		zap.String("mount", grypeDBRoot+":"+containerDataDir))

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("vunnel %s failed: %w (output: %s)", provider, err, string(output))
	}

	logger.Info("vunnel completed successfully",
		zap.String("provider", provider),
		zap.String("output", string(output)))

	return nil
}

// buildGrypeDB executes grype-db to build the vulnerability database
func buildGrypeDB(ctx context.Context, grypeDBRoot string) error {
	cmd := exec.CommandContext(ctx, "grype-db",
		"build",
		"-d", "data",
		"-g", // Generate grype-compatible database
		"-p", "nvd",
		"-p", "github",
	)

	// Set working directory to the grypeDBRoot directory
	cmd.Dir = grypeDBRoot

	logger.Info("running grype-db command",
		zap.String("command", cmd.String()),
		zap.String("grype_db_root", grypeDBRoot))

	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("grype-db build failed: %w (output: %s)", err, string(output))
	}

	logger.Info("grype-db build completed successfully",
		zap.String("grype_db_root", grypeDBRoot),
		zap.String("output", string(output)))

	return nil
}
