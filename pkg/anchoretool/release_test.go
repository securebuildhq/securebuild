package anchoretool

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
