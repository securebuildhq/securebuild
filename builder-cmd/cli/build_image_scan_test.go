package cli

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImageScansUseRegistryAndWorkspaceTemp(t *testing.T) {
	for _, scanner := range []struct {
		name string
		run  func(context.Context, *ImageBuildConfig) error
	}{
		{"syft", scanPushedImagesWithSyft},
		{"grype", scanAlternateImage},
	} {
		for _, exitCode := range []string{"0", "7"} {
			t.Run(scanner.name+"/exit-"+exitCode, func(t *testing.T) {
				workDir := t.TempDir()
				binDir := t.TempDir()
				// A scanner that checks its source and inherited environment,
				// then leaves temporary data as an interrupted scan could.
				script := `#!/bin/sh
[ "$1" = "--from" ] && [ "$2" = "registry" ] || exit 91
[ "$TMPDIR" = "$EXPECTED_SCAN_TMPDIR" ] || exit 92
[ "$SCAN_INHERITED_ENV" = "preserved" ] || exit 93
mktemp "$TMPDIR/scanner-XXXXXX" >/dev/null || exit 94
printf '{}\n'
exit "$SCAN_EXIT_CODE"
`
				if err := os.WriteFile(filepath.Join(binDir, scanner.name), []byte(script), 0o755); err != nil {
					t.Fatal(err)
				}
				t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
				t.Setenv("TMPDIR", t.TempDir())
				t.Setenv("EXPECTED_SCAN_TMPDIR", workDir)
				t.Setenv("SCAN_INHERITED_ENV", "preserved")
				t.Setenv("SCAN_EXIT_CODE", exitCode)

				// Exercise a relative workspace too: TMPDIR must be absolute
				// because the scanner changes its working directory.
				cwd, err := os.Getwd()
				if err != nil {
					t.Fatal(err)
				}
				relWorkDir, err := filepath.Rel(cwd, workDir)
				if err != nil {
					t.Fatal(err)
				}
				err = scanner.run(context.Background(), &ImageBuildConfig{
					WorkDir: relWorkDir, LogDir: workDir,
					Tags: []string{"1.0"}, OCIPathWithoutTag: "registry.example.com/image",
					AlternateImageRef: "registry.example.com/upstream:1.0",
				})
				if exitCode == "0" && err != nil {
					t.Fatalf("scan failed: %v", err)
				}
				if exitCode != "0" && (err == nil || !strings.Contains(err.Error(), "exit status "+exitCode)) {
					t.Fatalf("expected scanner exit %s, got %v", exitCode, err)
				}
				files, err := filepath.Glob(filepath.Join(workDir, "scanner-*"))
				if err != nil || len(files) != 2 {
					t.Fatalf("expected temporary data from both scans inside the workspace; files=%v, err=%v", files, err)
				}
			})
		}
	}
}
