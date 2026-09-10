package cli

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/empty"
	"github.com/google/go-containerregistry/pkg/v1/layout"
	"github.com/google/go-containerregistry/pkg/v1/mutate"
	"github.com/google/go-containerregistry/pkg/v1/tarball"
	"github.com/stretchr/testify/require"
)

func installFakeImageTool(t *testing.T, tool, script string) {
	t.Helper()
	binDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(binDir, tool), []byte("#!/bin/sh\nset -eu\n"+script), 0o755))
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
}

func TestImageScannersUseRegistryAndCleanTemporaryFiles(t *testing.T) {
	for _, scanner := range []string{"syft", "custom-syft", "grype"} {
		for _, fails := range []bool{false, true} {
			name := scanner + "/success"
			if fails {
				name = scanner + "/failure"
			}
			t.Run(name, func(t *testing.T) {
				tool := strings.TrimPrefix(scanner, "custom-")
				commandLog := t.TempDir()
				t.Setenv("COMMAND_LOG", commandLog)
				t.Setenv("SCANNER_FAIL", "0")
				if fails {
					t.Setenv("SCANNER_FAIL", "1")
				}
				installFakeImageTool(t, tool, `
test -d "$TMPDIR"
printf '%s\n' "$@" > "$COMMAND_LOG/$(basename "$TMPDIR").args"
printf '%s' "$TMPDIR" > "$COMMAND_LOG/$(basename "$TMPDIR").tmp"
echo 'unremoved scanner data' > "$TMPDIR/leftover"
if [ "$SCANNER_FAIL" = 1 ]; then exit 7; fi
echo '{}'
`)
				workDir := t.TempDir()
				config := &ImageBuildConfig{
					WorkDir: workDir, LogDir: workDir, Tags: []string{"v1"},
					OCIPathWithoutTag: "registry.example.com/built",
					AlternateImageRef: "upstream.example.com/reference@sha256:" + strings.Repeat("a", 64),
				}
				wantRef := "registry:registry.example.com/built:v1"
				if scanner == "custom-syft" {
					config.SkipMainRegistryPush = true
					config.ExternalRegistries = []ExternalRegistryConfig{{RegistryURL: "custom.example.com/built"}}
					wantRef = "registry:custom.example.com/built:v1"
				}
				var err error
				if tool == "syft" {
					err = scanPushedImagesWithSyft(context.Background(), config)
				} else {
					wantRef = "registry:" + config.AlternateImageRef
					err = scanAlternateImage(context.Background(), config)
				}
				if fails {
					require.Error(t, err)
				} else {
					require.NoError(t, err)
				}
				calls, err := filepath.Glob(filepath.Join(commandLog, "*.args"))
				require.NoError(t, err)
				require.Len(t, calls, 2)
				var platforms []string
				for _, call := range calls {
					args, err := os.ReadFile(call)
					require.NoError(t, err)
					lines := strings.Split(strings.TrimSpace(string(args)), "\n")
					require.Equal(t, wantRef, lines[len(lines)-1])
					for i, arg := range lines {
						if arg == "--platform" {
							platforms = append(platforms, lines[i+1])
						}
					}
					tmpDir, err := os.ReadFile(strings.TrimSuffix(call, ".args") + ".tmp")
					require.NoError(t, err)
					require.Equal(t, workDir, filepath.Dir(string(tmpDir)))
					require.NoDirExists(t, string(tmpDir))
				}
				require.ElementsMatch(t, []string{"linux/aarch64", "linux/x86_64"}, platforms)
			})
		}
	}
}

func writeTestImageLayout(t *testing.T, workDir string, arches ...string) {
	t.Helper()
	imageLayout, err := layout.Write(workDir, empty.Index)
	require.NoError(t, err)
	for _, arch := range arches {
		img, err := mutate.ConfigFile(empty.Image, &v1.ConfigFile{OS: "linux", Architecture: arch})
		require.NoError(t, err)
		require.NoError(t, imageLayout.AppendImage(img, layout.WithPlatform(v1.Platform{OS: "linux", Architecture: arch})))
	}
}

func TestImageTestsCleanOwnedImages(t *testing.T) {
	for _, tc := range []struct {
		name         string
		loadFails    bool
		inspectFails bool
		testFails    bool
		preexisting  bool
	}{
		{name: "success"},
		{name: "test failure", testFails: true},
		{name: "partial load failure", loadFails: true},
		{name: "inspection failure", inspectFails: true},
		{name: "preserve existing reference", preexisting: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			commandLog := filepath.Join(t.TempDir(), "commands")
			archive := filepath.Join(t.TempDir(), "loaded.tar")
			t.Setenv("COMMAND_LOG", commandLog)
			t.Setenv("LOADED_ARCHIVE", archive)
			t.Setenv("LOAD_FAIL", "0")
			t.Setenv("REFERENCE_EXISTS", "0")
			t.Setenv("INSPECT_FAIL", "0")
			if tc.loadFails {
				t.Setenv("LOAD_FAIL", "1")
			}
			if tc.preexisting {
				t.Setenv("REFERENCE_EXISTS", "1")
			}
			if tc.inspectFails {
				t.Setenv("INSPECT_FAIL", "1")
			}
			installFakeImageTool(t, "docker", `
printf '%s\n' "$*" >> "$COMMAND_LOG"
case "$1 $2" in
  'load -i')
    cp "$3" "$LOADED_ARCHIVE"
    if [ "$LOAD_FAIL" = 1 ]; then exit 1; fi
    ;;
  'image inspect')
    if [ "$INSPECT_FAIL" = 1 ]; then echo 'Cannot connect to the Docker daemon' >&2; exit 1; fi
    if [ "$REFERENCE_EXISTS" = 0 ]; then echo "Error response from daemon: No such image: $3" >&2; exit 1; fi
    ;;
esac
`)
			workDir := t.TempDir()
			writeTestImageLayout(t, workDir, "amd64", "arm64")
			config := &ImageBuildConfig{WorkDir: workDir, Tags: []string{"v1"}, AlternateImageRef: "upstream.example.com/reference:v1"}
			script := `printf 'tested %s %s\n' '${{ourImage}}' '${{refImage}}' >> "$COMMAND_LOG"`
			if tc.testFails {
				script += "\nexit 1"
			}
			testDef := &ImageTestDefinition{Test: ImageTestConfig{Pipeline: []ImageTestStep{{Runs: script}}}}
			err := executeImageTest(context.Background(), config, testDef)
			if tc.loadFails || tc.testFails || tc.inspectFails {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
			require.NoFileExists(t, filepath.Join(workDir, "image.tar"))
			manifest, err := tarball.LoadManifest(func() (io.ReadCloser, error) { return os.Open(archive) })
			require.NoError(t, err)
			require.Len(t, manifest, 1, "only the native architecture should be loaded")
			require.Len(t, manifest[0].RepoTags, 1)
			tag := strings.TrimPrefix(manifest[0].RepoTags[0], "index.docker.io/library/")
			require.True(t, strings.HasPrefix(tag, "securebuild-test:"))
			require.True(t, strings.HasSuffix(tag, "-"+runtime.GOARCH))
			img, err := tarball.ImageFromPath(archive, nil)
			require.NoError(t, err)
			imageConfig, err := img.ConfigFile()
			require.NoError(t, err)
			require.Equal(t, runtime.GOARCH, imageConfig.Architecture)
			commands, err := os.ReadFile(commandLog)
			require.NoError(t, err)
			require.Contains(t, string(commands), "image rm "+tag+"\n")
			if !tc.loadFails && !tc.inspectFails {
				require.Contains(t, string(commands), "tested "+tag+" "+config.AlternateImageRef)
			}
			if tc.preexisting || tc.loadFails || tc.inspectFails {
				require.NotContains(t, string(commands), "image rm "+config.AlternateImageRef)
			} else {
				require.Contains(t, string(commands), "image rm "+config.AlternateImageRef+"\n")
			}
			require.NotContains(t, string(commands), "--force")
			require.NotContains(t, string(commands), "prune")
		})
	}
}

func TestDockerImageCleanupAfterCancellation(t *testing.T) {
	commandLog := filepath.Join(t.TempDir(), "commands")
	t.Setenv("COMMAND_LOG", commandLog)
	installFakeImageTool(t, "docker", `printf '%s\n' "$*" > "$COMMAND_LOG"`)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cleanupDockerTestImage(ctx, "securebuild-test:cancelled")
	commands, err := os.ReadFile(commandLog)
	require.NoError(t, err)
	require.Equal(t, "image rm securebuild-test:cancelled\n", string(commands))
}
