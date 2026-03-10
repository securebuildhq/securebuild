package apk

import (
	"context"
	"fmt"
	"os"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/storage"
	"go.uber.org/zap"
)

func UploadAPKIndex(ctx context.Context, apkIndexFile string, arch string) error {
	logger.Debug("starting upload", zap.String("apkIndexFile", apkIndexFile), zap.String("arch", arch))

	// Create R2 client (dynamic folder retrieved automatically)
	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2BucketName)
	if err != nil {
		return fmt.Errorf("failed to create R2 client: %w", err)
	}

	// Open the APK index file
	file, err := os.Open(apkIndexFile)
	if err != nil {
		return fmt.Errorf("failed to open apk index file: %w", err)
	}
	defer file.Close()

	// Upload the file to R2
	key := fmt.Sprintf("%s/%s", arch, "APKINDEX.tar.gz")
	if err := r2Client.PutObject(ctx, key, file); err != nil {
		return fmt.Errorf("failed to upload apk index to R2: %w", err)
	}

	logger.Info("uploadAPKIndex: successfully uploaded", zap.String("key", key), zap.String("arch", arch))
	return nil
}
