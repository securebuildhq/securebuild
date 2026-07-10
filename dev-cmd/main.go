package main

import (
	"debug/elf"
	"debug/macho"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

const (
	stackName   = "securebuild"
	composeFile = "docker-compose.yml"
	dbURI       = "DB_URI=postgres://postgres:password@localhost:15432/securebuild?sslmode=disable"
)

// goServices are the worker subcommands that use securebuild-config.yaml for configuration.
var goServices = map[string]bool{"worker": true, "apk-proxy": true, "oci-proxy": true}

// composeService is the Docker Compose service name (project stackName from Makefile).
type serviceConfig struct {
	compose string
}

var services = map[string]serviceConfig{
	"worker":    {compose: "worker"},
	"app":       {compose: "app"},
	"apk-proxy": {compose: "apk-proxy"},
	"oci-proxy": {compose: "oci-proxy"},
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "Usage: dev-cmd <worker|app|apk-proxy|oci-proxy|migrate>\n")
		os.Exit(1)
	}

	subcommand := os.Args[1]

	switch subcommand {
	case "worker", "app", "apk-proxy", "oci-proxy":
		runServiceShell(subcommand)
	case "migrate":
		runMigrateShell()
	default:
		fmt.Fprintf(os.Stderr, "Unknown subcommand: %s\n", subcommand)
		fmt.Fprintf(os.Stderr, "Usage: dev-cmd <worker|app|apk-proxy|oci-proxy|migrate>\n")
		os.Exit(1)
	}
}

func composeDockerArgs(extra ...string) []string {
	args := []string{"compose", "-p", stackName, "-f", composeFile}
	return append(args, extra...)
}

// composeEnv returns the current process environment with REPO_ROOT set to repoRoot
// (replacing any existing REPO_ROOT) so docker compose can interpolate docker-compose.yml.
func composeEnv(repoRoot string) []string {
	env := os.Environ()
	if repoRoot == "" {
		return env
	}
	const prefix = "REPO_ROOT="
	out := make([]string, 0, len(env)+1)
	for _, e := range env {
		if !strings.HasPrefix(e, prefix) {
			out = append(out, e)
		}
	}
	return append(out, prefix+repoRoot)
}

func setComposeCmdEnv(cmd *exec.Cmd) {
	wd, err := os.Getwd()
	if err != nil {
		return
	}
	cmd.Env = composeEnv(wd)
}

func checkStack() error {
	cmd := exec.Command("docker", composeDockerArgs("ps", "-q", "postgres")...)
	setComposeCmdEnv(cmd)
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf("failed to query docker compose (is the repo root your cwd?): %w", err)
	}
	if len(out) == 0 {
		return fmt.Errorf("dev stack %q does not appear to be running (postgres not up); run make dev-stack-up from repo root", stackName)
	}
	return nil
}

func composeStop(svc string) error {
	fmt.Printf("Stopping compose service %s...\n", svc)
	cmd := exec.Command("docker", composeDockerArgs("stop", svc)...)
	setComposeCmdEnv(cmd)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func composeStart(svc string) error {
	fmt.Printf("Starting compose service %s...\n", svc)
	cmd := exec.Command("docker", composeDockerArgs("start", svc)...)
	setComposeCmdEnv(cmd)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// isMacBinary checks if a binary is a macOS (Mach-O) binary vs Linux (ELF).
func isMacBinary(binaryPath string) (bool, error) {
	f, err := os.Open(binaryPath)
	if err != nil {
		return false, fmt.Errorf("open binary %s: %w", binaryPath, err)
	}
	defer f.Close()

	if _, err = macho.NewFile(f); err == nil {
		return true, nil
	}

	if _, err = f.Seek(0, 0); err != nil {
		return false, fmt.Errorf("seek %s: %w", binaryPath, err)
	}
	if _, err = elf.NewFile(f); err == nil {
		return false, nil
	}

	return false, fmt.Errorf("unknown binary format: %s", binaryPath)
}

// ensureNativeWorker removes bin/worker if it is a Linux (cross-compiled) binary
// so that make build-worker will rebuild it natively in the dev shell.
func ensureNativeWorker(repoRoot string) error {
	binPath := filepath.Join(repoRoot, "bin", "worker")

	info, err := os.Stat(binPath)
	if err != nil || !info.Mode().IsRegular() {
		return nil // doesn't exist, nothing to do
	}

	isMac, err := isMacBinary(binPath)
	if err == nil && isMac {
		return nil // already native
	}

	fmt.Println("bin/worker is a Linux binary — removing it. Run 'make build-worker' in the shell to rebuild.")
	return os.Remove(binPath)
}

func shell() string {
	if s := os.Getenv("SHELL"); s != "" {
		return s
	}
	return "/bin/sh"
}

// setupPrompt returns extra env vars and a cleanup function that together cause
// the spawned shell to append the service name in red to whatever prompt the
// user's shell config sets. No assumptions are made about the prompt format.
func setupPrompt(service string) (envVars []string, cleanup func()) {
	cleanup = func() {}
	sh := shell()
	label := "(" + service + ")"

	if strings.Contains(sh, "zsh") {
		tmpDir, err := os.MkdirTemp("", "securebuild-dev-*")
		if err != nil {
			return nil, cleanup
		}
		// Source the real .zshrc so all user config runs normally, then append
		// the label to whatever PROMPT it set. %F{red}...%f is zsh color syntax.
		zshrc := fmt.Sprintf("source \"$HOME/.zshrc\"\nPROMPT=\"${PROMPT}%%F{red}%s%%f \"\n", label)
		if err := os.WriteFile(filepath.Join(tmpDir, ".zshrc"), []byte(zshrc), 0600); err != nil {
			os.RemoveAll(tmpDir)
			return nil, cleanup
		}
		return []string{"ZDOTDIR=" + tmpDir}, func() { os.RemoveAll(tmpDir) }
	}

	// bash: source .bashrc then append to PS1.
	tmpDir, err := os.MkdirTemp("", "securebuild-dev-*")
	if err != nil {
		return nil, cleanup
	}
	bashrc := fmt.Sprintf("source \"$HOME/.bashrc\"\nPS1=\"${PS1}\\[\\e[31m\\]%s\\[\\e[0m\\] \"\n", label)
	if err := os.WriteFile(filepath.Join(tmpDir, ".bashrc"), []byte(bashrc), 0600); err != nil {
		os.RemoveAll(tmpDir)
		return nil, cleanup
	}
	return []string{"BASH_ENV=" + filepath.Join(tmpDir, ".bashrc")}, func() { os.RemoveAll(tmpDir) }
}

func spawnShell(dir string, extraEnv ...string) error {
	sh := shell()
	env := append(os.Environ(), extraEnv...)

	cmd := exec.Command(sh)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = env
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{}

	return cmd.Run()
}

func runServiceShell(subcommand string) {
	svc := services[subcommand]

	fmt.Printf("Checking that stack %q is running...\n", stackName)
	if err := checkStack(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if err := composeStop(svc.compose); err != nil {
		fmt.Fprintf(os.Stderr, "Error stopping %s: %v\n", svc.compose, err)
		os.Exit(1)
	}
	defer func() {
		if err := composeStart(svc.compose); err != nil {
			fmt.Fprintf(os.Stderr, "Warning: failed to start %s again: %v\n", svc.compose, err)
		}
	}()

	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error getting working directory: %v\n", err)
		os.Exit(1)
	}

	if goServices[subcommand] {
		if err := ensureNativeWorker(cwd); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	}

	var dir string
	promptVars, cleanupPrompt := setupPrompt(subcommand)
	defer cleanupPrompt()

	extraEnv := append([]string{dbURI}, promptVars...)
	if subcommand == "app" {
		dir = cwd + "/securebuild-app"
		extraEnv = append(extraEnv, "PIPELINE_DIR="+filepath.Join(cwd, "dev-pipelines"))
	} else if goServices[subcommand] {
		extraEnv = append(extraEnv,
			"SECUREBUILD_CONFIG_SOURCE="+cwd+"/securebuild-config.yaml",
			"PIPELINE_DIR="+filepath.Join(cwd, "dev-pipelines"),
		)
		if subcommand == "worker" {
			// Config often uses http://apk-proxy:8080 for in-compose workers; host melange/builder needs loopback.
			extraEnv = append(extraEnv, "APK_REPOSITORY=http://localhost:8080")
		}
	}

	fmt.Println("Dev shell extra environment:")
	for _, e := range extraEnv {
		fmt.Printf("  %s\n", e)
	}

	fmt.Printf("Starting dev shell. Exit the shell to start %s again.\n", svc.compose)
	if err := spawnShell(dir, extraEnv...); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			_ = exitErr
		} else {
			fmt.Fprintf(os.Stderr, "Shell error: %v\n", err)
		}
	}
}

func runMigrateShell() {
	fmt.Printf("Checking that stack %q is running...\n", stackName)
	if err := checkStack(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	promptVars, cleanupPrompt := setupPrompt("migrate")
	defer cleanupPrompt()

	fmt.Println("Starting migration shell. DB_URI is set. Run 'make migrate' to apply migrations.")
	if err := spawnShell("", append([]string{dbURI}, promptVars...)...); err != nil {
		if _, ok := err.(*exec.ExitError); !ok {
			fmt.Fprintf(os.Stderr, "Shell error: %v\n", err)
		}
	}
}
