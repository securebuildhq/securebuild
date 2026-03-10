package anchore

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	dbinstall "github.com/anchore/grype/grype/db/v6/installation"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

// ImportGrypeDatabase imports a built database into Grype's cache using the curator
func ImportGrypeDatabase(ctx context.Context, grypeDBRoot, dbArchivePath string) error {
	// Verify the database file exists
	if _, err := os.Stat(dbArchivePath); os.IsNotExist(err) {
		return fmt.Errorf("database file not found at %s", dbArchivePath)
	}

	// Ensure grypeDBRoot directory exists
	if err := os.MkdirAll(grypeDBRoot, 0755); err != nil {
		return fmt.Errorf("failed to create grypeDBRoot directory: %w", err)
	}

	logger.Info("importing database into grype", zap.String("path", dbArchivePath))

	// Create a curator for database management
	curator, err := dbinstall.NewCurator(
		dbinstall.Config{
			DBRootDir:               filepath.Join(grypeDBRoot, "cache"),
			ValidateAge:             false,
			ValidateChecksum:        false,
			MaxAllowedBuiltAge:      0,
			UpdateCheckMaxFrequency: 24 * time.Hour,
		},
		nil, // No downloader needed for import
	)
	if err != nil {
		return fmt.Errorf("failed to create curator: %w", err)
	}

	// Import the database
	if err := curator.Import(dbArchivePath); err != nil {
		return fmt.Errorf("failed to import database: %w", err)
	}

	logger.Info("successfully imported database into grype")
	return nil
}
