package cli

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
)

type recordedLocalCommand struct {
	workDir string
	name    string
	args    []string
}

func TestRunLocalNixBuildUsesLocalPathFlakeAndPinnedLock(t *testing.T) {
	workDir := t.TempDir()
	commands := []recordedLocalCommand{}
	runner := func(_ context.Context, dir, name string, args ...string) error {
		commands = append(commands, recordedLocalCommand{workDir: dir, name: name, args: append([]string(nil), args...)})
		return nil
	}

	err := runLocalNixBuild(context.Background(), "package", localNixBuildOptions{
		workDir:       workDir,
		installable:   ".#example",
		outLink:       "output/package",
		commandRunner: runner,
	})
	if err != nil {
		t.Fatal(err)
	}

	want := recordedLocalCommand{
		workDir: workDir,
		name:    "nix",
		args: []string{
			"build",
			"path:" + workDir + "#example",
			"--print-out-paths",
			"--no-update-lock-file",
			"--no-write-lock-file",
			"--out-link",
			filepath.Join(workDir, "output/package"),
		},
	}
	if !reflect.DeepEqual(commands, []recordedLocalCommand{want}) {
		t.Fatalf("unexpected Nix build command: %#v", commands)
	}
}

func TestRunLocalNixBuildSupportsImpureUnlockedBuildWithoutLink(t *testing.T) {
	workDir := t.TempDir()
	commands := []recordedLocalCommand{}
	runner := func(_ context.Context, dir, name string, args ...string) error {
		commands = append(commands, recordedLocalCommand{workDir: dir, name: name, args: append([]string(nil), args...)})
		return nil
	}

	err := runLocalNixBuild(context.Background(), "image", localNixBuildOptions{
		workDir:       workDir,
		installable:   "github:example/project#image",
		outLink:       "",
		updateLock:    true,
		impure:        true,
		commandRunner: runner,
	})
	if err != nil {
		t.Fatal(err)
	}

	wantArgs := []string{
		"build",
		"github:example/project#image",
		"--print-out-paths",
		"--impure",
		"--no-link",
	}
	if len(commands) != 1 || commands[0].name != "nix" || !reflect.DeepEqual(commands[0].args, wantArgs) {
		t.Fatalf("unexpected Nix build command: %#v", commands)
	}
}

func TestRunLocalNixCheck(t *testing.T) {
	workDir := t.TempDir()
	commands := []recordedLocalCommand{}
	runner := func(_ context.Context, dir, name string, args ...string) error {
		commands = append(commands, recordedLocalCommand{workDir: dir, name: name, args: append([]string(nil), args...)})
		return nil
	}

	err := runLocalNixCheck(context.Background(), localNixCheckOptions{
		workDir:       workDir,
		flakeRef:      ".",
		commandRunner: runner,
	})
	if err != nil {
		t.Fatal(err)
	}

	wantArgs := []string{
		"flake",
		"check",
		"path:" + workDir,
		"--no-update-lock-file",
		"--no-write-lock-file",
	}
	if len(commands) != 1 || commands[0].name != "nix" || !reflect.DeepEqual(commands[0].args, wantArgs) {
		t.Fatalf("unexpected Nix check command: %#v", commands)
	}
}

func TestNormalizeLocalFlakeRef(t *testing.T) {
	workDir := "/workspace/example"
	tests := map[string]string{
		".":                              "path:/workspace/example",
		".#package":                      "path:/workspace/example#package",
		"path:/another/project#package":  "path:/another/project#package",
		"github:example/project#package": "github:example/project#package",
		"nixpkgs#hello":                  "nixpkgs#hello",
	}
	for input, want := range tests {
		if got := normalizeLocalFlakeRef(workDir, input); got != want {
			t.Errorf("normalizeLocalFlakeRef(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDefaultLocalImageInstallable(t *testing.T) {
	tests := []struct {
		goos   string
		goarch string
		want   string
	}{
		{goos: "linux", goarch: "arm64", want: ".#securebuild-image"},
		{goos: "darwin", goarch: "arm64", want: ".#packages.aarch64-linux.securebuild-image"},
		{goos: "darwin", goarch: "amd64", want: ".#packages.x86_64-linux.securebuild-image"},
	}
	for _, test := range tests {
		if got := defaultLocalImageInstallable(test.goos, test.goarch); got != test.want {
			t.Errorf("defaultLocalImageInstallable(%q, %q) = %q, want %q", test.goos, test.goarch, got, test.want)
		}
	}
}

func TestLocalCommandsAreExposed(t *testing.T) {
	root := RootCmd()
	for _, args := range [][]string{{"local"}, {"local", "package"}, {"local", "image"}, {"local", "check"}, {"local", "doctor"}} {
		cmd, _, err := root.Find(args)
		if err != nil {
			t.Fatalf("find %v: %v", args, err)
		}
		if cmd == root {
			t.Fatalf("%v resolved to root command", args)
		}
	}
}
