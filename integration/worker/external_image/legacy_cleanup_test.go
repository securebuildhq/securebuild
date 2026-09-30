package worker_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

func TestLegacyExternalImageScanCleanup(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL and MinIO")
	}
	t.Parallel()
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, db)
	root, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, db.ConnStr, filepath.Join(root, "integration/worker/external_image/testdata/legacy-cleanup"), true))
	ctx, minio := setupMinIOOverrides(ctx, t, db.ConnStr)
	defer testutil.TeardownMinIO(ctx, t, minio)
	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)
	const arch = "x86_64"
	digest := func(name string) string { return "sha256:legacy-" + name }
	key := func(name, filename string) string { return "legacy-" + name + "/" + arch + "/" + filename }
	put := func(key, payload string) {
		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		_, err := gz.Write([]byte(payload))
		require.NoError(t, err)
		require.NoError(t, gz.Close())
		_, err = minio.S3Client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String("image-scans"), Key: aws.String(key), Body: bytes.NewReader(buf.Bytes())})
		require.NoError(t, err)
	}
	exists := func(key string) bool {
		_, err := minio.S3Client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String("image-scans"), Key: aws.String(key)})
		return err == nil
	}
	publish := func(name, generation string) {
		require.NoError(t, externalimage.SetScanStatusRunning(ctx, digest(name), arch, generation))
		require.NoError(t, externalimage.SetExternalImageScanStatus(ctx, externalimage.SetExternalImageScanStatusParams{
			Digest: digest(name), Arch: arch, ScanGenerationID: generation, Status: externalimage.ScanStatusSucceeded,
			ParsedResults: `{"total":2}`, RawResult: `{"matches":[]}`,
			ParsedResultsDetails: `{"counts":{"total":2},"fixed_counts":{"total":1}}`,
		}))
	}
	deadline := func(name string) *time.Time {
		var value *time.Time
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT legacy_cleanup_after FROM external_image_scan WHERE digest=$1 AND arch=$2`, digest(name), arch).Scan(&value))
		return value
	}
	cleaned := func(name string) bool {
		var value bool
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT legacy_cleaned_at IS NOT NULL FROM external_image_scan WHERE digest=$1 AND arch=$2`, digest(name), arch).Scan(&value))
		return value
	}
	expire := func(name string) {
		_, err := db.Pool.Exec(ctx, `UPDATE external_image_scan SET legacy_cleanup_after=NOW()-INTERVAL '1 minute' WHERE digest=$1`, digest(name))
		require.NoError(t, err)
	}
	for _, name := range []string{"migrated", "legacy-only", "missing-replacement", "backfill"} {
		put(key(name, "raw_result.json.gz"), `{"matches":["legacy"]}`)
		put(key(name, "parsed_results_details.json.gz"), `{"counts":{"total":99},"fixed_counts":{"total":98}}`)
		put(key(name, "sbom.json.gz"), `{"artifacts":[]}`)
	}

	t.Run("publication preserves the deadline and cleanup protects live data", func(t *testing.T) {
		publish("migrated", "first")
		initial := deadline("migrated")
		require.NotNil(t, initial)
		require.WithinDuration(t, time.Now().Add(24*time.Hour), *initial, time.Minute)
		publish("migrated", "second")
		require.Equal(t, initial, deadline("migrated"), "rescans must not postpone retirement")
		require.NoError(t, externalimage.CleanupLegacyExternalImageScans(ctx))
		require.True(t, exists(key("migrated", "raw_result.json.gz")), "grace period must be honored")
		expire("migrated")
		// Even a corrupt deadline must not authorize deleting the only published copy.
		expire("legacy-only")
		require.NoError(t, externalimage.CleanupLegacyExternalImageScans(ctx))
		require.True(t, cleaned("migrated"))
		require.Nil(t, deadline("migrated"))
		for _, filename := range []string{"raw_result.json.gz", "parsed_results_details.json.gz"} {
			require.False(t, exists(key("migrated", filename)))
			require.True(t, exists(key("migrated", "scan-generations/second/"+filename)))
			require.True(t, exists(key("legacy-only", filename)))
		}
		require.True(t, exists(key("migrated", "sbom.json.gz")))
		require.False(t, cleaned("legacy-only"))
		// A restarted worker has only durable database state; repeated calls are safe.
		require.NoError(t, externalimage.CleanupLegacyExternalImageScans(ctx))
		publish("migrated", "third")
		require.Nil(t, deadline("migrated"), "completed legacy retirement must stay completed")
	})

	t.Run("dry run and scheduling need no storage and are idempotent", func(t *testing.T) {
		publish("backfill", "backfill-generation")
		_, err := db.Pool.Exec(ctx, `UPDATE external_image_scan SET legacy_cleanup_after=NULL WHERE digest=$1`, digest("backfill"))
		require.NoError(t, err)
		noStorageParams := *param.GetParam(ctx)
		noStorageParams.R2AccessKey, noStorageParams.R2SecretKey, noStorageParams.R2Endpoint = "", "", ""
		noStorageCtx := context.WithValue(ctx, param.ParamContextKey, &noStorageParams)
		// Invalid metadata in the first page must not hide a later eligible row.
		publish("absent-legacy", "absent-first-generation")
		originalDeadline := deadline("absent-legacy")
		_, err = db.Pool.Exec(ctx, `UPDATE external_image_scan SET legacy_cleanup_after=NULL WHERE digest=$1`, digest("absent-legacy"))
		require.NoError(t, err)
		_, err = db.Pool.Exec(ctx, `UPDATE external_image_scan_generation SET raw_object_key='invalid' WHERE generation_id='absent-first-generation'`)
		require.NoError(t, err)
		invalid, err := externalimage.ScheduleLegacyExternalImageScanCleanup(noStorageCtx, externalimage.LegacyScanCleanupOptions{DryRun: true, BatchSize: 1})
		require.Error(t, err)
		require.Equal(t, 1, invalid.Failed)
		require.Equal(t, 1, invalid.WouldSchedule)
		require.Nil(t, deadline("backfill"))
		_, err = db.Pool.Exec(ctx, `UPDATE external_image_scan_generation SET raw_object_key=$1 WHERE generation_id='absent-first-generation'`, key("absent-legacy", "scan-generations/absent-first-generation/raw_result.json.gz"))
		require.NoError(t, err)
		_, err = db.Pool.Exec(ctx, `UPDATE external_image_scan SET legacy_cleanup_after=$1 WHERE digest=$2`, originalDeadline, digest("absent-legacy"))
		require.NoError(t, err)
		result, err := externalimage.ScheduleLegacyExternalImageScanCleanup(noStorageCtx, externalimage.LegacyScanCleanupOptions{DryRun: true, BatchSize: 1})
		require.NoError(t, err)
		require.Equal(t, 1, result.WouldSchedule)
		require.EqualValues(t, 2, result.IntendedKeys)
		require.Nil(t, deadline("backfill"))
		require.False(t, cleaned("backfill"))
		require.True(t, exists(key("backfill", "raw_result.json.gz")))
		result, err = externalimage.ScheduleLegacyExternalImageScanCleanup(noStorageCtx, externalimage.LegacyScanCleanupOptions{BatchSize: 1})
		require.NoError(t, err)
		require.Equal(t, 1, result.Scheduled)
		scheduled := deadline("backfill")
		require.NotNil(t, scheduled)
		require.WithinDuration(t, time.Now().Add(24*time.Hour), *scheduled, time.Minute)
		result, err = externalimage.ScheduleLegacyExternalImageScanCleanup(noStorageCtx, externalimage.LegacyScanCleanupOptions{BatchSize: 1})
		require.NoError(t, err)
		require.Zero(t, result.Candidates)
		require.Equal(t, scheduled, deadline("backfill"))
	})

	t.Run("invalid replacement metadata retains legacy objects and retries after lease", func(t *testing.T) {
		publish("missing-replacement", "missing-generation")
		replacement := key("missing-replacement", "scan-generations/missing-generation/parsed_results_details.json.gz")
		_, err := db.Pool.Exec(ctx, `UPDATE external_image_scan_generation SET details_object_key=$1 WHERE generation_id=$2`, key("missing-replacement", "parsed_results_details.json.gz"), "missing-generation")
		require.NoError(t, err)
		expire("missing-replacement")
		require.Error(t, externalimage.CleanupLegacyExternalImageScans(ctx))
		require.False(t, cleaned("missing-replacement"))
		require.True(t, exists(key("missing-replacement", "raw_result.json.gz")))
		require.True(t, exists(key("missing-replacement", "parsed_results_details.json.gz")))
		// The claim is persisted even on failure, avoiding a tight retry loop.
		require.True(t, deadline("missing-replacement").After(time.Now()))
		_, err = db.Pool.Exec(ctx, `UPDATE external_image_scan_generation SET details_object_key=$1 WHERE generation_id=$2`, replacement, "missing-generation")
		require.NoError(t, err)
		expire("missing-replacement")
		require.NoError(t, externalimage.CleanupLegacyExternalImageScans(ctx))
		require.True(t, cleaned("missing-replacement"))
	})

	t.Run("overlapping workers tolerate absent legacy keys", func(t *testing.T) {
		publish("absent-legacy", "absent-generation")
		expire("absent-legacy")
		results := make(chan error, 2)
		for i := 0; i < 2; i++ {
			go func() { results <- externalimage.CleanupLegacyExternalImageScans(ctx) }()
		}
		for i := 0; i < 2; i++ {
			require.NoError(t, <-results)
		}
		require.True(t, cleaned("absent-legacy"))
	})

	t.Run("fixed count backfill reads selected details after legacy deletion", func(t *testing.T) {
		result, err := externalimage.BackfillExternalImageFixedCounts(ctx, externalimage.FixedCountsBackfillOptions{BatchSize: 1})
		require.NoError(t, err)
		require.Equal(t, 5, result.Updated)
		for _, name := range []string{"migrated", "legacy-only", "missing-replacement", "backfill", "absent-legacy"} {
			var summary string
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT parsed_results FROM external_image_scan WHERE digest=$1`, digest(name)).Scan(&summary))
			if name == "legacy-only" {
				require.Contains(t, summary, `"total":98`)
			} else {
				require.True(t, strings.Contains(summary, `"total":1`), summary)
				require.NotContains(t, summary, `"total":98`)
			}
		}
	})
	t.Run("fixed count backfill never falls back for broken selected metadata", func(t *testing.T) {
		_, err := db.Pool.Exec(ctx, `UPDATE external_image_scan SET parsed_results='{"total":2}', selected_scan_generation_id='missing-metadata' WHERE digest=$1`, digest("backfill"))
		require.NoError(t, err)
		result, err := externalimage.BackfillExternalImageFixedCounts(ctx, externalimage.FixedCountsBackfillOptions{BatchSize: 1})
		require.Error(t, err)
		require.Equal(t, 1, result.Failed)
		require.Zero(t, result.Updated)
		require.True(t, exists(key("backfill", "parsed_results_details.json.gz")))
	})

}
