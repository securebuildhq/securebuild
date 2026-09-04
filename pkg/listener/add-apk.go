package listener

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/securebuildhq/securebuild/pkg/apk"
	"github.com/securebuildhq/securebuild/pkg/cloudflare"
	"github.com/securebuildhq/securebuild/pkg/dynamicparam"
	"github.com/securebuildhq/securebuild/pkg/execution"
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

	lastStagingCleanup := time.Time{}
	for {
		if time.Since(lastStagingCleanup) >= time.Hour {
			for _, arch := range []string{"x86_64", "aarch64"} {
				if err := apk.CleanupUnreferencedStaging(ctx, arch, time.Now().Add(-24*time.Hour)); err != nil {
					logger.Warn("failed to clean unreferenced staged APKs", zap.String("arch", arch), zap.Error(err))
				}
			}
			lastStagingCleanup = time.Now()
		}
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
	manifests, hasMore, err := apk.ListPublicationManifests(ctx, arch)
	if err != nil {
		return false, err
	}
	if len(manifests) == 0 {
		// Compatibility path for builders deployed before complete manifests.
		// Legacy executions have repository_publication_required=false and are
		// never acknowledged through this path.
		var legacyHasMore bool
		err := apk.WithRepositoryLock(ctx, arch, func() error {
			var err error
			legacyHasMore, err = handleLegacyAddAPK(ctx, arch)
			return err
		})
		return legacyHasMore, err
	}
	keys := make([]string, 0, len(manifests))
	for key := range manifests {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	manifestKey := keys[0]
	if err := apk.WithRepositoryLock(ctx, arch, func() error {
		return publishManifest(ctx, manifestKey, manifests[manifestKey])
	}); err != nil {
		return hasMore || len(keys) > 1, err
	}
	return hasMore || len(keys) > 1, nil
}

func publishManifest(ctx context.Context, manifestKey string, manifest apk.PublicationManifest) error {
	latest, err := execution.IsLatestExecutionForPackageVersion(ctx, manifest.ExecutionID)
	if err != nil {
		return fmt.Errorf("check publication ownership: %w", err)
	}
	stagedKeys := make([]string, 0, len(manifest.Artifacts))
	for _, artifact := range manifest.Artifacts {
		stagedKeys = append(stagedKeys, artifact.StagedAPKKey)
	}
	if !latest {
		logger.Warn("discarding superseded APK publication manifest", zap.String("executionID", manifest.ExecutionID), zap.String("arch", manifest.Arch))
		if err := apk.DeletePublishedEventsFromR2(ctx, []string{manifestKey}); err != nil {
			return err
		}
		return apk.DeletePublishedEventsFromR2(ctx, stagedKeys)
	}

	currentAPKIndexFile, err := apk.GetAPKIndex(ctx, manifest.Arch)
	if err != nil {
		return fmt.Errorf("get APK index: %w", err)
	}
	tempFiles := []string{}
	if currentAPKIndexFile != "" {
		tempFiles = append(tempFiles, currentAPKIndexFile)
	}
	defer func() {
		for _, path := range tempFiles {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				logger.Warn("failed to remove temporary APK index", zap.String("path", path), zap.Error(err))
			}
		}
	}()

	for _, artifact := range manifest.Artifacts {
		if err := apk.PromoteStagedAPK(ctx, artifact.StagedAPKKey, artifact.APKFilename, manifest.Arch); err != nil {
			return err
		}
		updated, err := apk.AddAPKToIndex(ctx, artifact.PKGInfo, currentAPKIndexFile)
		if err != nil {
			return fmt.Errorf("add %s to APK index: %w", artifact.APKFilename, err)
		}
		if updated != currentAPKIndexFile && updated != "" {
			tempFiles = append(tempFiles, updated)
		}
		currentAPKIndexFile = updated
		if err := apk.AddAPKToCatalogTable(ctx, artifact.APKFilename, manifest.Arch, artifact.PKGInfo); err != nil {
			return err
		}
	}
	if err := apk.SignAPKIndex(ctx, currentAPKIndexFile); err != nil {
		return fmt.Errorf("sign APK index: %w", err)
	}
	if err := apk.UploadAPKIndex(ctx, currentAPKIndexFile, manifest.Arch); err != nil {
		return fmt.Errorf("upload APK index: %w", err)
	}

	repository := strings.TrimRight(param.GetParam(ctx).ApkRepository, "/")
	urls := []string{fmt.Sprintf("%s/%s/APKINDEX.tar.gz", repository, manifest.Arch)}
	for _, artifact := range manifest.Artifacts {
		urls = append(urls, fmt.Sprintf("%s/%s/%s", repository, manifest.Arch, artifact.APKFilename))
	}
	if err := cloudflare.PurgeCache(ctx, param.GetParam(ctx).CloudflareZoneID, param.GetParam(ctx).CloudflareCachePurgeToken, urls); err != nil {
		return fmt.Errorf("purge published APK cache: %w", err)
	}
	if err := verifyPublicManifest(ctx, manifest); err != nil {
		return fmt.Errorf("verify public repository: %w", err)
	}
	if err := execution.MarkExecutionRepositoryVerified(ctx, manifest.ExecutionID, manifest.Arch); err != nil {
		return fmt.Errorf("record repository verification: %w", err)
	}
	// Delete the durable retry marker first. If staging cleanup fails, the
	// hourly sweeper can recover it without causing a completed manifest to be
	// retried after some of its staged objects have already gone away.
	if err := apk.DeletePublishedEventsFromR2(ctx, []string{manifestKey}); err != nil {
		return fmt.Errorf("acknowledge publication manifest: %w", err)
	}
	if err := apk.DeletePublishedEventsFromR2(ctx, stagedKeys); err != nil {
		return fmt.Errorf("clean staged APKs after publication: %w", err)
	}
	return nil
}

func verifyPublicManifest(ctx context.Context, manifest apk.PublicationManifest) error {
	repository := strings.TrimRight(param.GetParam(ctx).ApkRepository, "/")
	if repository == "" {
		return fmt.Errorf("APK repository URL is not configured")
	}
	indexPath, err := downloadPublicFile(ctx, fmt.Sprintf("%s/%s/APKINDEX.tar.gz", repository, manifest.Arch), "public-apkindex-*.tar.gz")
	if err != nil {
		return err
	}
	defer os.Remove(indexPath)
	index, err := apk.ExtractAPKIndex(indexPath)
	if err != nil {
		return err
	}
	for _, artifact := range manifest.Artifacts {
		expectedVersion := fmt.Sprintf("%s-r%s", artifact.PKGInfo["pkgver"], artifact.PKGInfo["pkgrel"])
		found := false
		for _, entry := range index.Packages {
			if entry["P"] == artifact.PKGInfo["pkgname"] && entry["V"] == expectedVersion && entry["C"] == artifact.PKGInfo["alpine_checksum"] {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("APKINDEX does not contain %s at checksum %s", artifact.APKFilename, artifact.PKGInfo["alpine_checksum"])
		}
		apkPath, err := downloadPublicFile(ctx, fmt.Sprintf("%s/%s/%s", repository, manifest.Arch, artifact.APKFilename), "public-apk-*.apk")
		if err != nil {
			return err
		}
		metadata, metadataErr := apk.ExtractAPKMetadataOptimized(apkPath)
		os.Remove(apkPath)
		if metadataErr != nil {
			return fmt.Errorf("read public APK %s: %w", artifact.APKFilename, metadataErr)
		}
		if metadata["alpine_checksum"] != artifact.PKGInfo["alpine_checksum"] {
			return fmt.Errorf("public APK checksum mismatch for %s", artifact.APKFilename)
		}
	}
	return nil
}

func downloadPublicFile(ctx context.Context, url, pattern string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("GET %s returned %s", url, resp.Status)
	}
	tempFile, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", err
	}
	path := tempFile.Name()
	if _, err := io.Copy(tempFile, resp.Body); err != nil {
		tempFile.Close()
		os.Remove(path)
		return "", err
	}
	if err := tempFile.Close(); err != nil {
		os.Remove(path)
		return "", err
	}
	return filepath.Clean(path), nil
}

func handleLegacyAddAPK(ctx context.Context, arch string) (bool, error) {

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

	eventKeys := make([]string, 0, len(apkPublishedEvents))
	for key := range apkPublishedEvents {
		eventKeys = append(eventKeys, key)
	}
	sort.Strings(eventKeys)

	for _, eventKey := range eventKeys {
		apkPublishedEvent := apkPublishedEvents[eventKey]
		logger.Debug("processing apk published event", zap.String("apk_filename", apkPublishedEvent.APKFilename))
		if err := apk.PromoteStagedAPK(ctx, apkPublishedEvent.StagedAPKKey, apkPublishedEvent.APKFilename, arch); err != nil {
			return hasMore, fmt.Errorf("failed to promote staged APK: %w", err)
		}
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

	urlsToPurge := []string{fmt.Sprintf("%s/%s/APKINDEX.tar.gz", strings.TrimRight(param.GetParam(ctx).ApkRepository, "/"), arch)}
	seenURLs := map[string]struct{}{}
	for _, apkPublishedEvent := range apkPublishedEvents {
		url := fmt.Sprintf("%s/%s/%s", strings.TrimRight(param.GetParam(ctx).ApkRepository, "/"), arch, apkPublishedEvent.APKFilename)
		if _, ok := seenURLs[url]; !ok {
			seenURLs[url] = struct{}{}
			urlsToPurge = append(urlsToPurge, url)
		}
	}
	if err := cloudflare.PurgeCache(ctx, param.GetParam(ctx).CloudflareZoneID, param.GetParam(ctx).CloudflareCachePurgeToken, urlsToPurge); err != nil {
		return hasMore, fmt.Errorf("failed to purge published APK cache: %w", err)
	}

	keysToDelete := []string{}
	for key := range apkPublishedEvents {
		keysToDelete = append(keysToDelete, key)
	}
	for _, apkPublishedEvent := range apkPublishedEvents {
		if apkPublishedEvent.StagedAPKKey != "" {
			keysToDelete = append(keysToDelete, apkPublishedEvent.StagedAPKKey)
		}
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
