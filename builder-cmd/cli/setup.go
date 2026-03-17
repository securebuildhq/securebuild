package cli

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/spf13/cobra"
	"go.uber.org/zap"
)

// SetupCmd returns the "setup" subcommand. It prepares the work dir for a local backend
// (e.g. generates melange signing key). Static/CMX backends get this from pool.installBuildEnv.
func SetupCmd() *cobra.Command {
	var workDir string

	setupCmd := &cobra.Command{
		Use:   "setup",
		Short: "Prepare work dir for local backend (e.g. melange signing key)",
		Long:  `Runs setup steps that static/CMX VMs get from pool.installBuildEnv. Used only for local backend.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runSetup(workDir)
		},
	}

	setupCmd.Flags().StringVar(&workDir, "work-dir", "", "Working directory (required)")
	_ = setupCmd.MarkFlagRequired("work-dir")

	return setupCmd
}

func runSetup(workDir string) error {
	if workDir == "" {
		return fmt.Errorf("work-dir is required")
	}

	abs, err := filepath.Abs(workDir)
	if err != nil {
		return fmt.Errorf("failed to resolve work-dir: %w", err)
	}

	if err := os.Chdir(abs); err != nil {
		return fmt.Errorf("failed to chdir to work-dir %s: %w", abs, err)
	}

	// Generate melange signing key so "melange build --signing-key local-melange.rsa" can find it.
	logger.Info("generating melange signing key for local backend", zap.String("workDir", abs))
	keygen := exec.Command("melange", "keygen", "local-melange.rsa")
	keygen.Dir = abs
	output, err := keygen.CombinedOutput()
	if err != nil {
		return fmt.Errorf("melange keygen failed: %w (output: %s)", err, string(output))
	}

	logger.Info("builder setup completed", zap.String("workDir", abs))
	return nil
}
