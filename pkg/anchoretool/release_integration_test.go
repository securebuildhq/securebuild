package anchoretool

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadPublishedRelease(t *testing.T) {
	if os.Getenv("SECUREBUILD_INTEGRATION_TESTS") == "" {
		t.Skip("set SECUREBUILD_INTEGRATION_TESTS to download and verify a published Anchore release")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	tests := []struct {
		tool    Tool
		version string
		asset   string
	}{
		{tool: Grype, version: "0.110.0", asset: "grype_0.110.0_linux_amd64.tar.gz"},
		{tool: Syft, version: "1.42.3", asset: "syft_1.42.3_linux_amd64.tar.gz"},
	}
	for _, test := range tests {
		t.Run(test.tool.Name, func(t *testing.T) {
			release, err := loadRelease(ctx, test.tool, test.version, test.asset)
			require.NoError(t, err)
			assert.Equal(t, test.version, release.Version)
			assert.NotEmpty(t, release.Binary)
		})
	}
}

func TestPublishedSignatureFailures(t *testing.T) {
	if os.Getenv("SECUREBUILD_INTEGRATION_TESTS") == "" {
		t.Skip("set SECUREBUILD_INTEGRATION_TESTS to test published Anchore signatures")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	baseURL := "https://github.com/anchore/grype/releases/download/v0.110.0/grype_0.110.0_checksums.txt"
	manifest, err := download(ctx, baseURL, maxMetadataBytes)
	require.NoError(t, err)
	certificate, err := download(ctx, baseURL+".pem", maxMetadataBytes)
	require.NoError(t, err)
	signature, err := download(ctx, baseURL+".sig", maxMetadataBytes)
	require.NoError(t, err)

	t.Run("unexpected identity", func(t *testing.T) {
		err := verifyManifest(ctx, Syft, manifest, certificate, signature)
		require.Error(t, err)
	})
	t.Run("invalid signature", func(t *testing.T) {
		invalidSignature := append([]byte(nil), signature...)
		invalidSignature[0] = 'A'
		err := verifyManifest(ctx, Grype, manifest, certificate, invalidSignature)
		require.Error(t, err)
	})
}
