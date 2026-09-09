package cli

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/stretchr/testify/require"
)

func TestWritePackageOutputManifest(t *testing.T) {
	t.Parallel()

	manifestPath := filepath.Join(t.TempDir(), buildertypes.PackageOutputManifestFilename)
	require.NoError(t, writePackageOutputManifest(
		manifestPath,
		"x86_64",
		[]string{"example-cli", "example", "example-cli", ""},
	))

	manifestJSON, err := os.ReadFile(manifestPath)
	require.NoError(t, err)

	var manifest buildertypes.PackageOutputManifest
	require.NoError(t, json.Unmarshal(manifestJSON, &manifest))
	require.Equal(t, "x86_64", manifest.Architecture)
	require.Equal(t, []string{"example", "example-cli"}, manifest.PackageNames)
}

func TestWritePackageOutputManifestRejectsEmptyOutputs(t *testing.T) {
	t.Parallel()

	err := writePackageOutputManifest(
		filepath.Join(t.TempDir(), buildertypes.PackageOutputManifestFilename),
		"aarch64",
		[]string{"", "  "},
	)
	require.ErrorContains(t, err, "no APK outputs")
}
