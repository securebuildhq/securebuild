package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/securebuildhq/securebuild/pkg/apk"
	"github.com/securebuildhq/securebuild/pkg/dynamicparam"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/storage"
	"go.uber.org/zap"
	// OCI spec types
)

func StartAddAPK(ctx context.Context) error {
	// Force a rebuild on startup to catch any missed updates
	// and fix any previous indexing errors
	// logger.Info("rebuilding apk index for x86_64 on startup")
	// if err := RebuildAPKIndex(ctx, "x86_64"); err != nil {
	// 	logger.Errorf("failed to rebuild apk index for x86_64: %w", err)
	// }
	// logger.Info("rebuilding apk index for aarch64 on startup")
	// if err := RebuildAPKIndex(ctx, "aarch64"); err != nil {
	// 	logger.Errorf("failed to rebuild apk index for aarch64: %w", err)
	// }

	for {
		hasMoreX86 := false

		if err := handleWithdrawAPK(ctx); err != nil {
			logger.Errorf("failed to handle withdraw apk: %w", err)
		}

		hasMore, err := HandleAddApk(ctx, "x86_64")
		if err != nil {
			logger.Errorf("failed to handle add x86_64 apk: %w", err)
		}
		hasMoreX86 = hasMore

		hasMoreAarch64, err := HandleAddApk(ctx, "aarch64")
		if err != nil {
			logger.Errorf("failed to handle add aarch64 apk: %w", err)
		}
		hasMore = hasMoreX86 || hasMoreAarch64

		if hasMoreAarch64 || hasMoreX86 {
			time.Sleep(time.Second * 10)
		} else {
			time.Sleep(time.Second * 10)
		}
	}
}

func handleWithdrawAPK(ctx context.Context) error {
	if err := handleWithdrawAPKForArch(ctx, "x86_64"); err != nil {
		return fmt.Errorf("failed to handle withdraw apk for x86_64: %w", err)
	}

	if err := handleWithdrawAPKForArch(ctx, "aarch64"); err != nil {
		return fmt.Errorf("failed to handle withdraw apk for aarch64: %w", err)
	}

	return nil
}

func handleWithdrawAPKForArch(ctx context.Context, arch string) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT filename FROM apk_catalog WHERE is_withdrawn = true AND arch = $1 LIMIT 50`
	rows, err := conn.Query(ctx, query, arch)
	if err != nil {
		return fmt.Errorf("failed to query apk catalog: %w", err)
	}
	defer rows.Close()

	filenames := []string{}
	for rows.Next() {
		var filename string
		if err := rows.Scan(&filename); err != nil {
			return fmt.Errorf("failed to scan apk catalog: %w", err)
		}
		filenames = append(filenames, filename)
	}
	rows.Close()

	if len(filenames) == 0 {
		return nil
	}

	logger.Debug("withdrawing apk", zap.String("arch", arch), zap.Strings("filenames", filenames))

	if err := dynamicparam.EnsureDynamicParams(ctx); err != nil {
		return fmt.Errorf("failed to ensure dynamic params: %w", err)
	}

	if err := apk.WithdrawAPKs(ctx, filenames, arch); err != nil {
		return fmt.Errorf("failed to withdraw apk: %w", err)
	}

	return nil
}

func HandleAddApk(ctx context.Context, arch string) (bool, error) {
	if err := dynamicparam.EnsureDynamicParams(ctx); err != nil {
		return false, fmt.Errorf("failed to ensure dynamic params: %w", err)
	}

	apkPublishedEvents, hasMore, err := apk.ListUploadedAPKsInExecutionBucket(ctx, arch)
	if err != nil {
		return false, fmt.Errorf("failed to list apk catalog items: %w", err)
	}

	if len(apkPublishedEvents) == 0 {
		return false, nil
	}

	currentAPKIndexFile, err := apk.GetAPKIndex(ctx, arch)
	if err != nil {
		return hasMore, fmt.Errorf("failed to get apk index: %w", err)
	}

	// Track temp files to clean up
	tempFilesToCleanup := []string{}
	if currentAPKIndexFile != "" {
		tempFilesToCleanup = append(tempFilesToCleanup, currentAPKIndexFile)
	}

	// Ensure cleanup of all temp files at the end
	defer func() {
		for _, tempFile := range tempFilesToCleanup {
			if err := os.Remove(tempFile); err != nil && !os.IsNotExist(err) {
				logger.Warn("failed to remove temp APK index file", zap.String("file", tempFile), zap.Error(err))
			}
		}
	}()

	for _, apkPublishedEvent := range apkPublishedEvents {
		logger.Debug("processing apk published event", zap.String("apk_filename", apkPublishedEvent.APKFilename))
		updatedAPKIndexFile, err := apk.AddAPKToIndex(ctx, apkPublishedEvent.PKGInfo, currentAPKIndexFile)
		if err != nil {
			return hasMore, fmt.Errorf("failed to add apk to index: %w", err)
		}

		if err := apk.AddAPKToCatalogTable(ctx, apkPublishedEvent.APKFilename, apkPublishedEvent.Arch, apkPublishedEvent.PKGInfo); err != nil {
			return hasMore, fmt.Errorf("failed to add apk to catalog table: %w", err)
		}

		// If a new temp file was created, track it for cleanup and remove the old one from tracking
		if updatedAPKIndexFile != currentAPKIndexFile && updatedAPKIndexFile != "" {
			tempFilesToCleanup = append(tempFilesToCleanup, updatedAPKIndexFile)
		}
		currentAPKIndexFile = updatedAPKIndexFile
	}

	if err := apk.SignAPKIndex(ctx, currentAPKIndexFile); err != nil {
		return hasMore, fmt.Errorf("failed to sign apk index: %w", err)
	}

	if err := apk.UploadAPKIndex(ctx, currentAPKIndexFile, arch); err != nil {
		return hasMore, fmt.Errorf("failed to upload apk index: %w", err)
	}

	keysToDelete := []string{}
	for key := range apkPublishedEvents {
		keysToDelete = append(keysToDelete, key)
	}

	if err := apk.DeletePublishedEventsFromR2(ctx, keysToDelete); err != nil {
		return hasMore, fmt.Errorf("failed to delete apk: %w", err)
	}

	return hasMore, nil
}

func GetAPKStream(ctx context.Context, apkFilename string, arch string) (*s3.GetObjectOutput, error) {
	// Create R2 client (dynamic folder retrieved automatically)
	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2BucketName)
	if err != nil {
		return nil, fmt.Errorf("failed to create R2 client: %w", err)
	}

	// Build the key for the APK file
	key := fmt.Sprintf("%s/%s", arch, apkFilename)

	// Get the object from R2
	result, err := r2Client.GetObject(ctx, key)
	if err != nil {
		// Check if the error is because the object doesn't exist
		var noSuchKey *types.NoSuchKey
		if errors.As(err, &noSuchKey) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get object from R2: %w", err)
	}

	return result, nil
}

func RebuildAPKIndex(ctx context.Context, arch string) error {
	logger.Debug("rebuilding apk index", zap.String("arch", arch))

	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `select index_content, filename from apk_catalog where arch = $1`
	rows, err := conn.Query(ctx, query, arch)
	if err != nil {
		return fmt.Errorf("failed to query apk catalog: %w", err)
	}
	defer rows.Close()

	index := map[string]map[string]string{}
	for rows.Next() {
		var indexContent string
		var filename string
		if err := rows.Scan(&indexContent, &filename); err != nil {
			return fmt.Errorf("failed to scan apk catalog: %w", err)
		}

		unmarahaled := map[string]string{}
		if err := json.Unmarshal([]byte(indexContent), &unmarahaled); err != nil {
			return fmt.Errorf("failed to unmarshal index content: %w", err)
		}
		index[filename] = unmarahaled
	}

	rows.Close()

	currentIndexFile, err := os.CreateTemp("", "apkindex-rebuild-*.tar.gz")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	defer currentIndexFile.Close()

	indexFilename := currentIndexFile.Name()

	for _, indexContent := range index {
		updatedAPKIndexFile, err := apk.AddAPKToIndex(ctx, indexContent, indexFilename)
		if err != nil {
			return fmt.Errorf("failed to add apk to index: %w", err)
		}

		indexFilename = updatedAPKIndexFile
	}

	if err := apk.SignAPKIndex(ctx, indexFilename); err != nil {
		return fmt.Errorf("failed to sign apk index: %w", err)
	}

	if err := apk.UploadAPKIndex(ctx, indexFilename, arch); err != nil {
		return fmt.Errorf("failed to upload apk index: %w", err)
	}

	os.RemoveAll(indexFilename)

	return nil
}
