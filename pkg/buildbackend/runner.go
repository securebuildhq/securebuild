package buildbackend

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/securebuildhq/securebuild/pkg/builder"
	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
)

// ErrSSH is a sentinel error used to mark failures from SSH connection or
// session operations (dial, NewSession). It is NOT returned for remote
// command execution failures (e.g., cat failing on a missing file) — those
// are file-level errors, not SSH errors.
//
// Callers can distinguish transient SSH outages from permanent scan failures
// with errors.Is(err, buildbackend.ErrSSH).
var ErrSSH = errors.New("ssh error")

// Runner abstracts command execution and file operations on a build machine.
// It can be backed by local process execution or SSH.
type Runner interface {
	// RunCommand runs a command synchronously and returns its combined output.
	RunCommand(ctx context.Context, command string) (string, error)

	// RunBackgroundCommand starts a command in the background (nohup-style).
	// executionID is used for logging if the outer process fails.
	// There is no onExit callback: the builder is invoked via a shell script that runs
	// "nohup bash -c '...' > log 2>&1 &", so the process we wait on is the outer shell,
	// which exits 0 after backgrounding the real build. The real build exit code is not
	// visible here; status is driven by the update-build-package-status poller reading
	// output/status and logs from the VM.
	RunBackgroundCommand(ctx context.Context, command string, executionID string) error

	// WriteFile writes text content to a file on the build machine.
	WriteFile(path string, content string) error

	// WriteBinaryFile writes binary data to a file on the build machine.
	WriteBinaryFile(path string, data []byte) error

	// ReadFile reads the full contents of a file.
	ReadFile(path string) (string, error)

	// ReadFileTail reads the last maxBytes of a file.
	ReadFileTail(path string, maxBytes int) (string, error)

	// FileExists checks if a file exists.
	FileExists(path string) (bool, error)

	// MkdirAll creates a directory and all parents.
	MkdirAll(path string) error

	// CopyToLocal copies a file from the build machine to the local filesystem.
	CopyToLocal(remotePath, localPath string) error

	// Close releases any underlying connections.
	Close() error

	// VMID returns the VM identifier for logging.
	VMID() string

	// RunSetup prepares the work dir for a build (melange signing key, build-<arch>.env, etc.).
	// LocalRunner: writes build-<arch>.env, copies local-melange keys from $HOME, then CopyEmbeddedFS(workDir).
	// SSHRunner: writes build-<arch>.env into work dir via runner (CopyEmbeddedFS only works locally).
	RunSetup(ctx context.Context, workDir string, builderBin string, arch string) error
}

// NewRunner creates the appropriate Runner for a BuilderVM based on its type.
func NewRunner(ctx context.Context, vm buildertypes.BuilderVM) (Runner, error) {
	switch vm.Type {
	case "local":
		return NewLocalRunner(vm.ID), nil
	case "static", "cmx":
		r, err := NewSSHRunner(ctx, vm)
		if err != nil {
			return nil, fmt.Errorf("create SSH runner for %s: %w", vm.Type, err)
		}
		return r, nil
	default:
		return nil, fmt.Errorf("unsupported VM type for runner: %s", vm.Type)
	}
}

// LocalRunner executes commands and file operations on the local host.
type LocalRunner struct {
	vmID string
}

func NewLocalRunner(vmID string) *LocalRunner {
	return &LocalRunner{vmID: vmID}
}

func (r *LocalRunner) VMID() string { return r.vmID }
func (r *LocalRunner) Close() error { return nil }

func (r *LocalRunner) RunCommand(ctx context.Context, command string) (string, error) {
	cmd := exec.CommandContext(ctx, "bash", "-c", command)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return string(output), fmt.Errorf("local command failed: %w (output: %s)", err, string(output))
	}
	return string(output), nil
}

func (r *LocalRunner) RunBackgroundCommand(ctx context.Context, command string, executionID string) error {
	cmd := exec.Command("bash", "-c", command)
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start background command: %w", err)
	}
	// Detach - don't wait for completion. We still wait in a goroutine to log if the
	// outer shell fails; because the command wraps the real build in nohup ... &, the
	// outer shell typically exits 0 and we do not see the real build result here.
	go func() {
		err := cmd.Wait()
		if err != nil {
			exitCode := 1
			if ee, ok := err.(*exec.ExitError); ok {
				exitCode = ee.ExitCode()
			}
			logger.Error(err,
				zap.String("executionID", executionID),
				zap.String("vmID", r.vmID),
				zap.Int("exitCode", exitCode),
			)
		} else {
			logger.Debug("background command completed",
				zap.String("executionID", executionID),
				zap.String("vmID", r.vmID),
			)
		}
	}()
	return nil
}

func (r *LocalRunner) WriteFile(path string, content string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write file %s: %w", path, err)
	}
	return nil
}

func (r *LocalRunner) WriteBinaryFile(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}
	if err := os.WriteFile(path, data, 0755); err != nil {
		return fmt.Errorf("failed to write binary file %s: %w", path, err)
	}
	return nil
}

func (r *LocalRunner) ReadFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read file %s: %w", path, err)
	}
	return string(data), nil
}

func (r *LocalRunner) ReadFileTail(path string, maxBytes int) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("failed to open file %s: %w", path, err)
	}
	defer f.Close()

	stat, err := f.Stat()
	if err != nil {
		return "", fmt.Errorf("failed to stat file %s: %w", path, err)
	}

	size := stat.Size()
	if size <= int64(maxBytes) {
		data, err := io.ReadAll(f)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}

	if _, err := f.Seek(-int64(maxBytes), io.SeekEnd); err != nil {
		return "", fmt.Errorf("failed to seek in file %s: %w", path, err)
	}
	data, err := io.ReadAll(f)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (r *LocalRunner) FileExists(path string) (bool, error) {
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

func (r *LocalRunner) MkdirAll(path string) error {
	return os.MkdirAll(path, 0755)
}

func (r *LocalRunner) RunSetup(ctx context.Context, workDir string, _ string, arch string) error {
	// Match SSHRunner: build-*.env from embedded FS + copy melange keys from $HOME
	// (keys and tools come from builder.InstallBuildEnv for type=local at worker startup).
	envFileName := fmt.Sprintf("build-%s.env", arch)
	content, err := fs.ReadFile(builder.EmbeddedFS(), "filesystem/"+envFileName)
	if err != nil {
		return fmt.Errorf("failed to read embedded %s: %w", envFileName, err)
	}
	if err := r.WriteFile(filepath.Join(workDir, envFileName), string(content)); err != nil {
		return err
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("user home dir: %w", err)
	}
	for _, name := range []string{"local-melange.rsa", "local-melange.rsa.pub"} {
		src := filepath.Join(homeDir, name)
		data, err := os.ReadFile(src)
		if err != nil {
			return fmt.Errorf("read melange key %s: %w (ensure worker ran local build env install)", src, err)
		}
		dst := filepath.Join(workDir, name)
		mode := os.FileMode(0600)
		if strings.HasSuffix(name, ".pub") {
			mode = 0644
		}
		if err := os.WriteFile(dst, data, mode); err != nil {
			return fmt.Errorf("write %s: %w", dst, err)
		}
	}
	return builder.CopyEmbeddedFS(workDir)
}

func (r *LocalRunner) CopyToLocal(remotePath, localPath string) error {
	// For local runner, remote == local; just copy the file
	if remotePath == localPath {
		return nil
	}
	dir := filepath.Dir(localPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := os.ReadFile(remotePath)
	if err != nil {
		return fmt.Errorf("failed to read source file %s: %w", remotePath, err)
	}
	return os.WriteFile(localPath, data, 0644)
}

// SSHRunner executes commands and file operations over SSH.
type SSHRunner struct {
	client *ssh.Client
	vmID   string
}

func NewSSHRunner(ctx context.Context, vm buildertypes.BuilderVM) (*SSHRunner, error) {
	client, err := dialSSH(ctx, vm)
	if err != nil {
		return nil, fmt.Errorf("SSH connection to %s (%s:%d): %w: %w", vm.ID, vm.IPAddress, vm.Port, ErrSSH, err)
	}
	return &SSHRunner{client: client, vmID: vm.ID}, nil
}

func (r *SSHRunner) VMID() string { return r.vmID }

func (r *SSHRunner) Close() error {
	if r.client != nil {
		return r.client.Close()
	}
	return nil
}

func (r *SSHRunner) RunCommand(ctx context.Context, command string) (string, error) {
	sess, err := r.client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	output, err := sess.CombinedOutput(command)
	if err != nil {
		return string(output), fmt.Errorf("SSH command failed: %w (output: %s)", err, string(output))
	}
	return string(output), nil
}

func (r *SSHRunner) RunBackgroundCommand(ctx context.Context, command string, executionID string) error {
	sess, err := r.client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	if err := sess.Start(command); err != nil {
		return fmt.Errorf("failed to start background command: %w", err)
	}
	// SSH session runs remotely; we don't wait for it. Status is driven by the poller.
	logger.Debug("background command started on remote",
		zap.String("executionID", executionID),
		zap.String("vmID", r.vmID),
	)
	return nil
}

func (r *SSHRunner) WriteFile(path string, content string) error {
	return builder.CreateRemoteTextFile(r.client, path, content)
}

func (r *SSHRunner) WriteBinaryFile(path string, data []byte) error {
	return builder.CreateRemoteBinaryFile(r.client, path, data)
}

func (r *SSHRunner) ReadFile(path string) (string, error) {
	sess, err := r.client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	output, err := sess.CombinedOutput(fmt.Sprintf("cat %q", path))
	if err != nil {
		return "", fmt.Errorf("failed to read remote file %s: %w", path, err)
	}
	return string(output), nil
}

func (r *SSHRunner) ReadFileTail(path string, maxBytes int) (string, error) {
	sess, err := r.client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	output, err := sess.CombinedOutput(fmt.Sprintf("tail -c %d %q", maxBytes, path))
	if err != nil {
		return "", fmt.Errorf("failed to read tail of remote file %s: %w", path, err)
	}
	return string(output), nil
}

func (r *SSHRunner) FileExists(path string) (bool, error) {
	sess, err := r.client.NewSession()
	if err != nil {
		return false, fmt.Errorf("failed to create SSH session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	err = sess.Run(fmt.Sprintf("test -f %q", path))
	if err != nil {
		return false, nil
	}
	return true, nil
}

func (r *SSHRunner) MkdirAll(path string) error {
	sess, err := r.client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	if err := sess.Run(fmt.Sprintf("mkdir -p %q", path)); err != nil {
		return fmt.Errorf("failed to create remote directory %s: %w", path, err)
	}
	return nil
}

func (r *SSHRunner) RunSetup(ctx context.Context, workDir string, _, arch string) error {
	envFileName := fmt.Sprintf("build-%s.env", arch)
	content, err := fs.ReadFile(builder.EmbeddedFS(), "filesystem/"+envFileName)
	if err != nil {
		return fmt.Errorf("failed to read embedded %s: %w", envFileName, err)
	}
	if err := r.WriteFile(filepath.Join(workDir, envFileName), string(content)); err != nil {
		return err
	}
	// Melange key was generated in $HOME during InstallBuildEnv; copy into work dir so builder finds it
	copyKeyCmd := fmt.Sprintf("cp \"$HOME/local-melange.rsa\" \"$HOME/local-melange.rsa.pub\" %q", workDir)
	if _, err := r.RunCommand(ctx, copyKeyCmd); err != nil {
		return fmt.Errorf("failed to copy melange signing key to work dir: %w", err)
	}
	return nil
}

func (r *SSHRunner) CopyToLocal(remotePath, localPath string) error {
	return builder.CopyFileFromRemote(r.client, remotePath, localPath)
}

// SSHClient returns the underlying SSH client for use with existing helpers
// that require a raw *ssh.Client (e.g. builder.RunCommand with channels).
func (r *SSHRunner) SSHClient() *ssh.Client {
	return r.client
}

// dialSSH establishes an SSH connection with retry logic.
// Handles both base64-encoded keys and "file:" prefix for key paths.
func dialSSH(ctx context.Context, vm buildertypes.BuilderVM) (*ssh.Client, error) {
	var privateKeyBytes []byte
	var err error

	if strings.HasPrefix(vm.PrivateKey, "file:") {
		keyPath := strings.TrimPrefix(vm.PrivateKey, "file:")
		privateKeyBytes, err = os.ReadFile(keyPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read SSH key file %s: %w", keyPath, err)
		}
	} else {
		privateKeyBytes, err = base64.StdEncoding.DecodeString(vm.PrivateKey)
		if err != nil {
			return nil, fmt.Errorf("failed to base64 decode private key (use ssh_key_path for key file path): %w", err)
		}
	}

	key, err := ssh.ParsePrivateKey(privateKeyBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse private key: %w", err)
	}

	config := &ssh.ClientConfig{
		User: vm.Username,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(key),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         30 * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", vm.IPAddress, vm.Port)

	var client *ssh.Client
	maxRetries := 3
	baseDelay := time.Second * 2

	for attempt := 0; attempt < maxRetries; attempt++ {
		client, err = ssh.Dial("tcp", addr, config)
		if err == nil {
			return client, nil
		}

		if attempt < maxRetries-1 {
			delay := baseDelay * time.Duration(1<<attempt)
			logger.Warn("SSH connection failed, retrying",
				zap.String("vmID", vm.ID),
				zap.String("addr", addr),
				zap.Int("attempt", attempt+1),
				zap.Int("maxRetries", maxRetries),
				zap.Duration("retryDelay", delay),
				zap.Error(err))

			builder.DebugVMStatus(ctx, vm.ID)

			select {
			case <-ctx.Done():
				return nil, fmt.Errorf("context cancelled during SSH retry: %w", ctx.Err())
			case <-time.After(delay):
			}
		}
	}

	builder.DebugVMStatus(ctx, vm.ID)
	return nil, fmt.Errorf("failed to dial SSH after %d attempts to %s: %w", maxRetries, addr, err)
}

// buildFindIncludeExpr builds a find -name expression for the given glob patterns,
// safe for embedding in a shell command (patterns are single-quoted).
func buildFindIncludeExpr(patterns []string) string {
	parts := make([]string, len(patterns))
	for i, p := range patterns {
		// Escape single quotes for shell: ' -> '\''
		quoted := "'" + strings.ReplaceAll(p, "'", "'\\''") + "'"
		parts[i] = "-name " + quoted
	}
	return strings.Join(parts, " -o ")
}

// RunnerCopyToLocalTar copies files from a remote directory to a local directory using tar.
// This is useful for bulk file transfers (e.g., SBOMs, scan results).
// If includePatterns is non-nil, only files matching those globs (find -name) are included; otherwise all files are copied.
func RunnerCopyToLocalTar(ctx context.Context, runner Runner, remoteDir, localDir string, includePatterns []string) error {
	if remoteDir == "" {
		return fmt.Errorf("remote directory is empty (machine_assignment.work_dir may be unset); cannot run tar on VM")
	}
	// Create local directory
	if err := os.MkdirAll(localDir, 0755); err != nil {
		return fmt.Errorf("failed to create local directory %s: %w", localDir, err)
	}

	// For local runner, just copy directly
	if _, ok := runner.(*LocalRunner); ok {
		var cmd string
		if len(includePatterns) == 0 {
			cmd = fmt.Sprintf("tar -cf - -C %q . | tar -xf - -C %q", remoteDir, localDir)
		} else {
			findExpr := buildFindIncludeExpr(includePatterns)
			// GNU tar: -C must appear before -T, or -C has no effect and paths from find (e.g. ./file) resolve against the wrong cwd.
			// pipefail: without it, a failing first tar can leave exit status 0 from the final extractor.
			cmd = fmt.Sprintf("set -o pipefail; (cd %q && find . -maxdepth 1 \\( %s \\) -print0) | tar -cf - -C %q --null -T - | tar -xf - -C %q", remoteDir, findExpr, remoteDir, localDir)
		}
		if _, err := runner.RunCommand(ctx, cmd); err != nil {
			return fmt.Errorf("failed to copy files locally: %w", err)
		}
		return nil
	}

	// For SSH runner, create tar on remote, copy, extract locally
	sshRunner, ok := runner.(*SSHRunner)
	if !ok {
		return fmt.Errorf("unsupported runner type for tar copy")
	}

	tmpFile, err := os.CreateTemp("", "runner-tar-*.tar.gz")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	// Create tar.gz on remote
	remoteTarPath := fmt.Sprintf("/tmp/runner-tar-%d.tar.gz", time.Now().UnixNano())
	var tarCmd string
	if len(includePatterns) == 0 {
		tarCmd = fmt.Sprintf("tar -czf %s -C %q .", remoteTarPath, remoteDir)
	} else {
		findExpr := buildFindIncludeExpr(includePatterns)
		tarCmd = fmt.Sprintf("cd %q && find . -maxdepth 1 \\( %s \\) -print0 | tar -czf %s --null -T -", remoteDir, findExpr, remoteTarPath)
	}
	if _, err := runner.RunCommand(ctx, tarCmd); err != nil {
		return fmt.Errorf("failed to create remote tar: %w", err)
	}
	defer func() {
		_, _ = runner.RunCommand(ctx, fmt.Sprintf("rm -f %s", remoteTarPath))
	}()

	// Copy tar to local
	if err := builder.CopyFileFromRemote(sshRunner.client, remoteTarPath, tmpPath); err != nil {
		return fmt.Errorf("failed to copy tar from remote: %w", err)
	}

	// Extract locally
	extractCmd := exec.CommandContext(ctx, "tar", "-xzf", tmpPath, "-C", localDir)
	var stderr bytes.Buffer
	extractCmd.Stderr = &stderr
	if err := extractCmd.Run(); err != nil {
		return fmt.Errorf("failed to extract tar: %w (stderr: %s)", err, stderr.String())
	}

	return nil
}
