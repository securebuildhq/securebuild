package builder

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

func TestRemoteVerifiedBinaryInstallCommandUsesRootOwnedAtomicStaging(t *testing.T) {
	command := remoteVerifiedBinaryInstallCommand("grype", "abc123")

	assert.NotContains(t, command, "/tmp/")
	assert.Contains(t, command, "sudo sh -c")
	assert.Contains(t, command, `mktemp "${destination}.securebuild.XXXXXX"`)
	assert.Contains(t, command, `cat > "$staged"`)
	assert.Contains(t, command, `sha256sum "$staged"`)
	assert.Contains(t, command, `test "$actual" = "$expected"`)
	assert.Contains(t, command, `mv -f "$staged" "$destination"`)
	assert.Contains(t, command, `"/usr/local/bin/grype" "abc123"`)
}

func TestVerifiedBinaryInstallCommand(t *testing.T) {
	contents := []byte("verified binary")
	digest := fmt.Sprintf("%x", sha256.Sum256(contents))
	destination := filepath.Join(t.TempDir(), "grype")
	command := strings.TrimPrefix(verifiedBinaryInstallCommand(destination, digest), "sudo ")

	run := exec.Command("sh", "-c", command)
	run.Stdin = bytes.NewReader(contents)
	output, err := run.CombinedOutput()
	require.NoError(t, err, string(output))
	installed, err := os.ReadFile(destination)
	require.NoError(t, err)
	assert.Equal(t, contents, installed)
	info, err := os.Stat(destination)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0755), info.Mode().Perm())
	staged, err := filepath.Glob(destination + ".securebuild.*")
	require.NoError(t, err)
	assert.Empty(t, staged)
}

func TestVerifiedBinaryInstallCommandRejectsWrongDigest(t *testing.T) {
	destination := filepath.Join(t.TempDir(), "grype")
	command := strings.TrimPrefix(verifiedBinaryInstallCommand(destination, "wrong"), "sudo ")

	run := exec.Command("sh", "-c", command)
	run.Stdin = strings.NewReader("untrusted binary")
	output, err := run.CombinedOutput()
	require.Error(t, err, string(output))
	_, err = os.Stat(destination)
	require.ErrorIs(t, err, os.ErrNotExist)
	staged, err := filepath.Glob(destination + ".securebuild.*")
	require.NoError(t, err)
	assert.Empty(t, staged)
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
