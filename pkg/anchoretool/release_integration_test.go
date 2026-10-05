package anchoretool

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/mod/modfile"
)

func TestLoadPublishedRelease(t *testing.T) {
	if os.Getenv("SECUREBUILD_INTEGRATION_TESTS") == "" {
		t.Skip("set SECUREBUILD_INTEGRATION_TESTS to download and verify a published Anchore release")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	tests := []struct {
		tool Tool
	}{
		{tool: Grype},
		{tool: Syft},
	}
	for _, test := range tests {
		t.Run(test.tool.Name, func(t *testing.T) {
			version := pinnedModuleVersion(t, test.tool)
			asset, err := assetName(test.tool, version, "linux", "amd64")
			require.NoError(t, err)

			release, err := loadRelease(ctx, test.tool, version, asset)
			require.NoError(t, err)
			assert.Equal(t, version, release.Version)
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

	version := pinnedModuleVersion(t, Grype)
	baseURL := fmt.Sprintf("https://github.com/%s/releases/download/v%s/%s_%s_checksums.txt",
		Grype.Repository, version, Grype.Name, version)
	manifest, err := download(ctx, baseURL, maxMetadataBytes)
	require.NoError(t, err)
	bundle, err := download(ctx, baseURL+".sigstore.json", maxMetadataBytes)
	require.NoError(t, err)

	t.Run("unexpected identity", func(t *testing.T) {
		err := verifyManifest(ctx, Syft, manifest, bundle)
		require.Error(t, err)
	})
	t.Run("invalid signature", func(t *testing.T) {
		tamperedManifest := append([]byte(nil), manifest...)
		tamperedManifest[0] ^= 1
		err := verifyManifest(ctx, Grype, tamperedManifest, bundle)
		require.Error(t, err)
	})
}

func pinnedModuleVersion(t *testing.T, tool Tool) string {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	require.True(t, ok, "locate integration test source")
	goModPath := filepath.Join(filepath.Dir(filename), "..", "..", "go.mod")
	data, err := os.ReadFile(goModPath)
	require.NoError(t, err)
	file, err := modfile.Parse(goModPath, data, nil)
	require.NoError(t, err)
	for _, requirement := range file.Require {
		if requirement.Mod.Path == tool.ModulePath {
			return strings.TrimPrefix(requirement.Mod.Version, "v")
		}
	}
	t.Fatalf("module %s is not pinned in go.mod", tool.ModulePath)
	return ""
}
