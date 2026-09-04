package apk

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/storage"
	"go.uber.org/zap"
)

type ApkPublishedEvent struct {
	PKGInfo          map[string]string
	ExecutionID      string
	APKFilename      string
	Arch             string
	ExpectedAPKCount int
}

func AddAPKToCatalogTable(ctx context.Context, apkFilename string, arch string, indexContent map[string]string) error {
	logger.Debug("adding apk to catalog table", zap.String("apk_filename", apkFilename), zap.String("arch", arch))
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	b, err := json.Marshal(indexContent)
	if err != nil {
		return fmt.Errorf("marshal index content: %w", err)
	}

	query := `INSERT INTO apk_catalog (filename, arch, index_content) VALUES ($1, $2, $3) ON CONFLICT (filename, arch) DO UPDATE SET index_content = $3`
	_, err = conn.Exec(ctx, query, apkFilename, arch, b)
	if err != nil {
		return fmt.Errorf("add apk to catalog table: %w", err)
	}

	return nil
}

func ListUploadedAPKsInExecutionBucket(ctx context.Context, aarch string) (map[string]ApkPublishedEvent, bool, error) {
	// Create R2 client (dynamic folder retrieved automatically)
	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2BucketName)
	if err != nil {
		return nil, false, fmt.Errorf("failed to create R2 client: %w", err)
	}

	prefix := fmt.Sprintf("%s/%s", aarch, "executions")
	result, err := r2Client.ListObjects(ctx, prefix, 250)
	if err != nil {
		return nil, false, fmt.Errorf("failed to list objects in R2 bucket: %w", err)
	}

	// Check if there are more objects
	hasMore := result.IsTruncated != nil && *result.IsTruncated

	apkPublishedEvents := map[string]ApkPublishedEvent{}

	for _, obj := range result.Contents {
		if obj.Key == nil {
			continue
		}

		// Get the object from R2 (using fully qualified key)
		body, err := r2Client.GetObjectData(ctx, *obj.Key)
		if err != nil {
			return nil, false, fmt.Errorf("failed to get object from R2: %w", err)
		}

		apkPublishedEvent := ApkPublishedEvent{}
		if err := json.Unmarshal(body, &apkPublishedEvent); err != nil {
			return nil, false, fmt.Errorf("failed to unmarshal apk published event: %w", err)
		}

		apkPublishedEvents[*obj.Key] = apkPublishedEvent
	}

	return apkPublishedEvents, hasMore, nil
}

func DeletePublishedEventsFromR2(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil // Nothing to delete
	}

	// Create R2 client (dynamic folder retrieved automatically)
	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2BucketName)
	if err != nil {
		return fmt.Errorf("failed to create R2 client: %w", err)
	}

	// Delete objects (handles batching internally)
	if err := r2Client.DeleteObjects(ctx, keys); err != nil {
		return fmt.Errorf("failed to delete objects from R2 bucket: %w", err)
	}

	return nil
}

func DeleteAPKFromR2(ctx context.Context, apkFilename string, arch string) error {
	logger.Debug("deleting apk from r2",
		zap.String("apk_filename", apkFilename),
		zap.String("arch", arch),
	)

	// Create R2 client (dynamic folder retrieved automatically)
	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2BucketName)
	if err != nil {
		return fmt.Errorf("failed to create R2 client: %w", err)
	}

	// Pass relative path - DeleteObject will handle dynamic folder automatically
	key := fmt.Sprintf("%s/%s", arch, apkFilename)
	logger.Debug("deleting file from r2", zap.String("key", key))

	if err := r2Client.DeleteObject(ctx, key); err != nil {
		return fmt.Errorf("failed to delete object from R2 bucket: %w", err)
	}

	return nil
}
