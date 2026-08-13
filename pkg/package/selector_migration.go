package sbpackage

import (
	"context"
	"errors"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
)

type SelectorMigrationOptions struct {
	DryRun bool
}

type SelectorMigrationResult struct {
	PackageVersions int
	DependencyRows  int64
	ProvidesRows    int64
	Unmatched       int
	Failed          int
}

// BackfillPackageSelectors reconstructs dependency_spec and provides_spec from
// the immutable Melange YAML stored on top-level package versions with missing
// selector data. Work is committed per version, so reruns skip completed rows.
func BackfillPackageSelectors(ctx context.Context, opts SelectorMigrationOptions) (SelectorMigrationResult, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	rows, err := conn.Query(ctx, `
		SELECT pv.id, pv.melange_yaml
		FROM package_version pv
		JOIN package p ON p.id = pv.package_id
		WHERE p.parent_id IS NULL
		  AND pv.melange_yaml IS NOT NULL
		  AND pv.melange_yaml != ''
		  AND (
			EXISTS (SELECT 1 FROM package_version_dependency_runtime d WHERE d.package_version_id = pv.id AND COALESCE(d.dependency_spec, '') = '')
			OR EXISTS (SELECT 1 FROM package_version_dependency_buildtime d WHERE d.package_version_id = pv.id AND COALESCE(d.dependency_spec, '') = '')
			OR EXISTS (SELECT 1 FROM package_version_provides pr WHERE pr.package_version_id = pv.id AND COALESCE(pr.provides_spec, '') = '')
		  )
		ORDER BY pv.created_at, pv.id
	`)
	if err != nil {
		return SelectorMigrationResult{}, fmt.Errorf("list package versions for selector migration: %w", err)
	}
	defer rows.Close()

	type migrationCandidate struct{ id, yaml string }
	var candidates []migrationCandidate
	for rows.Next() {
		var candidate migrationCandidate
		if err := rows.Scan(&candidate.id, &candidate.yaml); err != nil {
			return SelectorMigrationResult{}, fmt.Errorf("scan selector migration candidate: %w", err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return SelectorMigrationResult{}, fmt.Errorf("iterate selector migration candidates: %w", err)
	}
	rows.Close()

	result := SelectorMigrationResult{}
	for _, candidate := range candidates {
		result.PackageVersions++
		compiled, err := CompileMelangeYAML(ctx, []byte(candidate.yaml))
		if err != nil {
			result.Failed++
			if errors.Is(err, ErrInvalidMelangeConfig) && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
				logger.Warn("skipping package version with invalid Melange configuration during selector migration",
					zap.String("packageVersionId", candidate.id), zap.Error(err))
				continue
			}
			return result, fmt.Errorf("prepare package version %s for selector migration: %w", candidate.id, err)
		}
		if opts.DryRun {
			result.DependencyRows += int64(len(compiled.Package.Dependencies.Runtime) + len(compiled.Environment.Contents.Packages))
			result.ProvidesRows += int64(len(extractProvidesFromConfig(compiled)))
			continue
		}

		tx, err := conn.Begin(ctx)
		if err != nil {
			return result, fmt.Errorf("begin selector migration transaction: %w", err)
		}
		var migrationErr error
		var dependencyRows, providesRows int64
		for table, specs := range map[string][]string{
			"package_version_dependency_runtime":   compiled.Package.Dependencies.Runtime,
			"package_version_dependency_buildtime": compiled.Environment.Contents.Packages,
		} {
			for _, spec := range specs {
				name, _, resolveErr := GetPackageInfoWithParentRedirection(ctx, tx, spec)
				if resolveErr != nil {
					migrationErr = resolveErr
					break
				}
				command := fmt.Sprintf(`UPDATE %s SET dependency_spec = $1 WHERE package_version_id = $2 AND depends_on_package_name = $3 AND COALESCE(dependency_spec, '') = ''`, table)
				tag, updateErr := tx.Exec(ctx, command, spec, candidate.id, name)
				if updateErr != nil {
					migrationErr = updateErr
					break
				}
				if tag.RowsAffected() > 0 {
					dependencyRows += tag.RowsAffected()
				}
			}
			if migrationErr != nil {
				break
			}
		}
		if migrationErr == nil {
			for _, entry := range extractProvidesFromConfig(compiled) {
				tag, updateErr := tx.Exec(ctx, `
					UPDATE package_version_provides
					SET provides_spec = $1
					WHERE package_version_id = $2 AND package_name = $3 AND provides_name = $4
					  AND COALESCE(provides_spec, '') = ''
				`, entry.ProvidesSpec, candidate.id, entry.PackageName, entry.ProvidesName)
				if updateErr != nil {
					migrationErr = updateErr
					break
				}
				if tag.RowsAffected() > 0 {
					providesRows += tag.RowsAffected()
				}
			}
		}
		if migrationErr != nil {
			_ = tx.Rollback(ctx)
			result.Failed++
			return result, fmt.Errorf("backfill selectors for package version %s: %w", candidate.id, migrationErr)
		}
		var remainingMissing int
		if err := tx.QueryRow(ctx, `
			SELECT
				(SELECT count(*) FROM package_version_dependency_runtime WHERE package_version_id = $1 AND COALESCE(dependency_spec, '') = '') +
				(SELECT count(*) FROM package_version_dependency_buildtime WHERE package_version_id = $1 AND COALESCE(dependency_spec, '') = '') +
				(SELECT count(*) FROM package_version_provides WHERE package_version_id = $1 AND COALESCE(provides_spec, '') = '')
		`, candidate.id).Scan(&remainingMissing); err != nil {
			_ = tx.Rollback(ctx)
			result.Failed++
			return result, fmt.Errorf("count remaining selectors for package version %s: %w", candidate.id, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return result, fmt.Errorf("commit selector migration for %s: %w", candidate.id, err)
		}
		result.DependencyRows += dependencyRows
		result.ProvidesRows += providesRows
		result.Unmatched += remainingMissing
	}
	return result, nil
}
