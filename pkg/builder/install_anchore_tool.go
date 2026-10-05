package builder

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/securebuildhq/securebuild/pkg/anchoretool"
	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
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
		return fmt.Errorf("failed to get ssh client for VM %s: %w", vm.ID, err)
	}
	defer client.Close()

	installedVersion, versionErr := remoteCommandCombinedOutput(client.Client, tool.Name+" version")
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

		remoteTempPath := fmt.Sprintf("/tmp/securebuild-%s-%s", tool.Name, release.Version)
		if err := CreateRemoteBinaryFile(client.Client, remoteTempPath, release.Binary); err != nil {
			return fmt.Errorf("upload verified %s binary to VM %s: %w", tool.Name, vm.ID, err)
		}
		command := fmt.Sprintf(`
set -e
trap 'rm -f %[1]s' EXIT
sudo install -m 0755 %[1]s /usr/local/bin/%[2]s
installed_version="$(%[2]s version)"
printf '%%s\n' "$installed_version"
actual_version="$(printf '%%s\n' "$installed_version" | awk -F ': *' 'tolower($1) == "version" {sub(/^v/, "", $2); print $2}')"
test "$actual_version" = %[3]q
`, remoteTempPath, tool.Name, release.Version)
		if err := runRemoteInstallCommand(ctx, client.Client, vm.ID, tool.Name, command); err != nil {
			return fmt.Errorf("install verified %s on VM %s: %w", tool.Name, vm.ID, err)
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

func runRemoteInstallCommand(ctx context.Context, client *ssh.Client, vmID, toolName, command string) error {
	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Trace(toolName+" stdout", zap.String("vmID", vmID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Trace(toolName+" stderr", zap.String("vmID", vmID), zap.String("output", line))
		}
	}()
	err := RunCommand(ctx, client, vmID, command, stdoutCh, stderrCh)
	wg.Wait()
	return err
}

func remoteCommandCombinedOutput(client *ssh.Client, command string) (string, error) {
	session, err := client.NewSession()
	if err != nil {
		return "", err
	}
	defer session.Close()
	output, err := session.CombinedOutput(command)
	return string(output), err
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
		installedVersion, versionErr := localCommandCombinedOutput(ctx, tool.Name, "version")
		if versionErr == nil && anchoretool.VersionMatches(installedVersion, version) {
			logger.Info(tool.Name+" already matches worker version, skipping install",
				zap.String("vmID", vm.ID), zap.String("path", path), zap.String("version", version))
			if updateGrypeDB {
				output, updateErr := localCommandCombinedOutput(ctx, "grype", "db", "update")
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
	installedVersion, err := localCommandCombinedOutput(ctx, tool.Name, "version")
	if err != nil {
		return fmt.Errorf("check installed %s version: %w", tool.Name, err)
	}
	if !anchoretool.VersionMatches(installedVersion, release.Version) {
		return fmt.Errorf("installed %s version does not match worker version %s: %s", tool.Name, release.Version, strings.TrimSpace(installedVersion))
	}
	if updateGrypeDB {
		if output, err := localCommandCombinedOutput(ctx, "grype", "db", "update"); err != nil {
			return fmt.Errorf("update grype database: %w (output: %s)", err, strings.TrimSpace(output))
		}
	}
	logger.Info("installed verified Anchore tool",
		zap.String("vmID", vm.ID), zap.String("tool", tool.Name), zap.String("version", release.Version))
	return nil
}

func installLocalBinary(name string, contents []byte) (err error) {
	installDir := "/usr/local/bin"
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
