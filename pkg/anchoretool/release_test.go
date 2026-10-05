package anchoretool

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadCachedReleaseDeduplicatesSameKey(t *testing.T) {
	gate := make(chan struct{})
	started := make(chan struct{}, 1)
	var calls atomic.Int32
	loader := func(context.Context) (Release, error) {
		calls.Add(1)
		started <- struct{}{}
		<-gate
		return Release{Version: "1.0.0"}, nil
	}

	type result struct {
		release Release
		err     error
	}
	results := make(chan result, 2)
	load := func() {
		release, err := loadCachedRelease(context.Background(), t.Name(), loader)
		results <- result{release: release, err: err}
	}
	go load()
	<-started
	go load()
	close(gate)

	for range 2 {
		result := <-results
		require.NoError(t, result.err)
		assert.Equal(t, "1.0.0", result.release.Version)
	}
	assert.EqualValues(t, 1, calls.Load())
}

func TestLoadCachedReleaseAllowsDifferentKeysConcurrently(t *testing.T) {
	gate := make(chan struct{})
	started := make(chan struct{}, 2)
	finished := make(chan struct{}, 2)
	loader := func(context.Context) (Release, error) {
		started <- struct{}{}
		<-gate
		return Release{}, nil
	}

	for _, suffix := range []string{"grype", "syft"} {
		go func(key string) {
			_, _ = loadCachedRelease(context.Background(), t.Name()+key, loader)
			finished <- struct{}{}
		}(suffix)
	}

	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	for range 2 {
		select {
		case <-started:
		case <-timer.C:
			close(gate)
			t.Fatal("different cache keys did not load concurrently")
		}
	}
	close(gate)
	<-finished
	<-finished
}

func TestLoadCachedReleaseWaiterCanCancel(t *testing.T) {
	gate := make(chan struct{})
	started := make(chan struct{})
	leaderDone := make(chan struct{})
	go func() {
		_, _ = loadCachedRelease(context.Background(), t.Name(), func(context.Context) (Release, error) {
			close(started)
			<-gate
			return Release{}, nil
		})
		close(leaderDone)
	}()
	<-started

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := loadCachedRelease(ctx, t.Name(), func(context.Context) (Release, error) {
		t.Fatal("waiter unexpectedly started another load")
		return Release{}, nil
	})
	require.ErrorIs(t, err, context.Canceled)
	close(gate)
	<-leaderDone
}

func TestChecksumForAsset(t *testing.T) {
	digest := sha256.Sum256([]byte("archive"))
	want := hex.EncodeToString(digest[:])
	manifest := []byte(want + "  grype_1.2.3_linux_amd64.tar.gz\n" +
		"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  another-file\n")

	got, err := checksumForAsset(manifest, "grype_1.2.3_linux_amd64.tar.gz")
	require.NoError(t, err)
	assert.Equal(t, want, got)

	_, err = checksumForAsset(manifest, "grype_1.2.3_linux_arm64.tar.gz")
	require.ErrorContains(t, err, "absent")
}

func TestVerifyChecksumRejectsMismatch(t *testing.T) {
	digest := sha256.Sum256([]byte("expected"))
	err := verifyChecksum([]byte("actual"), hex.EncodeToString(digest[:]))
	require.ErrorContains(t, err, "digest mismatch")
}

func TestExtractBinary(t *testing.T) {
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	contents := []byte("verified-binary")
	require.NoError(t, tarWriter.WriteHeader(&tar.Header{Name: "grype", Mode: 0755, Size: int64(len(contents)), Typeflag: tar.TypeReg}))
	_, err := tarWriter.Write(contents)
	require.NoError(t, err)
	require.NoError(t, tarWriter.Close())
	require.NoError(t, gzipWriter.Close())

	got, err := extractBinary(archive.Bytes(), "grype")
	require.NoError(t, err)
	assert.Equal(t, contents, got)
}

func TestExtractBinaryRejectsUnsafeEntry(t *testing.T) {
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	contents := []byte("untrusted-binary")
	require.NoError(t, tarWriter.WriteHeader(&tar.Header{Name: "../../grype", Mode: 0755, Size: int64(len(contents)), Typeflag: tar.TypeReg}))
	_, err := tarWriter.Write(contents)
	require.NoError(t, err)
	require.NoError(t, tarWriter.Close())
	require.NoError(t, gzipWriter.Close())

	_, err = extractBinary(archive.Bytes(), "grype")
	require.ErrorContains(t, err, "absent")
}

func TestAssetName(t *testing.T) {
	amd64, err := assetName(Grype, "0.110.0", "linux", "amd64")
	require.NoError(t, err)
	assert.Equal(t, "grype_0.110.0_linux_amd64.tar.gz", amd64)

	arm64, err := assetName(Syft, "1.42.3", "linux", "arm64")
	require.NoError(t, err)
	assert.Equal(t, "syft_1.42.3_linux_arm64.tar.gz", arm64)

	_, err = assetName(Syft, "1.42.3", "linux", "s390x")
	require.ErrorContains(t, err, "unsupported")
}

func TestCertificateIdentity(t *testing.T) {
	assert.Equal(t,
		"https://github.com/anchore/grype/.github/workflows/release.yaml@refs/heads/main",
		certificateIdentity(Grype))
}

func TestVersionMatches(t *testing.T) {
	assert.True(t, VersionMatches("Application: grype\nVersion: 0.110.0\n", "v0.110.0"))
	assert.False(t, VersionMatches("Application: grype\nVersion: 0.109.0\n", "0.110.0"))
	assert.False(t, VersionMatches("BuildDate: 0.110.0\n", "0.110.0"))
}
