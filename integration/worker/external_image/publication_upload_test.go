package worker_test

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/externalimage"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

func TestExternalImageScanPublicationWithoutReadBack(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}
	t.Parallel()
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, db)
	root, err := testutil.FindProjectRoot()
	require.NoError(t, err)
	require.NoError(t, testutil.ApplySchemaHero(ctx, db.ConnStr, filepath.Join(root, "db", "schema", "tables"), false))

	type upload struct {
		key, checksum string
		body          []byte
	}
	var mu sync.Mutex
	var uploads []upload
	var rejectedReads int
	var failUpload int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		if r.Method != http.MethodPut {
			rejectedReads++
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprint(w, `<Error><Code>AccessDenied</Code></Error>`)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		uploads = append(uploads, upload{r.URL.Path, r.Header.Get("Content-MD5"), body})
		checksum := md5.Sum(body)
		if r.Header.Get("Content-MD5") != base64.StdEncoding.EncodeToString(checksum[:]) || len(uploads) == failUpload {
			w.WriteHeader(http.StatusBadRequest)
			fmt.Fprint(w, `<Error><Code>BadDigest</Code><Message>checksum mismatch</Message></Error>`)
		}
	}))
	defer server.Close()
	ctx = param.WithParam(ctx, &param.Param{
		DBURI: db.ConnStr, R2Endpoint: server.URL, R2ImageScansBucketName: "scans",
		R2AccessKey: "test", R2SecretKey: "test", R2UsePathStyle: true,
	})
	require.NoError(t, persistence.InitPostgres(ctx))
	defer persistence.ClosePool(ctx)

	const digest, arch = "sha256:local-validation", "x86_64"
	_, err = db.Pool.Exec(ctx, `INSERT INTO external_image_sbom (digest, arch, source, created_at, is_in_object_store) VALUES ($1, $2, 'syft', NOW(), false)`, digest, arch)
	require.NoError(t, err)
	params := externalimage.SetExternalImageScanStatusParams{
		Digest: digest, Arch: arch, ScanGenerationID: "initial", Status: externalimage.ScanStatusSucceeded,
		RawResult: `{"matches":[]}`, ParsedResultsDetails: `{"counts":{"total":0}}`, ParsedResults: `{"total":0}`,
	}
	require.NoError(t, externalimage.SetScanStatusRunning(ctx, digest, arch, params.ScanGenerationID))
	require.NoError(t, externalimage.SetExternalImageScanStatus(ctx, params))
	mu.Lock()
	initialUploads := append([]upload(nil), uploads...)
	reads := rejectedReads
	mu.Unlock()
	require.Zero(t, reads, "publication must succeed with object reads denied")
	require.Len(t, initialUploads, 2)
	for i, u := range initialUploads {
		reader, err := gzip.NewReader(bytes.NewReader(u.body))
		require.NoError(t, err)
		payload, err := io.ReadAll(reader)
		require.NoError(t, err)
		require.NoError(t, reader.Close())
		require.JSONEq(t, []string{params.RawResult, params.ParsedResultsDetails}[i], string(payload))
		checksum := md5.Sum(u.body)
		require.Equal(t, base64.StdEncoding.EncodeToString(checksum[:]), u.checksum)
	}
	var rawKey, detailsKey, rawHash, detailsHash, state string
	var rawSize, detailsSize int64
	require.NoError(t, db.Pool.QueryRow(ctx, `SELECT state, raw_object_key, details_object_key, raw_size_bytes, details_size_bytes, raw_sha256, details_sha256 FROM external_image_scan_generation WHERE generation_id = 'initial' AND digest = $1 AND arch = $2`, digest, arch).Scan(&state, &rawKey, &detailsKey, &rawSize, &detailsSize, &rawHash, &detailsHash))
	require.Equal(t, "selected", state)
	for i, u := range initialUploads {
		require.Equal(t, "/scans/"+[]string{rawKey, detailsKey}[i], u.key)
		require.Equal(t, []int64{rawSize, detailsSize}[i], int64(len(u.body)))
		sum := sha256.Sum256(u.body)
		require.Equal(t, []string{rawHash, detailsHash}[i], hex.EncodeToString(sum[:]))
	}

	for _, mode := range []string{"raw upload rejected", "details upload rejected", "invalid raw", "invalid details", "invalid counts"} {
		t.Run(mode, func(t *testing.T) {
			mu.Lock()
			uploads = nil
			failUpload = 0
			if mode == "raw upload rejected" {
				failUpload = 1
			} else if mode == "details upload rejected" {
				failUpload = 2
			}
			expectedUploads := failUpload
			mu.Unlock()
			attempt := params
			attempt.ScanGenerationID = mode
			switch mode {
			case "invalid raw":
				attempt.RawResult = "{"
			case "invalid details":
				attempt.ParsedResultsDetails = "{"
			case "invalid counts":
				attempt.ParsedResults = "{"
			}
			require.NoError(t, externalimage.SetScanStatusRunning(ctx, digest, arch, attempt.ScanGenerationID))
			err := externalimage.SetExternalImageScanStatus(ctx, attempt)
			require.Error(t, err)
			if expectedUploads > 0 {
				require.ErrorContains(t, err, "BadDigest")
			} else {
				require.ErrorIs(t, err, externalimage.ErrInvalidScanCandidate)
			}
			mu.Lock()
			count, reads := len(uploads), rejectedReads
			mu.Unlock()
			require.Equal(t, expectedUploads, count)
			require.Zero(t, reads)
			var selected, counts string
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT selected_scan_generation_id, parsed_results FROM external_image_scan WHERE digest = $1 AND arch = $2`, digest, arch).Scan(&selected, &counts))
			require.Equal(t, "initial", selected, "failed publication must preserve the previous result")
			require.JSONEq(t, params.ParsedResults, counts)
		})
	}
}
