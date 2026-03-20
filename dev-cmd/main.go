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
	stackName = "securebuild"
	checkSvc  = "securebuild_postgres"
	dbURI     = "DB_URI=postgres://postgres:password@localhost:15432/securebuild?sslmode=disable"
)

// goServices are the worker subcommands that use config-cmx.yaml for configuration.
var goServices = map[string]bool{"worker": true, "apk-proxy": true, "oci-proxy": true}

type serviceConfig struct {
	name          string
	publishedPort int // >0: remove port on scale-down, restore on scale-up
}

var services = map[string]serviceConfig{
	"worker":    {name: "securebuild_worker"},
	"app":       {name: "securebuild_app", publishedPort: 3000},
	"apk-proxy": {name: "securebuild_apk-proxy"},
	"oci-proxy": {name: "securebuild_oci-proxy"},
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

func checkStack() error {
	out, err := exec.Command("docker", "service", "ls", "--filter", "name="+checkSvc, "--format", "{{.Name}}").Output()
	if err != nil {
		return fmt.Errorf("failed to query docker services: %w", err)
	}
	if len(out) == 0 {
		return fmt.Errorf("stack %q does not appear to be running (service %q not found)", stackName, checkSvc)
	}
	return nil
}

func scaleService(svcName string, replicas int) error {
	fmt.Printf("Scaling %s to %d...\n", svcName, replicas)
	cmd := exec.Command("docker", "service", "scale", fmt.Sprintf("%s=%d", svcName, replicas))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func scaleDownWithPort(svc serviceConfig) error {
	fmt.Printf("Removing port %d and scaling %s to 0...\n", svc.publishedPort, svc.name)
	cmd := exec.Command("docker", "service", "update",
		"--publish-rm", fmt.Sprintf("%d", svc.publishedPort),
		"--replicas", "0",
		svc.name)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func scaleUpWithPort(svc serviceConfig) error {
	fmt.Printf("Restoring port %d and scaling %s to 1...\n", svc.publishedPort, svc.name)
	cmd := exec.Command("docker", "service", "update",
		"--publish-add", fmt.Sprintf("published=%d,target=%d", svc.publishedPort, svc.publishedPort),
		"--replicas", "1",
		svc.name)
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

	if svc.publishedPort > 0 {
		if err := scaleDownWithPort(svc); err != nil {
			fmt.Fprintf(os.Stderr, "Error scaling down %s: %v\n", svc.name, err)
			os.Exit(1)
		}
		defer func() {
			if err := scaleUpWithPort(svc); err != nil {
				fmt.Fprintf(os.Stderr, "Warning: failed to restore %s: %v\n", svc.name, err)
			}
		}()
	} else {
		if err := scaleService(svc.name, 0); err != nil {
			fmt.Fprintf(os.Stderr, "Error scaling down %s: %v\n", svc.name, err)
			os.Exit(1)
		}
		defer func() {
			if err := scaleService(svc.name, 1); err != nil {
				fmt.Fprintf(os.Stderr, "Warning: failed to scale %s back up: %v\n", svc.name, err)
			}
		}()
	}

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
	} else if goServices[subcommand] {
		extraEnv = append(extraEnv, "SECUREBUILD_CONFIG_SOURCE="+cwd+"/config-cmx.yaml")
	}

	fmt.Printf("Starting dev shell (DB_URI is set). Exit the shell to scale %s back up.\n", svc.name)
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
