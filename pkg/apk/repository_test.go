package apk

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRepositoryContainsPackage(t *testing.T) {
	t.Parallel()

	index := testAPKIndexArchive(t, "example", "10.3.1-r2")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch req.URL.Path {
		case "/x86_64/APKINDEX.tar.gz", "/aarch64/APKINDEX.tar.gz":
			w.Header().Set("Content-Type", "application/octet-stream")
			_, err := w.Write(index)
			require.NoError(t, err)
		default:
			http.NotFound(w, req)
		}
	}))
	t.Cleanup(server.Close)

	available, err := RepositoryContainsPackage(
		context.Background(), server.URL, "example", "10.3.1", 2,
	)
	require.NoError(t, err)
	require.True(t, available)
}

func TestRepositoryContainsPackageRequiresEveryArchitecture(t *testing.T) {
	t.Parallel()

	index := testAPKIndexArchive(t, "example", "10.3.1-r2")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/aarch64/APKINDEX.tar.gz" {
			_, err := w.Write(index)
			require.NoError(t, err)
			return
		}
		http.NotFound(w, req)
	}))
	t.Cleanup(server.Close)

	available, err := RepositoryContainsPackage(
		context.Background(), server.URL+"/", "example", "10.3.1", 2,
	)
	require.NoError(t, err)
	require.False(t, available)
}

func TestRepositoryContainsPackageRequiresExactRevision(t *testing.T) {
	t.Parallel()

	index := testAPKIndexArchive(t, "example", "10.3.1-r1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, err := w.Write(index)
		require.NoError(t, err)
	}))
	t.Cleanup(server.Close)

	available, err := RepositoryContainsPackage(
		context.Background(), server.URL, "example", "10.3.1", 2,
	)
	require.NoError(t, err)
	require.False(t, available)
}

func TestRepositoryContainsPackageReturnsRepositoryErrors(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unavailable", http.StatusServiceUnavailable)
	}))
	t.Cleanup(server.Close)

	available, err := RepositoryContainsPackage(
		context.Background(), server.URL, "example", "10.3.1", 2,
	)
	require.ErrorContains(t, err, "503 Service Unavailable")
	require.False(t, available)
}

func testAPKIndexArchive(t *testing.T, packages ...string) []byte {
	t.Helper()

	require.Zero(t, len(packages)%2)
	var content bytes.Buffer
	for i := 0; i < len(packages); i += 2 {
		_, err := fmt.Fprintf(&content, "P:%s\nV:%s\n\n", packages[i], packages[i+1])
		require.NoError(t, err)
	}
	var archive bytes.Buffer
	gzipWriter := gzip.NewWriter(&archive)
	tarWriter := tar.NewWriter(gzipWriter)
	require.NoError(t, tarWriter.WriteHeader(&tar.Header{
		Name: "APKINDEX",
		Mode: 0o644,
		Size: int64(content.Len()),
	}))
	_, err := tarWriter.Write(content.Bytes())
	require.NoError(t, err)
	require.NoError(t, tarWriter.Close())
	require.NoError(t, gzipWriter.Close())

	return archive.Bytes()
}
