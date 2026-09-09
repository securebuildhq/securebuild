package listener

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/stretchr/testify/require"
)

func TestReadPackageOutputManifest(t *testing.T) {
	t.Parallel()

	workDir := t.TempDir()
	outputDir := filepath.Join(workDir, "output")
	require.NoError(t, os.MkdirAll(outputDir, 0o755))

	manifestJSON, err := json.Marshal(buildertypes.PackageOutputManifest{
		Architecture: "aarch64",
		PackageNames: []string{"example", "example-cli"},
	})
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(
		filepath.Join(outputDir, buildertypes.PackageOutputManifestFilename),
		manifestJSON,
		0o644,
	))

	packageNames, err := readPackageOutputManifest(
		context.Background(),
		buildertypes.BuilderVM{ID: "local-test", Type: "local"},
		"execution-id",
		"aarch64",
		workDir,
		"10.3.1",
		2,
	)
	require.NoError(t, err)
	require.Equal(t, []string{"example", "example-cli"}, packageNames)
}

func TestReadPackageOutputManifestRejectsWrongArchitecture(t *testing.T) {
	t.Parallel()

	workDir := t.TempDir()
	outputDir := filepath.Join(workDir, "output")
	require.NoError(t, os.MkdirAll(outputDir, 0o755))

	manifestJSON, err := json.Marshal(buildertypes.PackageOutputManifest{
		Architecture: "x86_64",
		PackageNames: []string{"example"},
	})
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(
		filepath.Join(outputDir, buildertypes.PackageOutputManifestFilename),
		manifestJSON,
		0o644,
	))

	_, err = readPackageOutputManifest(
		context.Background(),
		buildertypes.BuilderVM{ID: "local-test", Type: "local"},
		"execution-id",
		"aarch64",
		workDir,
		"10.3.1",
		2,
	)
	require.ErrorContains(t, err, "does not match")
}

func TestReadPackageOutputManifestFallsBackToLegacyAPKs(t *testing.T) {
	t.Parallel()
	// Include shell metacharacters to exercise the remote command's quoting.
	workDir := filepath.Join(t.TempDir(), "old builder's $(unused)")
	packagesDir := filepath.Join(workDir, "packages", "aarch64")
	require.NoError(t, os.MkdirAll(packagesDir, 0o755))
	for _, filename := range []string{"example-10.3.1-r2.apk", "example-cli-10.3.1-r2.apk", "APKINDEX.tar.gz"} {
		require.NoError(t, os.WriteFile(filepath.Join(packagesDir, filename), nil, 0o644))
	}
	// An output for a different architecture must not become an aarch64 requirement.
	x86Dir := filepath.Join(workDir, "packages", "x86_64")
	require.NoError(t, os.MkdirAll(x86Dir, 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(x86Dir, "example-extra-10.3.1-r2.apk"), nil, 0o644))
	names, err := readPackageOutputManifest(context.Background(), buildertypes.BuilderVM{ID: "local-test", Type: "local"}, "execution-id", "aarch64", workDir, "10.3.1", 2)
	require.NoError(t, err)
	require.Equal(t, []string{"example", "example-cli"}, names)
}

func TestReadPackageOutputManifestRejectsInvalidLegacyOutputs(t *testing.T) {
	t.Parallel()
	for _, filename := range []string{"", "example-10.3.1-r1.apk"} {
		t.Run(filename, func(t *testing.T) {
			workDir := t.TempDir()
			packagesDir := filepath.Join(workDir, "packages", "aarch64")
			require.NoError(t, os.MkdirAll(packagesDir, 0o755))
			if filename != "" {
				require.NoError(t, os.WriteFile(filepath.Join(packagesDir, filename), nil, 0o644))
			}
			_, err := readPackageOutputManifest(context.Background(), buildertypes.BuilderVM{ID: "local-test", Type: "local"}, "execution-id", "aarch64", workDir, "10.3.1", 2)
			require.Error(t, err)
		})
	}
}

func TestReadPackageOutputManifestDoesNotHideCorruptManifest(t *testing.T) {
	t.Parallel()
	workDir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(workDir, "output"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(workDir, "output", buildertypes.PackageOutputManifestFilename), []byte("invalid JSON"), 0o644))
	_, err := readPackageOutputManifest(context.Background(), buildertypes.BuilderVM{ID: "local-test", Type: "local"}, "execution-id", "aarch64", workDir, "10.3.1", 2)
	require.ErrorContains(t, err, "parse")
}
