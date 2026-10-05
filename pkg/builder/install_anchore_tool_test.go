package builder

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequireLocalToolOnPath(t *testing.T) {
	installDir := t.TempDir()
	shadowDir := t.TempDir()
	installedPath := filepath.Join(installDir, "grype")
	shadowPath := filepath.Join(shadowDir, "grype")
	require.NoError(t, os.WriteFile(installedPath, []byte("verified"), 0755))
	require.NoError(t, os.WriteFile(shadowPath, []byte("shadow"), 0755))

	t.Run("resolved installed binary", func(t *testing.T) {
		t.Setenv("PATH", installDir)
		resolved, err := requireLocalToolOnPath("grype", installedPath)
		require.NoError(t, err)
		assert.Equal(t, installedPath, resolved)
	})

	t.Run("symlink to installed binary", func(t *testing.T) {
		linkDir := t.TempDir()
		linkPath := filepath.Join(linkDir, "grype")
		require.NoError(t, os.Symlink(installedPath, linkPath))
		t.Setenv("PATH", linkDir)
		resolved, err := requireLocalToolOnPath("grype", installedPath)
		require.NoError(t, err)
		assert.Equal(t, linkPath, resolved)
	})

	t.Run("shadowed binary", func(t *testing.T) {
		t.Setenv("PATH", shadowDir+string(os.PathListSeparator)+installDir)
		_, err := requireLocalToolOnPath("grype", installedPath)
		require.ErrorContains(t, err, "PATH resolves "+shadowPath)
		require.ErrorContains(t, err, "installed at "+installedPath)
	})

	t.Run("missing from PATH", func(t *testing.T) {
		t.Setenv("PATH", shadowDir)
		_, err := requireLocalToolOnPath("syft", filepath.Join(installDir, "syft"))
		require.ErrorContains(t, err, "not available on PATH")
	})
}

func TestBuilderArchitectureToGoArch(t *testing.T) {
	tests := map[string]string{
		"x86_64":  "amd64",
		"amd64":   "amd64",
		"aarch64": "arm64",
		"arm64":   "arm64",
	}
	for input, want := range tests {
		t.Run(input, func(t *testing.T) {
			got, err := builderArchitectureToGoArch(input)
			require.NoError(t, err)
			assert.Equal(t, want, got)
		})
	}

	_, err := builderArchitectureToGoArch("s390x")
	require.ErrorContains(t, err, "unsupported")
}
