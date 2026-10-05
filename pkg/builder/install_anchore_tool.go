package builder

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/securebuildhq/securebuild/pkg/anchoretool"
	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
)

const (
	localAnchoreToolInstallDir = "/usr/local/bin"
	remoteVersionProbeTimeout  = 15 * time.Second
)

func installAnchoreTool(ctx context.Context, vm types.BuilderVM, tool anchoretool.Tool, updateGrypeDB bool) error {
	if vm.Type == "local" {
		return localInstallAnchoreTool(ctx, vm, tool, updateGrypeDB)
	}

	version, err := anchoretool.Version(tool)
	if err != nil {
		return err
	}
	client, err := GetSSHClient(ctx, vm)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	probeCtx, cancelProbe := context.WithTimeout(ctx, remoteVersionProbeTimeout)
	probeCommand := fmt.Sprintf("if command -v %[1]s >/dev/null 2>&1; then %[1]s version; fi", tool.Name)
	installedVersion, versionErr := runRemoteCommand(probeCtx, client.Client, vm.ID, tool.Name, probeCommand)
	probeContextErr := probeCtx.Err()
	cancelProbe()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if errors.Is(probeContextErr, context.DeadlineExceeded) {
		logger.Warn(tool.Name+" version probe timed out; replacing the existing binary",
			zap.String("vmID", vm.ID), zap.Duration("timeout", remoteVersionProbeTimeout))
	}
	if versionErr == nil && anchoretool.VersionMatches(installedVersion, version) {
		logger.Info(tool.Name+" already matches worker version, skipping install",
			zap.String("vmID", vm.ID), zap.String("version", version))
	} else {
		goarch, err := builderArchitectureToGoArch(vm.Architecture)
		if err != nil {
			return err
		}
		release, err := anchoretool.Load(ctx, tool, "linux", goarch)
		if err != nil {
			return fmt.Errorf("load verified %s release: %w", tool.Name, err)
		}

		if err := installRemoteVerifiedBinary(ctx, client.Client, vm.ID, tool.Name, release.Binary); err != nil {
			return fmt.Errorf("install verified %s binary on VM %s: %w", tool.Name, vm.ID, err)
		}
		validationCommand := fmt.Sprintf(`
set -e
installed_version="$(%[1]s version)"
printf '%%s\n' "$installed_version"
actual_version="$(printf '%%s\n' "$installed_version" | awk -F ': *' 'tolower($1) == "version" {sub(/^v/, "", $2); print $2}')"
test "$actual_version" = %[2]q
`, filepath.Join(localAnchoreToolInstallDir, tool.Name), release.Version)
		if err := runRemoteInstallCommand(ctx, client.Client, vm.ID, tool.Name, validationCommand); err != nil {
			return fmt.Errorf("validate installed %s on VM %s: %w", tool.Name, vm.ID, err)
		}
		logger.Info("installed verified Anchore tool",
			zap.String("vmID", vm.ID), zap.String("tool", tool.Name), zap.String("version", release.Version))
	}

	if updateGrypeDB {
		if err := runRemoteInstallCommand(ctx, client.Client, vm.ID, tool.Name, "grype db update"); err != nil {
			return fmt.Errorf("update grype database on VM %s: %w", vm.ID, err)
		}
	}
	return nil
}

func installRemoteVerifiedBinary(ctx context.Context, client *ssh.Client, vmID, name string, contents []byte) error {
	digest := fmt.Sprintf("%x", sha256.Sum256(contents))
	command := remoteVerifiedBinaryInstallCommand(name, digest)
	logger.Trace("streaming verified Anchore binary to root-owned staging file",
		zap.String("vmID", vmID), zap.String("tool", name), zap.String("sha256", digest))

	session, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("create SSH install session: %w: %w", ErrSSH, err)
	}
	defer session.Close()
	session.Stdin = bytes.NewReader(contents)

	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			session.Close()
		case <-done:
		}
	}()

	output, err := session.CombinedOutput(command)
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	if err != nil {
		return fmt.Errorf("stream and atomically install binary: %w (output: %s)", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func remoteVerifiedBinaryInstallCommand(name, digest string) string {
	destination := filepath.Join(localAnchoreToolInstallDir, name)
	return verifiedBinaryInstallCommand(destination, digest)
}

func verifiedBinaryInstallCommand(destination, digest string) string {
	return fmt.Sprintf(`sudo sh -c '
set -eu
destination="$1"
expected="$2"
mkdir -p "$(dirname "$destination")"
staged="$(mktemp "${destination}.securebuild.XXXXXX")"
cleanup() {
  if [ -n "${staged:-}" ]; then
    rm -f "$staged"
  fi
}
trap cleanup EXIT
cat > "$staged"
actual="$(sha256sum "$staged" | cut -d " " -f 1)"
test "$actual" = "$expected"
chmod 0755 "$staged"
mv -f "$staged" "$destination"
staged=""
' securebuild-install %q %q`, destination, digest)
}

func runRemoteInstallCommand(ctx context.Context, client *ssh.Client, vmID, toolName, command string) error {
	_, err := runRemoteCommand(ctx, client, vmID, toolName, command)
	return err
}

func runRemoteCommand(ctx context.Context, client *ssh.Client, vmID, toolName, command string) (string, error) {
	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var stdout strings.Builder
	var stderr strings.Builder
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Trace(toolName+" stdout", zap.String("vmID", vmID), zap.String("output", line))
			stdout.WriteString(line)
			stdout.WriteByte('\n')
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Trace(toolName+" stderr", zap.String("vmID", vmID), zap.String("output", line))
			stderr.WriteString(line)
			stderr.WriteByte('\n')
		}
	}()
	err := RunCommand(ctx, client, vmID, command, stdoutCh, stderrCh)
	wg.Wait()
	combinedOutput := stdout.String() + stderr.String()
	if err != nil && stderr.Len() > 0 {
		return combinedOutput, fmt.Errorf("%w (stderr: %s)", err, strings.TrimSpace(stderr.String()))
	}
	return combinedOutput, err
}

func builderArchitectureToGoArch(architecture string) (string, error) {
	switch architecture {
	case "x86_64", "amd64":
		return "amd64", nil
	case "aarch64", "arm64":
		return "arm64", nil
	default:
		return "", fmt.Errorf("unsupported builder architecture %q", architecture)
	}
}

func localInstallAnchoreTool(ctx context.Context, vm types.BuilderVM, tool anchoretool.Tool, updateGrypeDB bool) error {
	version, err := anchoretool.Version(tool)
	if err != nil {
		return err
	}
	if path, err := exec.LookPath(tool.Name); err == nil {
		installedVersion, versionErr := localCommandCombinedOutput(ctx, path, "version")
		if versionErr == nil && anchoretool.VersionMatches(installedVersion, version) {
			logger.Info(tool.Name+" already matches worker version, skipping install",
				zap.String("vmID", vm.ID), zap.String("path", path), zap.String("version", version))
			if updateGrypeDB {
				output, updateErr := localCommandCombinedOutput(ctx, path, "db", "update")
				if updateErr != nil {
					return fmt.Errorf("update grype database: %w (output: %s)", updateErr, strings.TrimSpace(output))
				}
			}
			return nil
		}
	}

	release, err := anchoretool.Load(ctx, tool, runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return fmt.Errorf("load verified %s release: %w", tool.Name, err)
	}
	if err := installLocalBinary(tool.Name, release.Binary); err != nil {
		return err
	}
	installedPath := filepath.Join(localAnchoreToolInstallDir, tool.Name)
	resolvedPath, err := requireLocalToolOnPath(tool.Name, installedPath)
	if err != nil {
		return err
	}
	installedVersion, err := localCommandCombinedOutput(ctx, resolvedPath, "version")
	if err != nil {
		return fmt.Errorf("check installed %s version: %w", tool.Name, err)
	}
	if !anchoretool.VersionMatches(installedVersion, release.Version) {
		return fmt.Errorf("installed %s version does not match worker version %s: %s", tool.Name, release.Version, strings.TrimSpace(installedVersion))
	}
	if updateGrypeDB {
		if output, err := localCommandCombinedOutput(ctx, resolvedPath, "db", "update"); err != nil {
			return fmt.Errorf("update grype database: %w (output: %s)", err, strings.TrimSpace(output))
		}
	}
	logger.Info("installed verified Anchore tool",
		zap.String("vmID", vm.ID), zap.String("tool", tool.Name), zap.String("version", release.Version))
	return nil
}

func requireLocalToolOnPath(name, installedPath string) (string, error) {
	resolvedPath, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("verified %s was installed at %s, but it is not available on PATH: %w", name, installedPath, err)
	}
	installedInfo, err := os.Stat(installedPath)
	if err != nil {
		return "", fmt.Errorf("stat installed %s binary at %s: %w", name, installedPath, err)
	}
	resolvedInfo, err := os.Stat(resolvedPath)
	if err != nil {
		return "", fmt.Errorf("stat PATH-resolved %s binary at %s: %w", name, resolvedPath, err)
	}
	if !os.SameFile(installedInfo, resolvedInfo) {
		return "", fmt.Errorf("verified %s was installed at %s, but PATH resolves %s; place %s before the shadowing directory", name, installedPath, resolvedPath, localAnchoreToolInstallDir)
	}
	return resolvedPath, nil
}

func installLocalBinary(name string, contents []byte) (err error) {
	installDir := localAnchoreToolInstallDir
	if err := os.MkdirAll(installDir, 0755); err != nil {
		return fmt.Errorf("create %s: %w", installDir, err)
	}
	temp, err := os.CreateTemp(installDir, ".securebuild-"+name+"-")
	if err != nil {
		return fmt.Errorf("create temporary %s binary: %w", name, err)
	}
	tempPath := temp.Name()
	defer func() {
		temp.Close()
		if err != nil {
			os.Remove(tempPath)
		}
	}()
	if _, err = temp.Write(contents); err != nil {
		return fmt.Errorf("write temporary %s binary: %w", name, err)
	}
	if err = temp.Chmod(0755); err != nil {
		return fmt.Errorf("make temporary %s binary executable: %w", name, err)
	}
	if err = temp.Close(); err != nil {
		return fmt.Errorf("close temporary %s binary: %w", name, err)
	}
	destination := filepath.Join(installDir, name)
	if err = os.Rename(tempPath, destination); err != nil {
		return fmt.Errorf("install %s to %s: %w", name, destination, err)
	}
	return nil
}
