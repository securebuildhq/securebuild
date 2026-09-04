package apk

import (
	"context"
	"encoding/json"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/storage"
	"go.uber.org/zap"
)

type ApkPublishedEvent struct {
	PKGInfo          map[string]string `json:"pkgInfo"`
	ExecutionID      string            `json:"executionId"`
	APKFilename      string            `json:"apkFilename"`
	Arch             string            `json:"arch"`
	ExpectedAPKCount int               `json:"expectedAPKCount"`
	StagedAPKKey     string            `json:"stagedAPKKey"`
}

type PublicationArtifact struct {
	PKGInfo      map[string]string `json:"pkgInfo"`
	APKFilename  string            `json:"apkFilename"`
	Arch         string            `json:"arch"`
	StagedAPKKey string            `json:"stagedAPKKey"`
}

type PublicationManifest struct {
	ExecutionID string                `json:"executionId"`
	Arch        string                `json:"arch"`
	Artifacts   []PublicationArtifact `json:"artifacts"`
}

type PublicationManifestItem struct {
	Key           string
	Manifest      PublicationManifest
	Err           error
	Quarantinable bool
}

// ListPublicationManifestItems isolates object-level failures so one corrupt
// marker cannot prevent valid manifests in the same listing from being read.
func ListPublicationManifestItems(ctx context.Context, arch string) ([]PublicationManifestItem, bool, error) {
	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2BucketName)
	if err != nil {
		return nil, false, fmt.Errorf("create R2 client: %w", err)
	}
	result, err := r2Client.ListObjects(ctx, fmt.Sprintf("%s/publication-manifests", arch), 250)
	if err != nil {
		return nil, false, fmt.Errorf("list publication manifests: %w", err)
	}
	hasMore := result.IsTruncated != nil && *result.IsTruncated
	items := make([]PublicationManifestItem, 0, len(result.Contents))
	for _, object := range result.Contents {
		if object.Key == nil {
			continue
		}
		item := PublicationManifestItem{Key: *object.Key}
		body, err := r2Client.GetObjectData(ctx, *object.Key)
		if err != nil {
			item.Err = fmt.Errorf("read publication manifest %s: %w", *object.Key, err)
			items = append(items, item)
			continue
		}
		var manifest PublicationManifest
		if err := json.Unmarshal(body, &manifest); err != nil {
			item.Err = fmt.Errorf("decode publication manifest %s: %w", *object.Key, err)
			item.Quarantinable = true
			items = append(items, item)
			continue
		}
		if err := validatePublicationManifest(manifest, arch); err != nil {
			item.Err = fmt.Errorf("invalid publication manifest %s: %w", *object.Key, err)
			item.Quarantinable = true
			items = append(items, item)
			continue
		}
		item.Manifest = manifest
		items = append(items, item)
	}
	return items, hasMore, nil
}

func validatePublicationManifest(manifest PublicationManifest, arch string) error {
	if manifest.ExecutionID == "" || manifest.Arch != arch || len(manifest.Artifacts) == 0 {
		return fmt.Errorf("missing execution, architecture, or artifacts")
	}
	coordinates := map[string]struct{}{}
	for _, artifact := range manifest.Artifacts {
		if artifact.Arch != arch || artifact.APKFilename == "" || artifact.StagedAPKKey == "" || len(artifact.PKGInfo) == 0 {
			return fmt.Errorf("artifact is incomplete")
		}
		expectedPrefix := fmt.Sprintf("%s/staging/%s/", arch, manifest.ExecutionID)
		if !strings.HasPrefix(artifact.StagedAPKKey, expectedPrefix) || !strings.HasSuffix(artifact.StagedAPKKey, "/"+artifact.APKFilename) {
			return fmt.Errorf("artifact is outside its execution staging prefix")
		}
		coordinate := artifact.PKGInfo["pkgname"] + "\x00" + artifact.PKGInfo["pkgver"] + "\x00" + artifact.PKGInfo["pkgrel"]
		if _, exists := coordinates[coordinate]; exists {
			return fmt.Errorf("duplicate package coordinate")
		}
		coordinates[coordinate] = struct{}{}
	}
	return nil
}

func ListPublicationManifests(ctx context.Context, arch string) (map[string]PublicationManifest, bool, error) {
	items, hasMore, err := ListPublicationManifestItems(ctx, arch)
	if err != nil {
		return nil, hasMore, err
	}
	manifests := make(map[string]PublicationManifest, len(items))
	for _, item := range items {
		if item.Err != nil {
			return nil, hasMore, item.Err
		}
		manifests[item.Key] = item.Manifest
	}
	return manifests, hasMore, nil
}

func QuarantinePublicationManifest(ctx context.Context, arch, key string) error {
	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2BucketName)
	if err != nil {
		return fmt.Errorf("create R2 client: %w", err)
	}
	destination := fmt.Sprintf("%s/failed-publication-manifests/%s", arch, path.Base(key))
	if err := r2Client.CopyObject(ctx, key, destination); err != nil {
		return fmt.Errorf("copy manifest to quarantine: %w", err)
	}
	if err := r2Client.DeleteObject(ctx, key); err != nil {
		return fmt.Errorf("delete quarantined manifest from active queue: %w", err)
	}
	return nil
}

// CleanupUnreferencedStaging deletes old staged APKs only when no complete
// publication manifest references them. It is a fallback for interrupted
// uploads and for artifacts left by the producer-first version of this change.
func CleanupUnreferencedStaging(ctx context.Context, arch string, cutoff time.Time) error {
	manifests, manifestsTruncated, err := ListPublicationManifests(ctx, arch)
	if err != nil {
		return err
	}
	if manifestsTruncated {
		return nil
	}
	referenced := map[string]struct{}{}
	for _, manifest := range manifests {
		for _, artifact := range manifest.Artifacts {
			referenced[artifact.StagedAPKKey] = struct{}{}
		}
	}
	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2BucketName)
	if err != nil {
		return fmt.Errorf("create R2 client: %w", err)
	}
	result, err := r2Client.ListObjects(ctx, fmt.Sprintf("%s/staging", arch), 1000)
	if err != nil {
		return fmt.Errorf("list staged APKs: %w", err)
	}
	if result.IsTruncated != nil && *result.IsTruncated {
		return nil
	}
	stale := []string{}
	for _, object := range result.Contents {
		if object.Key == nil || object.LastModified == nil || !object.LastModified.Before(cutoff) {
			continue
		}
		isReferenced := false
		for key := range referenced {
			if *object.Key == key || strings.HasSuffix(*object.Key, "/"+key) {
				isReferenced = true
				break
			}
		}
		if !isReferenced {
			stale = append(stale, *object.Key)
		}
	}
	if err := r2Client.DeleteObjects(ctx, stale); err != nil {
		return fmt.Errorf("delete stale staged APKs: %w", err)
	}
	return nil
}

// PromoteStagedAPK copies the execution-scoped artifact to the canonical
// repository path. The indexer calls this before publishing metadata from the
// same event, keeping the canonical APK and APKINDEX entry paired.
func PromoteStagedAPK(ctx context.Context, stagedAPKKey string, apkFilename string, arch string) error {
	if stagedAPKKey == "" {
		return nil
	}

	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2BucketName)
	if err != nil {
		return fmt.Errorf("create R2 client: %w", err)
	}

	canonicalKey := fmt.Sprintf("%s/%s", arch, apkFilename)
	if err := r2Client.CopyObject(ctx, stagedAPKKey, canonicalKey); err != nil {
		return fmt.Errorf("promote staged APK %s to %s: %w", stagedAPKKey, canonicalKey, err)
	}
	return nil
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
