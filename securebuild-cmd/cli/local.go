package cli

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/spf13/cobra"
)

type localCommandRunner func(context.Context, string, string, ...string) error

type localNixBuildOptions struct {
	workDir       string
	installable   string
	outLink       string
	updateLock    bool
	impure        bool
	commandRunner localCommandRunner
}

type localNixCheckOptions struct {
	workDir       string
	flakeRef      string
	updateLock    bool
	impure        bool
	commandRunner localCommandRunner
}

func LocalCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "local",
		Short: "Build Nix packages and images on this machine",
		Long:  "Build and test flake outputs locally with Nix. No SecureBuild API, database, Melange, APKO, or APK repository is used.",
	}

	cmd.AddCommand(LocalPackageCmd())
	cmd.AddCommand(LocalImageCmd())
	cmd.AddCommand(LocalCheckCmd())
	cmd.AddCommand(LocalDoctorCmd())
	return cmd
}

func LocalPackageCmd() *cobra.Command {
	opts := localNixBuildOptions{
		workDir:       ".",
		installable:   ".",
		outLink:       "result",
		commandRunner: runLocalCommand,
	}

	cmd := &cobra.Command{
		Use:   "package [flake-installable]",
		Short: "Build a Nix package output",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 {
				opts.installable = args[0]
			}
			return runLocalNixBuild(cmd.Context(), "package", opts)
		},
	}

	addLocalNixBuildFlags(cmd, &opts)
	return cmd
}

func LocalImageCmd() *cobra.Command {
	opts := localNixBuildOptions{
		workDir:       ".",
		installable:   defaultLocalImageInstallable(runtime.GOOS, runtime.GOARCH),
		outLink:       "result-image",
		commandRunner: runLocalCommand,
	}

	cmd := &cobra.Command{
		Use:   "image [flake-installable]",
		Short: "Build a Nix-defined container image",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 {
				opts.installable = args[0]
			}
			return runLocalNixBuild(cmd.Context(), "image", opts)
		},
	}

	addLocalNixBuildFlags(cmd, &opts)
	return cmd
}

func LocalCheckCmd() *cobra.Command {
	opts := localNixCheckOptions{
		workDir:       ".",
		flakeRef:      ".",
		commandRunner: runLocalCommand,
	}

	cmd := &cobra.Command{
		Use:   "check [flake-ref]",
		Short: "Run the checks declared by a Nix flake",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 1 {
				opts.flakeRef = args[0]
			}
			return runLocalNixCheck(cmd.Context(), opts)
		},
	}

	cmd.Flags().StringVar(&opts.workDir, "work-dir", opts.workDir, "Directory containing the flake")
	cmd.Flags().BoolVar(&opts.updateLock, "update-lock-file", false, "Allow Nix to update flake.lock")
	cmd.Flags().BoolVar(&opts.impure, "impure", false, "Allow impure Nix evaluation")
	return cmd
}

func LocalDoctorCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "doctor",
		Short: "Check that Nix and its store are usable",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			nixPath, err := exec.LookPath("nix")
			if err != nil {
				fmt.Fprintln(cmd.OutOrStdout(), "missing  nix")
				return fmt.Errorf("nix is not on PATH; install Nix before using local builds")
			}

			versionCmd := exec.CommandContext(cmd.Context(), nixPath, "--version")
			version, err := versionCmd.Output()
			if err != nil {
				return fmt.Errorf("run nix --version: %w", err)
			}
			fmt.Fprintf(cmd.OutOrStdout(), "ready    nix      %s (%s)\n", nixPath, strings.TrimSpace(string(version)))

			pingCmd := exec.CommandContext(cmd.Context(), nixPath, "store", "ping")
			if output, err := pingCmd.CombinedOutput(); err != nil {
				return fmt.Errorf("Nix store is not usable: %w: %s", err, strings.TrimSpace(string(output)))
			}
			fmt.Fprintln(cmd.OutOrStdout(), "ready    store    default Nix store responded")
			return nil
		},
	}
}

func addLocalNixBuildFlags(cmd *cobra.Command, opts *localNixBuildOptions) {
	cmd.Flags().StringVar(&opts.workDir, "work-dir", opts.workDir, "Directory containing the flake")
	cmd.Flags().StringVarP(&opts.outLink, "out-link", "o", opts.outLink, "Symlink to the Nix store output; use an empty value for no link")
	cmd.Flags().BoolVar(&opts.updateLock, "update-lock-file", false, "Allow Nix to update flake.lock")
	cmd.Flags().BoolVar(&opts.impure, "impure", false, "Allow impure Nix evaluation")
}

func runLocalNixBuild(ctx context.Context, artifactKind string, opts localNixBuildOptions) error {
	workDir, err := resolveLocalWorkDir(opts.workDir)
	if err != nil {
		return err
	}

	installable := normalizeLocalFlakeRef(workDir, opts.installable)
	args := []string{"build", installable, "--print-out-paths"}
	args = appendLockOptions(args, opts.updateLock)
	if opts.impure {
		args = append(args, "--impure")
	}

	if opts.outLink == "" {
		args = append(args, "--no-link")
	} else {
		outLink := resolveFromWorkDir(workDir, opts.outLink)
		if err := os.MkdirAll(filepath.Dir(outLink), 0o755); err != nil {
			return fmt.Errorf("create output link directory: %w", err)
		}
		args = append(args, "--out-link", outLink)
	}

	fmt.Fprintf(os.Stderr, "Building Nix %s %s\n", artifactKind, installable)
	if err := opts.commandRunner(ctx, workDir, "nix", args...); err != nil {
		return fmt.Errorf("nix build %s: %w", installable, err)
	}
	if opts.outLink != "" {
		fmt.Fprintf(os.Stderr, "Local %s output link: %s\n", artifactKind, resolveFromWorkDir(workDir, opts.outLink))
	}
	return nil
}

func runLocalNixCheck(ctx context.Context, opts localNixCheckOptions) error {
	workDir, err := resolveLocalWorkDir(opts.workDir)
	if err != nil {
		return err
	}

	flakeRef := normalizeLocalFlakeRef(workDir, opts.flakeRef)
	args := []string{"flake", "check", flakeRef}
	args = appendLockOptions(args, opts.updateLock)
	if opts.impure {
		args = append(args, "--impure")
	}

	fmt.Fprintf(os.Stderr, "Checking Nix flake %s\n", flakeRef)
	if err := opts.commandRunner(ctx, workDir, "nix", args...); err != nil {
		return fmt.Errorf("nix flake check %s: %w", flakeRef, err)
	}
	return nil
}

func appendLockOptions(args []string, updateLock bool) []string {
	if updateLock {
		return args
	}
	return append(args, "--no-update-lock-file", "--no-write-lock-file")
}

func runLocalCommand(ctx context.Context, workDir, name string, args ...string) error {
	path, err := exec.LookPath(name)
	if err != nil {
		return fmt.Errorf("%s is not on PATH: %w", name, err)
	}
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir = workDir
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func resolveLocalWorkDir(workDir string) (string, error) {
	absWorkDir, err := filepath.Abs(workDir)
	if err != nil {
		return "", fmt.Errorf("resolve work directory: %w", err)
	}
	info, err := os.Stat(absWorkDir)
	if err != nil {
		return "", fmt.Errorf("read work directory %s: %w", absWorkDir, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("work directory %s is not a directory", absWorkDir)
	}
	return absWorkDir, nil
}

func normalizeLocalFlakeRef(workDir, ref string) string {
	if ref == "." {
		return "path:" + workDir
	}
	if strings.HasPrefix(ref, ".#") {
		return "path:" + workDir + strings.TrimPrefix(ref, ".")
	}
	return ref
}

func defaultLocalImageInstallable(goos, goarch string) string {
	if goos != "darwin" {
		return ".#securebuild-image"
	}
	if goarch == "arm64" {
		return ".#packages.aarch64-linux.securebuild-image"
	}
	return ".#packages.x86_64-linux.securebuild-image"
}

func resolveFromWorkDir(workDir, path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(workDir, path)
}
