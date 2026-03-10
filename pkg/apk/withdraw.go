package apk

import (
	"context"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/dynamicparam"
	"github.com/securebuildhq/securebuild/pkg/persistence"
)

func WithdrawAPKs(ctx context.Context, filenames []string, arch string) error {
	if err := dynamicparam.EnsureDynamicParams(ctx); err != nil {
		return fmt.Errorf("failed to ensure dynamic params: %w", err)
	}

	apkIndexFile, err := GetAPKIndex(ctx, arch)
	if err != nil {
		return fmt.Errorf("failed to get apk index: %w", err)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	for _, filename := range filenames {
		pkgName, pkgVersion, pkgRel, err := ParseAPKFilename(filename)
		if err != nil {
			return fmt.Errorf("failed to parse apk filename: %w", err)
		}

		updatedAPKIndexFile, err := RemoveAPKFromIndex(ctx, pkgName, pkgVersion, pkgRel, apkIndexFile)
		if err != nil {
			return fmt.Errorf("failed to remove apk from index: %w", err)
		}

		apkIndexFile = updatedAPKIndexFile

		if err := DeleteAPKFromR2(ctx, filename, arch); err != nil {
			return fmt.Errorf("failed to delete apk from r2: %w", err)
		}

		query := `DELETE FROM apk_catalog WHERE filename = $1 and arch = $2 and is_withdrawn = true`
		_, err = conn.Exec(ctx, query, filename, arch)
		if err != nil {
			return fmt.Errorf("failed to delete apk from catalog table: %w", err)
		}
	}

	if err := SignAPKIndex(ctx, apkIndexFile); err != nil {
		return fmt.Errorf("failed to sign apk index: %w", err)
	}

	if err := UploadAPKIndex(ctx, apkIndexFile, arch); err != nil {
		return fmt.Errorf("failed to upload apk index: %w", err)
	}

	return nil
}

// WithdrawAPK is a local function to remove a single APK, useful when we are surgically removing something from the APK
func WithdrawAPK(ctx context.Context, filename string, arch string, packageName string, packageVersion string, packageRel string) error {
	if err := dynamicparam.EnsureDynamicParams(ctx); err != nil {
		return fmt.Errorf("failed to ensure dynamic params: %w", err)
	}

	apkIndexFile, err := GetAPKIndex(ctx, arch)
	if err != nil {
		return fmt.Errorf("failed to get apk index: %w", err)
	}

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	var pkgName string
	var pkgVersion string
	var pkgRel string

	if packageName != "" && packageVersion != "" && packageRel != "" {
		pkgName = packageName
		pkgVersion = packageVersion
		pkgRel = packageRel
	} else {
		pkgName, pkgVersion, pkgRel, err = ParseAPKFilename(filename)
		if err != nil {
			return fmt.Errorf("failed to parse apk filename: %w", err)
		}
	}

	updatedAPKIndexFile, err := RemoveAPKFromIndex(ctx, pkgName, pkgVersion, pkgRel, apkIndexFile)
	if err != nil {
		return fmt.Errorf("failed to remove apk from index: %w", err)
	}

	apkIndexFile = updatedAPKIndexFile

	if err := DeleteAPKFromR2(ctx, filename, arch); err != nil {
		return fmt.Errorf("failed to delete apk from r2: %w", err)
	}

	query := `DELETE FROM apk_catalog WHERE filename = $1 and arch = $2 and is_withdrawn = true`
	_, err = conn.Exec(ctx, query, filename, arch)
	if err != nil {
		return fmt.Errorf("failed to delete apk from catalog table: %w", err)
	}

	if err := SignAPKIndex(ctx, apkIndexFile); err != nil {
		return fmt.Errorf("failed to sign apk index: %w", err)
	}

	if err := UploadAPKIndex(ctx, apkIndexFile, arch); err != nil {
		return fmt.Errorf("failed to upload apk index: %w", err)
	}

	return nil
}
