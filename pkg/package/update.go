package sbpackage

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"chainguard.dev/melange/pkg/config"
	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/package/types"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/tuvistavie/securerandom"
	"go.uber.org/zap"
)

var (
	ErrPackageDowngrade = errors.New("package downgrade")
)

func UpdatePackage(ctx context.Context, packageID string, melangeYAML []byte, encodedAdditionalFilesData *string) error {
	compiled, err := CompileMelangeYAML(ctx, melangeYAML)
	if err != nil {
		return fmt.Errorf("compile melange yaml: %w", err)
	}

	currentPackage, err := GetPackage(ctx, packageID)
	if err != nil {
		return fmt.Errorf("get package: %w", err)
	}

	latestVersion, err := GetLatestPackageVersion(ctx, packageID)
	if err != nil {
		return fmt.Errorf("get latest package version: %w", err)
	}

	if compiled.Package.Name != currentPackage.Name {
		return fmt.Errorf("package name mismatch: %s != %s", compiled.Package.Name, currentPackage.Name)
	}

	versionsMatch := compiled.Package.Version == latestVersion.Version
	epochsMatch := compiled.Package.Epoch == uint64(latestVersion.APKRelease)

	if versionsMatch && compiled.Package.Epoch < uint64(latestVersion.APKRelease) {
		logger.Info("package downgrade detected, not updating",
			zap.String("package_name", compiled.Package.Name),
			zap.String("current_version", latestVersion.Version),
			zap.Int("current_epoch", latestVersion.APKRelease),
			zap.Int("new_epoch", int(compiled.Package.Epoch)),
		)
		return ErrPackageDowngrade
	}

	if versionsMatch && epochsMatch {
		return ErrPackageAtLatestVersion
	}

	return updatePackage(ctx, currentPackage, latestVersion, string(melangeYAML), compiled, encodedAdditionalFilesData)
}

func updatePackage(ctx context.Context, currentPackage *types.Package, currentVersion *types.PackageVersion, melangeYAML string, compiled *config.Configuration, encodedAdditionalFilesData *string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var additionalFiles []types.AdditionalFile
	if encodedAdditionalFilesData != nil {
		decodedAdditionalFilesData, err := base64.StdEncoding.DecodeString(*encodedAdditionalFilesData)
		if err != nil {
			return fmt.Errorf("parse additional files: %w", err)
		}

		af, err := parseAdditionalFiles(ctx, decodedAdditionalFilesData)
		if err != nil {
			return fmt.Errorf("parse additional files: %w", err)
		}

		additionalFiles = af
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	newVersionID, err := securerandom.Hex(32)
	if err != nil {
		return fmt.Errorf("generate random id for new version: %w", err)
	}
	now := time.Now()

	var license *string
	for _, copyright := range compiled.Package.Copyright {
		license = &copyright.License
		break
	}

	_, err = tx.Exec(ctx, `
	INSERT INTO package_version (id, package_id, version, melange_yaml, created_at, updated_at, apk_release, license, use_root, custom_disk_size)
	VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`, newVersionID, currentPackage.ID, compiled.Package.Version, melangeYAML, now, now, compiled.Package.Epoch, license, currentVersion.UseRoot, currentVersion.CustomDiskSize)
	if err != nil {
		return fmt.Errorf("insert new package version: %w", err)
	}

	// Extract and write dependencies for the new version
	newPackageVersion, err := getPackageVersionWithTx(ctx, tx, newVersionID)
	if err != nil {
		return fmt.Errorf("get new package version: %w", err)
	}

	if err := WritePackageVersionDependencies(ctx, tx, newPackageVersion); err != nil {
		return fmt.Errorf("write package version dependencies: %w", err)
	}

	for _, additionalFile := range additionalFiles {
		if err := CreateAdditionalFile(ctx, tx, newVersionID, additionalFile.Path, []byte(additionalFile.Content)); err != nil {
			return fmt.Errorf("create additional file: %w", err)
		}
	}

	// subpackages
	for _, subpackage := range compiled.Subpackages {
		if err := updateSubpackage(ctx, tx, currentPackage.ID, subpackage, int(compiled.Package.Epoch), license, compiled.Package.Version, currentVersion.UseRoot, currentVersion.CustomDiskSize, compiled); err != nil {
			return fmt.Errorf("update subpackage: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	// Enqueue GitHub sync after successfully updating package specs
	if err := persistence.EnqueueWork(ctx, "github_sync", []byte("{}")); err != nil {
		logger.Warn("failed to enqueue GitHub sync after package update", zap.Error(err))
	}

	return nil
}

func updateSubpackage(ctx context.Context, tx pgx.Tx, mainPackageID string, subpackage config.Subpackage, apkRelease int, license *string, version string, useRoot bool, customDiskSize *int, compiled *config.Configuration) error {
	now := time.Now()

	pkgID, err := ensurePackageRecord(ctx, tx, subpackage.Name, &mainPackageID, now)
	if err != nil {
		return fmt.Errorf("ensure subpackage record: %w", err)
	}

	_, err = ensurePackageVersionRecord(ctx, tx, pkgID, version, nil, now, license, apkRelease, useRoot, customDiskSize, compiled)
	if err != nil {
		return fmt.Errorf("ensure subpackage version record: %w", err)
	}

	return nil
}

func parseAdditionalFiles(ctx context.Context, additionalFilesData []byte) ([]types.AdditionalFile, error) {
	// additionalFilesData is a tar.gz file, uncompress it and then read the files
	gzReader, err := gzip.NewReader(bytes.NewReader(additionalFilesData))
	if err != nil {
		return nil, fmt.Errorf("create gzip reader: %w", err)
	}
	defer gzReader.Close()

	additionalFiles := []types.AdditionalFile{}

	tarReader := tar.NewReader(gzReader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}

		if err != nil {
			return nil, fmt.Errorf("read tar header: %w", err)
		}

		// ignore directories
		if header.Typeflag == tar.TypeDir {
			continue
		}

		// Skip Mac OS X resource fork files
		if strings.HasPrefix(filepath.Base(header.Name), "._") {
			logger.Debug("skipping Mac OS X metadata file", zap.String("path", header.Name))
			continue
		}

		content, err := io.ReadAll(tarReader)
		if err != nil {
			return nil, fmt.Errorf("read tar content: %w", err)
		}

		// Clean the path - remove leading "./" or "."
		cleanPath := header.Name
		cleanPath = strings.TrimPrefix(cleanPath, "./")
		cleanPath = strings.TrimPrefix(cleanPath, ".")
		cleanPath = strings.TrimPrefix(cleanPath, "/")

		id, err := securerandom.Hex(32)
		if err != nil {
			return nil, fmt.Errorf("generate random id for additional file: %w", err)
		}

		additionalFiles = append(additionalFiles, types.AdditionalFile{
			ID:      id,
			Path:    cleanPath,
			Content: string(content),
		})
	}

	return additionalFiles, nil
}
