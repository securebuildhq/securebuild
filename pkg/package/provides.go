package sbpackage

import (
	"context"
	"fmt"

	apkopackage "chainguard.dev/apko/pkg/apk/apk"
	"chainguard.dev/melange/pkg/config"
	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

// ProvidesEntry represents a single provides entry
type ProvidesEntry struct {
	PackageName  string
	ProvidesName string
	IsSubpackage bool
}

// ExtractProvidesFromMelangeYAML compiles the melange YAML and extracts provides data
func ExtractProvidesFromMelangeYAML(ctx context.Context, melangeYAML []byte) ([]ProvidesEntry, error) {
	compiled, err := CompileMelangeYAML(ctx, melangeYAML)
	if err != nil {
		return nil, fmt.Errorf("compile melange YAML: %w", err)
	}

	return extractProvidesFromConfig(compiled), nil
}

// extractProvidesFromConfig extracts provides entries from a compiled melange configuration
func extractProvidesFromConfig(compiled *config.Configuration) []ProvidesEntry {
	var entries []ProvidesEntry

	// Extract provides from main package
	if compiled.Package.Dependencies.Provides != nil && len(compiled.Package.Dependencies.Provides) > 0 {
		for _, provides := range compiled.Package.Dependencies.Provides {
			parsed := apkopackage.ResolvePackageNameVersionPin(provides)
			entries = append(entries, ProvidesEntry{
				PackageName:  compiled.Package.Name,
				ProvidesName: parsed.Name,
				IsSubpackage: false,
			})
		}
	}

	// Extract provides from subpackages
	for _, subpkg := range compiled.Subpackages {
		if subpkg.Dependencies.Provides != nil && len(subpkg.Dependencies.Provides) > 0 {
			for _, provides := range subpkg.Dependencies.Provides {
				parsed := apkopackage.ResolvePackageNameVersionPin(provides)
				entries = append(entries, ProvidesEntry{
					PackageName:  subpkg.Name,
					ProvidesName: parsed.Name,
					IsSubpackage: true,
				})
			}
		}
	}

	return entries
}

// WritePackageVersionProvides writes provides data to the database
func WritePackageVersionProvides(ctx context.Context, tx pgx.Tx, packageVersion *types.PackageVersion) error {
	// Delete existing provides records for this package version
	deleteQuery := `DELETE FROM package_version_provides WHERE package_version_id = $1`
	_, err := tx.Exec(ctx, deleteQuery, packageVersion.ID)
	if err != nil {
		return fmt.Errorf("delete existing provides: %w", err)
	}

	// Extract provides from melange YAML
	provides, err := ExtractProvidesFromMelangeYAML(ctx, []byte(packageVersion.MelangeYaml))
	if err != nil {
		return fmt.Errorf("extract provides from melange YAML: %w", err)
	}

	if len(provides) == 0 {
		return nil
	}

	logger.Debug("writing package version provides",
		zap.String("package_version_id", packageVersion.ID),
		zap.Int("provides_count", len(provides)),
		zap.Any("provides", provides))

	// Insert new provides records
	for _, entry := range provides {
		id, err := securerandom.Hex(32)
		if err != nil {
			return fmt.Errorf("generate id: %w", err)
		}

		insertQuery := `
			INSERT INTO package_version_provides
			(id, package_version_id, package_name, provides_name, is_subpackage)
			VALUES ($1, $2, $3, $4, $5)
		`
		_, err = tx.Exec(ctx, insertQuery,
			id,
			packageVersion.ID,
			entry.PackageName,
			entry.ProvidesName,
			entry.IsSubpackage,
		)
		if err != nil {
			return fmt.Errorf("insert provides: %w", err)
		}
	}

	return nil
}
