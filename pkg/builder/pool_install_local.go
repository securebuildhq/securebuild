package builder

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
)

// Versions for local auto-install (host GOOS may differ from Linux VMs).
// Local install runs in the worker process environment (e.g. worker container as root): no sudo.
const (
	localInstallMelangeVersion = "0.43.3"
	localInstallApkoVersion    = "0.27.6"
)

func localInstallMelange(ctx context.Context, vm types.BuilderVM) error {
	if path, err := exec.LookPath("melange"); err == nil {
		ver, _ := localCommandCombinedOutput(ctx, "melange", "version")
		logger.Info("melange already on PATH, skipping install",
			zap.String("vmID", vm.ID),
			zap.String("path", path),
			zap.String("version", strings.TrimSpace(ver)))
		return nil
	}
	url, dirName, err := melangeReleaseArtifactForHost(vm.Architecture)
	if err != nil {
		return err
	}
	script := fmt.Sprintf(`
set -e
cd "$(mktemp -d)"
echo "Downloading melange..."
curl -sSL %q -o melange.tar.gz
echo "Extracting melange..."
tar -xzf melange.tar.gz
echo "Installing melange..."
mkdir -p /usr/local/bin
cp %q/melange /usr/local/bin/melange
chmod 0755 /usr/local/bin/melange
echo "Checking melange version..."
melange version
`, url, dirName)
	return runLocalInstallScript(ctx, "install melange", script)
}

func localInstallApko(ctx context.Context, vm types.BuilderVM) error {
	if path, err := exec.LookPath("apko"); err == nil {
		ver, _ := localCommandCombinedOutput(ctx, "apko", "version")
		logger.Info("apko already on PATH, skipping install",
			zap.String("vmID", vm.ID),
			zap.String("path", path),
			zap.String("version", strings.TrimSpace(ver)))
		return nil
	}
	url, dirName, err := apkoReleaseArtifactForHost(vm.Architecture)
	if err != nil {
		return err
	}
	script := fmt.Sprintf(`
set -e
cd "$(mktemp -d)"
echo "Downloading apko..."
curl -sSL %q -o apko.tar.gz
echo "Extracting apko..."
tar -xzf apko.tar.gz
echo "Installing apko..."
mkdir -p /usr/local/bin
cp %q/apko /usr/local/bin/apko
chmod 0755 /usr/local/bin/apko
echo "Checking apko version..."
apko version
`, url, dirName)
	return runLocalInstallScript(ctx, "install apko", script)
}

func localInstallGrype(ctx context.Context, vm types.BuilderVM) error {
	if path, err := exec.LookPath("grype"); err == nil {
		ver, _ := localCommandCombinedOutput(ctx, "grype", "version")
		logger.Info("grype already on PATH, skipping install",
			zap.String("vmID", vm.ID),
			zap.String("path", path),
			zap.String("version", strings.TrimSpace(ver)))
		return nil
	}
	script := `
set -e
echo "Installing grype..."
curl -sSfL https://raw.githubusercontent.com/anchore/grype/main/install.sh | sh -s -- -b /usr/local/bin
echo "Checking grype version..."
grype version
`
	return runLocalInstallScript(ctx, "install grype", script)
}

func localInstallSyft(ctx context.Context, vm types.BuilderVM) error {
	if path, err := exec.LookPath("syft"); err == nil {
		ver, _ := localCommandCombinedOutput(ctx, "syft", "version")
		logger.Info("syft already on PATH, skipping install",
			zap.String("vmID", vm.ID),
			zap.String("path", path),
			zap.String("version", strings.TrimSpace(ver)))
		return nil
	}
	script := `
set -e
echo "Installing syft..."
curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b /usr/local/bin
echo "Checking syft version..."
syft version
`
	return runLocalInstallScript(ctx, "install syft", script)
}

func localInstallDocker(ctx context.Context, vm types.BuilderVM) error {
	if out, err := localCommandCombinedOutput(ctx, "docker", "--version"); err == nil {
		logger.Info("docker already installed, skipping installation",
			zap.String("vmID", vm.ID),
			zap.String("version", strings.TrimSpace(out)))
		return nil
	}
	if runtime.GOOS != "linux" {
		logger.Warn("docker not found on PATH; install Docker if you need image builds (optional for local backend)",
			zap.String("vmID", vm.ID))
		return nil
	}
	if runningInOCIContainer() {
		logger.Warn("docker CLI not found in container; use a host docker socket + docker-cli in the image, or skip image builds",
			zap.String("vmID", vm.ID))
		return nil
	}
	script := `
set -e
echo "Installing Docker..."
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
echo "Verifying Docker installation..."
docker --version
`
	return runLocalInstallScript(ctx, "install docker", script)
}

func localGenerateMelangeKeyIfNeeded(ctx context.Context, homeDir, vmID string) error {
	priv := filepath.Join(homeDir, "local-melange.rsa")
	if _, err := os.Stat(priv); err == nil {
		logger.Info("local melange signing key already present, skipping keygen",
			zap.String("vmID", vmID),
			zap.String("path", priv))
		return nil
	}
	cmd := exec.CommandContext(ctx, "melange", "keygen", "local-melange.rsa")
	cmd.Dir = homeDir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("melange keygen: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}
	logger.Info("generated local melange signing key", zap.String("vmID", vmID), zap.String("homeDir", homeDir))
	return nil
}

func localCopyBuilderBinary(homeDir, architecture, vmID string) error {
	if !IsBuilderEmbedded(architecture) {
		return fmt.Errorf("builder binary is not embedded for architecture %s", architecture)
	}
	data := GetEmbeddedBuilder(architecture)
	if len(data) == 0 {
		return fmt.Errorf("embedded builder binary is empty for architecture %s", architecture)
	}
	dest := filepath.Join(homeDir, "builder")
	if err := os.WriteFile(dest, data, 0755); err != nil {
		return fmt.Errorf("write builder: %w", err)
	}
	logger.Info("deployed local builder binary", zap.String("vmID", vmID), zap.String("path", dest), zap.Int("bytes", len(data)))
	return nil
}

func localCopyBuildEnvFiles(homeDir, vmID string) error {
	logger.Trace("copying build env files to local home", zap.String("vmID", vmID), zap.String("homeDir", homeDir))
	return fs.WalkDir(EmbeddedFS(), "filesystem", func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			return nil
		}
		rel := strings.TrimPrefix(path, "filesystem/")
		destPath := filepath.Join(homeDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return fmt.Errorf("mkdir %s: %w", filepath.Dir(destPath), err)
		}
		contents, err := EmbeddedFS().ReadFile(path)
		if err != nil {
			return fmt.Errorf("read embedded %s: %w", path, err)
		}
		if err := os.WriteFile(destPath, contents, 0644); err != nil {
			return fmt.Errorf("write %s: %w", destPath, err)
		}
		return nil
	})
}

func melangeReleaseArtifactForHost(builderArch string) (url, extractDir string, err error) {
	v := localInstallMelangeVersion
	switch runtime.GOOS {
	case "linux":
		if builderArch == "aarch64" {
			return fmt.Sprintf("https://github.com/chainguard-dev/melange/releases/download/v%s/melange_%s_linux_arm64.tar.gz", v, v),
				fmt.Sprintf("melange_%s_linux_arm64", v), nil
		}
		return fmt.Sprintf("https://github.com/chainguard-dev/melange/releases/download/v%s/melange_%s_linux_amd64.tar.gz", v, v),
			fmt.Sprintf("melange_%s_linux_amd64", v), nil
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return fmt.Sprintf("https://github.com/chainguard-dev/melange/releases/download/v%s/melange_%s_darwin_arm64.tar.gz", v, v),
				fmt.Sprintf("melange_%s_darwin_arm64", v), nil
		}
		return fmt.Sprintf("https://github.com/chainguard-dev/melange/releases/download/v%s/melange_%s_darwin_amd64.tar.gz", v, v),
			fmt.Sprintf("melange_%s_darwin_amd64", v), nil
	default:
		return "", "", fmt.Errorf("automatic melange install is not supported on %s/%s; install melange and ensure it is on PATH", runtime.GOOS, runtime.GOARCH)
	}
}

func apkoReleaseArtifactForHost(builderArch string) (url, extractDir string, err error) {
	v := localInstallApkoVersion
	switch runtime.GOOS {
	case "linux":
		if builderArch == "aarch64" {
			return fmt.Sprintf("https://github.com/chainguard-dev/apko/releases/download/v%s/apko_%s_linux_arm64.tar.gz", v, v),
				fmt.Sprintf("apko_%s_linux_arm64", v), nil
		}
		return fmt.Sprintf("https://github.com/chainguard-dev/apko/releases/download/v%s/apko_%s_linux_amd64.tar.gz", v, v),
			fmt.Sprintf("apko_%s_linux_amd64", v), nil
	case "darwin":
		if runtime.GOARCH == "arm64" {
			return fmt.Sprintf("https://github.com/chainguard-dev/apko/releases/download/v%s/apko_%s_darwin_arm64.tar.gz", v, v),
				fmt.Sprintf("apko_%s_darwin_arm64", v), nil
		}
		return fmt.Sprintf("https://github.com/chainguard-dev/apko/releases/download/v%s/apko_%s_darwin_amd64.tar.gz", v, v),
			fmt.Sprintf("apko_%s_darwin_amd64", v), nil
	default:
		return "", "", fmt.Errorf("automatic apko install is not supported on %s/%s; install apko and ensure it is on PATH", runtime.GOOS, runtime.GOARCH)
	}
}

func runLocalInstallScript(ctx context.Context, label, script string) error {
	cmd := exec.CommandContext(ctx, "bash", "-lc", script)
	out, err := cmd.CombinedOutput()
	logOut := strings.TrimSpace(string(out))
	if err != nil {
		if logOut != "" {
			logger.Debug(label+" failed", zap.String("output", logOut))
		}
		return fmt.Errorf("%s: %w", label, err)
	}
	if logOut != "" {
		logger.Debug(label+" output", zap.String("output", logOut))
	}
	return nil
}

func localCommandCombinedOutput(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	return string(out), err
}

// runningInOCIContainer reports whether we are likely inside Docker/containerd (no full docker engine install).
func runningInOCIContainer() bool {
	_, err := os.Stat("/.dockerenv")
	if err == nil {
		return true
	}
	// cgroup v2: kubernetes and other runtimes
	if b, err := os.ReadFile("/proc/self/cgroup"); err == nil {
		s := string(b)
		if strings.Contains(s, "docker") || strings.Contains(s, "containerd") || strings.Contains(s, "kubepods") {
			return true
		}
	}
	return false
}
