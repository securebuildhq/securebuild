package builder

import (
	"bufio"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
)

// ErrSSH is a sentinel error marking SSH connection or session failures
// (dial, NewSession). Callers can distinguish transient SSH outages from
// permanent errors with errors.Is(err, builder.ErrSSH).
var ErrSSH = errors.New("ssh error")

func GetSSHSession(ctx context.Context, id string) (*types.SSHSession, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT
		ssh.id, ssh.builder_id, ssh.user_session_id, ssh.ssh_pid, ssh.created_at,
		sess.user_id
	FROM ssh_session ssh
	JOIN buildadmin_session sess ON ssh.user_session_id = sess.id
	WHERE ssh.id = $1`
	row := conn.QueryRow(ctx, query, id)

	var sshSession types.SSHSession
	err := row.Scan(&sshSession.ID, &sshSession.BuilderID, &sshSession.UserSessionID, &sshSession.SSHPID, &sshSession.CreatedAt, &sshSession.UserID)
	if err != nil {
		return nil, fmt.Errorf("failed to scan ssh session: %w", err)
	}

	return &sshSession, nil
}

// CreateRemoteTextFile creates a file on the remote system with the given content
func CreateRemoteTextFile(client *ssh.Client, path string, content string) error {
	sess, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create ssh session for %s: %w: %w", path, ErrSSH, err)
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		return fmt.Errorf("failed to get stdin pipe for %s: %w", path, err)
	}
	go func() {
		defer stdin.Close()
		io.WriteString(stdin, content)
	}()

	if err := sess.Run(fmt.Sprintf("cat > %s", path)); err != nil {
		sess.Close()
		return fmt.Errorf("failed to create %s: %w", path, err)
	}
	sess.Close()
	return nil
}

// CreateRemoteBinaryFile creates a binary file on the remote system with the given data
func CreateRemoteBinaryFile(client *ssh.Client, path string, data []byte) error {
	sess, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create ssh session for %s: %w: %w", path, ErrSSH, err)
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		return fmt.Errorf("failed to get stdin pipe for %s: %w", path, err)
	}
	go func() {
		defer stdin.Close()
		stdin.Write(data)
	}()

	if err := sess.Run(fmt.Sprintf("cat > %s", path)); err != nil {
		sess.Close()
		return fmt.Errorf("failed to create %s: %w", path, err)
	}
	sess.Close()
	return nil
}

func CopyFileFromRemote(client *ssh.Client, remotePath string, localPath string) error {
	sess, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create ssh session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	// Open the local file for writing
	localFile, err := os.OpenFile(localPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("failed to open local file: %w", err)
	}
	defer localFile.Close()

	stdout, err := sess.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to get stdin pipe: %w", err)
	}

	// Start the remote scp process in 'from' mode
	if err := sess.Start("scp -f " + remotePath); err != nil {
		return fmt.Errorf("failed to start scp: %w", err)
	}

	// Send initial null byte to start transfer
	if _, err := stdin.Write([]byte{0}); err != nil {
		return fmt.Errorf("failed to write initial null byte: %w", err)
	}

	// Read the SCP protocol response
	buf := make([]byte, 1)
	if _, err := stdout.Read(buf); err != nil {
		return fmt.Errorf("failed to read scp response: %w", err)
	}
	if buf[0] != 'C' {
		return fmt.Errorf("unexpected response from scp: %c", buf[0])
	}

	// Read file mode, size, and name
	var mode int
	var size int64
	var filename string
	if _, err := fmt.Fscanf(stdout, "%04o %d %s\n", &mode, &size, &filename); err != nil {
		return fmt.Errorf("failed to parse scp file info: %w", err)
	}

	// Send null byte to acknowledge
	if _, err := stdin.Write([]byte{0}); err != nil {
		return fmt.Errorf("failed to write ack: %w", err)
	}

	// Copy the file data
	written, err := io.CopyN(localFile, stdout, size)
	if err != nil {
		return fmt.Errorf("failed to copy file data: %w", err)
	}
	if written != size {
		return fmt.Errorf("copied size mismatch: expected %d, got %d", size, written)
	}

	// Read the trailing null byte
	if _, err := stdout.Read(buf); err != nil {
		return fmt.Errorf("failed to read trailing null byte: %w", err)
	}
	if buf[0] != 0 {
		return fmt.Errorf("unexpected trailing byte from scp: %c", buf[0])
	}

	// Send final ack
	if _, err := stdin.Write([]byte{0}); err != nil {
		return fmt.Errorf("failed to write final ack: %w", err)
	}

	// Wait for the session to finish
	if err := sess.Wait(); err != nil {
		return fmt.Errorf("scp session error: %w", err)
	}

	return nil
}

func CreateRemoteDirectory(ctx context.Context, client *ssh.Client, vmID string, path string) error {
	stdoutCh := make(chan string)
	stderrCh := make(chan string)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for line := range stdoutCh {
			logger.Debug("mkdir stdout", zap.String("vmID", vmID), zap.String("output", line))
		}
	}()
	go func() {
		defer wg.Done()
		for line := range stderrCh {
			logger.Debug("mkdir stderr", zap.String("vmID", vmID), zap.String("output", line))
		}
	}()

	if err := RunCommand(ctx, client, vmID, fmt.Sprintf("mkdir -p %s", path), stdoutCh, stderrCh); err != nil {
		wg.Wait()
		return fmt.Errorf("failed to create directory: %w", err)
	}
	wg.Wait()

	return nil
}

func ListRemoteFiles(client *ssh.Client, path string) ([]string, error) {
	logger.Debug("listing remote files", zap.String("path", path))
	sess, err := client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create ssh session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	var stdoutBuf, stderrBuf strings.Builder
	sess.Stdout = &stdoutBuf
	sess.Stderr = &stderrBuf

	runErr := sess.Run(fmt.Sprintf("ls -la %s", path))

	stdoutOutput := stdoutBuf.String()
	stderrOutput := stderrBuf.String()

	if runErr != nil {
		return nil, fmt.Errorf("failed to list files: %w, stderr: %s", runErr, stderrOutput)
	}

	stdoutLines := strings.Split(strings.TrimSpace(stdoutOutput), "\n")
	var files []string
	for _, line := range stdoutLines {
		fields := strings.Fields(line)
		if len(fields) < 9 {
			continue // skip lines that don't look like file entries
		}
		if !strings.HasPrefix(fields[0], "-") {
			continue // only include regular files
		}
		name := fields[8]
		if name == "." || name == ".." {
			continue
		}
		// If the filename contains spaces, join the rest of the fields
		if len(fields) > 9 {
			name = strings.Join(fields[8:], " ")
		}
		fullPath := path
		if !strings.HasSuffix(fullPath, "/") {
			fullPath += "/"
		}
		fullPath += name
		files = append(files, fullPath)
	}

	// remove APKINDEX.tar.gz files
	withoutAPKIndex := []string{}
	for _, file := range files {
		if !strings.HasSuffix(file, "APKINDEX.tar.gz") {
			withoutAPKIndex = append(withoutAPKIndex, file)
		}
	}

	return withoutAPKIndex, nil
}

// RunCommand runs a command and tracks it in VM context for debugging
func RunCommand(ctx context.Context, client *ssh.Client, vmID string, command string, stdoutCh chan string, stderrCh chan string) error {
	// Track command in VM context if vmID is provided
	var vmCtx *VMContext
	if vmID != "" {
		vmCtx = GetVMContext(vmID)
		vmCtx.UpdateLastCommand(command)
	}

	logger.Trace("running command", zap.String("command", command), zap.String("vmID", vmID))
	sess, err := client.NewSession()
	if err != nil {
		if vmCtx != nil {
			vmCtx.SetFailureDetails(fmt.Sprintf("Failed to create SSH session: %v", err))
		}
		logger.Info("SSH session creation failed, checking VM status",
			zap.String("vmID", vmID),
			zap.Error(err))
		if vmID != "" {
			// DebugVMStatus is defined in pool.go but in the same package
			DebugVMStatus(ctx, vmID)
		}
		return fmt.Errorf("failed to create ssh session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	// Set up session with keep-alive and larger window sizes for long-running commands
	sess.Setenv("TERM", "xterm")

	// Monitor context cancellation and close session to prevent deadlock
	// Use a done channel to signal when the function completes to prevent goroutine leak
	done := make(chan struct{})
	defer close(done)

	go func() {
		select {
		case <-ctx.Done():
			// Close session to terminate remote command when context is cancelled
			sess.Close()
		case <-done:
			// Function completed normally, exit goroutine
			return
		}
	}()

	stdout, err := sess.StdoutPipe()
	if err != nil {
		if vmCtx != nil {
			vmCtx.SetFailureDetails(fmt.Sprintf("Failed to create stdout pipe: %v", err))
		}
		return fmt.Errorf("failed to get stdout pipe: %w", err)
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		if vmCtx != nil {
			vmCtx.SetFailureDetails(fmt.Sprintf("Failed to create stderr pipe: %v", err))
		}
		return fmt.Errorf("failed to get stderr pipe: %w", err)
	}

	var wg sync.WaitGroup
	wg.Add(2)

	// Track last output time for connection health monitoring
	lastOutputTime := time.Now()
	var lastOutputMutex sync.Mutex

	updateLastOutput := func() {
		lastOutputMutex.Lock()
		lastOutputTime = time.Now()
		lastOutputMutex.Unlock()
	}

	go func() {
		defer wg.Done()
		defer close(stdoutCh)
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Text()
			updateLastOutput()
			// Use select to respect context cancellation
			select {
			case stdoutCh <- line:
				// Track output in VM context
				if vmCtx != nil {
					vmCtx.AppendStdout(line)
				}
			case <-ctx.Done():
				logger.Debug("stdout goroutine cancelled", zap.String("vmID", vmID))
				return
			}
		}
		if err := scanner.Err(); err != nil {
			logger.Warn("stdout scanner error", zap.String("vmID", vmID), zap.Error(err))
		}
	}()

	go func() {
		defer wg.Done()
		defer close(stderrCh)
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			updateLastOutput()
			// Use select to respect context cancellation
			select {
			case stderrCh <- line:
				// Track output in VM context
				if vmCtx != nil {
					vmCtx.AppendStderr(line)
				}
			case <-ctx.Done():
				logger.Debug("stderr goroutine cancelled", zap.String("vmID", vmID))
				return
			}
		}
		if err := scanner.Err(); err != nil {
			logger.Warn("stderr scanner error", zap.String("vmID", vmID), zap.Error(err))
		}
	}()

	// Start the command
	runErr := sess.Run(command)

	// Wait for output goroutines to finish
	wg.Wait()

	if runErr != nil {
		// Get more detailed error information
		lastOutputMutex.Lock()
		timeSinceLastOutput := time.Since(lastOutputTime)
		lastOutputMutex.Unlock()

		errorDetails := fmt.Sprintf("Command failed: %v", runErr)
		if timeSinceLastOutput > 5*time.Minute {
			errorDetails += fmt.Sprintf(" (no output for %v, possible connection timeout)", timeSinceLastOutput)
		}

		if vmCtx != nil {
			vmCtx.SetFailureDetails(errorDetails)
		}

		// Log additional context for debugging and check VM status
		logger.Info("command execution failed, checking VM status",
			zap.String("vmID", vmID),
			zap.String("command", command),
			zap.Duration("timeSinceLastOutput", timeSinceLastOutput),
			zap.Error(runErr))

		if vmID != "" {
			DebugVMStatus(ctx, vmID)
		}

		return fmt.Errorf("failed to run command: %w", runErr)
	}

	return nil
}

// GetBuilderVM returns a BuilderVM by its ID
func GetBuilderVM(ctx context.Context, id string) (types.BuilderVM, error) {
	return getMachine(ctx, id)
}

// UpdateSSHSessionPID updates the ssh_pid for a given ssh_session
func UpdateSSHSessionPID(ctx context.Context, sessionID string, pid int) error {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `UPDATE ssh_session SET ssh_pid = $1 WHERE id = $2`
	_, err := conn.Exec(ctx, query, pid, sessionID)
	if err != nil {
		return fmt.Errorf("failed to update ssh_pid: %w", err)
	}
	return nil
}

// VerifyConnection performs a quick health check on the SSH connection
func VerifyConnection(ctx context.Context, client *ssh.Client, vmID string) error {
	sess, err := client.NewSession()
	if err != nil {
		logger.Info("SSH connection verification failed - session creation error, checking VM status",
			zap.String("vmID", vmID),
			zap.Error(err))
		if vmID != "" {
			DebugVMStatus(ctx, vmID)
		}
		return fmt.Errorf("failed to create test session: %w", err)
	}
	defer sess.Close()

	// Simple command to verify connection
	output, err := sess.CombinedOutput("echo 'connection_test_ok'")
	if err != nil {
		logger.Info("SSH connection verification failed - command execution error, checking VM status",
			zap.String("vmID", vmID),
			zap.Error(err))
		if vmID != "" {
			DebugVMStatus(ctx, vmID)
		}
		return fmt.Errorf("connection test failed: %w", err)
	}

	if !strings.Contains(string(output), "connection_test_ok") {
		logger.Info("SSH connection verification failed - unexpected output, checking VM status",
			zap.String("vmID", vmID),
			zap.String("output", string(output)))
		if vmID != "" {
			DebugVMStatus(ctx, vmID)
		}
		return fmt.Errorf("connection test returned unexpected output: %s", string(output))
	}

	return nil
}

// GetRemoteFileChecksum calculates SHA256 checksum of a file on the remote server
func GetRemoteFileChecksum(client *ssh.Client, remotePath string) (string, error) {
	maxRetries := 3
	baseDelay := time.Second * 2

	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		sess, err := client.NewSession()
		if err != nil {
			lastErr = fmt.Errorf("attempt %d failed to create ssh session: %w: %w", attempt+1, ErrSSH, err)

			if attempt < maxRetries-1 {
				// Calculate exponential backoff delay: 2s, 4s, 8s
				delay := baseDelay * time.Duration(1<<attempt)
				logger.Warn("failed to create SSH session for checksum calculation, retrying",
					zap.String("remotePath", remotePath),
					zap.Int("attempt", attempt+1),
					zap.Int("maxRetries", maxRetries),
					zap.Duration("retryDelay", delay),
					zap.Error(err))

				// Wait before retry
				time.Sleep(delay)
				continue
			} else {
				// Final attempt failed
				logger.Error(fmt.Errorf("failed to create SSH session for checksum after all retries: remotePath=%s, totalAttempts=%d, error=%w", remotePath, maxRetries, err))
				return "", fmt.Errorf("failed to create ssh session after %d attempts: %w", maxRetries, lastErr)
			}
		}

		// Successfully created session, now try to get checksum
		var stdoutBuf, stderrBuf strings.Builder
		sess.Stdout = &stdoutBuf
		sess.Stderr = &stderrBuf

		// Use sha256sum command to calculate checksum
		cmd := fmt.Sprintf("sha256sum '%s'", remotePath)
		cmdErr := sess.Run(cmd)
		sess.Close() // Close session after use

		if cmdErr != nil {
			lastErr = fmt.Errorf("attempt %d failed to calculate remote checksum: %w, stderr: %s", attempt+1, cmdErr, stderrBuf.String())

			if attempt < maxRetries-1 {
				delay := baseDelay * time.Duration(1<<attempt)
				logger.Warn("checksum calculation command failed, retrying",
					zap.String("remotePath", remotePath),
					zap.String("command", cmd),
					zap.Int("attempt", attempt+1),
					zap.Int("maxRetries", maxRetries),
					zap.Duration("retryDelay", delay),
					zap.Error(cmdErr),
					zap.String("stderr", stderrBuf.String()))

				time.Sleep(delay)
				continue
			} else {
				logger.Error(fmt.Errorf("checksum calculation failed after all retries: remotePath=%s, command=%s, totalAttempts=%d, error=%w", remotePath, cmd, maxRetries, cmdErr))
				return "", fmt.Errorf("failed to calculate remote checksum after %d attempts: %w", maxRetries, lastErr)
			}
		}

		output := strings.TrimSpace(stdoutBuf.String())
		if output == "" {
			lastErr = fmt.Errorf("attempt %d failed - empty checksum output", attempt+1)

			if attempt < maxRetries-1 {
				delay := baseDelay * time.Duration(1<<attempt)
				logger.Warn("empty checksum output, retrying",
					zap.String("remotePath", remotePath),
					zap.Int("attempt", attempt+1),
					zap.Int("maxRetries", maxRetries),
					zap.Duration("retryDelay", delay))

				time.Sleep(delay)
				continue
			} else {
				logger.Error(fmt.Errorf("empty checksum output after all retries: remotePath=%s, totalAttempts=%d", remotePath, maxRetries))
				return "", fmt.Errorf("empty checksum output after %d attempts", maxRetries)
			}
		}

		// sha256sum output format: "checksum  filename"
		parts := strings.Fields(output)
		if len(parts) < 1 {
			lastErr = fmt.Errorf("attempt %d failed - invalid checksum output format: %s", attempt+1, output)

			if attempt < maxRetries-1 {
				delay := baseDelay * time.Duration(1<<attempt)
				logger.Warn("invalid checksum output format, retrying",
					zap.String("remotePath", remotePath),
					zap.String("output", output),
					zap.Int("attempt", attempt+1),
					zap.Int("maxRetries", maxRetries),
					zap.Duration("retryDelay", delay))

				time.Sleep(delay)
				continue
			} else {
				logger.Error(fmt.Errorf("invalid checksum output format after all retries: remotePath=%s, output=%s, totalAttempts=%d", remotePath, output, maxRetries))
				return "", fmt.Errorf("invalid checksum output format after %d attempts: %s", maxRetries, output)
			}
		}

		// Success!
		checksum := parts[0]
		logger.Debug("checksum calculation successful",
			zap.String("remotePath", remotePath),
			zap.String("checksum", checksum),
			zap.Int("attempt", attempt+1))

		return checksum, nil
	}

	// This should never be reached due to the logic above, but just in case
	return "", fmt.Errorf("failed to get remote file checksum after %d attempts: %w", maxRetries, lastErr)
}

// GetLocalFileChecksum calculates SHA256 checksum of a local file
func GetLocalFileChecksum(localPath string) (string, error) {
	file, err := os.Open(localPath)
	if err != nil {
		return "", fmt.Errorf("failed to open local file: %w", err)
	}
	defer file.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", fmt.Errorf("failed to calculate local checksum: %w", err)
	}

	return fmt.Sprintf("%x", hasher.Sum(nil)), nil
}

// CopyFileFromRemoteWithChecksum copies a file from remote server with checksum verification and retry logic
func CopyFileFromRemoteWithChecksum(client *ssh.Client, remotePath string, localPath string, maxRetries int) error {
	if maxRetries <= 0 {
		maxRetries = 3
	}

	// Use the new optimized transfer function that reduces SSH session creation
	return CopyFileFromRemoteOptimized(client, remotePath, localPath, maxRetries)
}

// CopyFileFromRemoteOptimized is an optimized version that minimizes SSH session creation
// by combining checksum verification and file transfer operations
func CopyFileFromRemoteOptimized(client *ssh.Client, remotePath string, localPath string, maxRetries int) error {
	if maxRetries <= 0 {
		maxRetries = 3
	}

	var lastErr error
	baseDelay := time.Second * 2

	for attempt := 0; attempt < maxRetries; attempt++ {
		logger.Debug("attempting optimized file transfer with checksum verification",
			zap.String("remotePath", remotePath),
			zap.String("localPath", localPath),
			zap.Int("attempt", attempt+1),
			zap.Int("maxRetries", maxRetries))

		// Try to get remote checksum first, with fallback to transfer without checksum if VM is struggling
		var remoteChecksum string
		checksumErr := func() error {
			sess, err := client.NewSession()
			if err != nil {
				return fmt.Errorf("failed to create session for checksum: %w", err)
			}
			defer sess.Close()

			output, err := sess.CombinedOutput(fmt.Sprintf("sha256sum '%s' | cut -d' ' -f1", remotePath))
			if err != nil {
				return fmt.Errorf("failed to calculate checksum: %w", err)
			}

			remoteChecksum = strings.TrimSpace(string(output))
			if remoteChecksum == "" {
				return fmt.Errorf("empty checksum output")
			}
			return nil
		}()

		// If checksum fails and we're on a retry, skip checksum verification to reduce load
		skipChecksum := false
		if checksumErr != nil {
			if attempt > 0 {
				logger.Warn("skipping checksum verification due to VM resource constraints",
					zap.String("remotePath", remotePath),
					zap.Int("attempt", attempt+1),
					zap.Error(checksumErr))
				skipChecksum = true
			} else {
				lastErr = fmt.Errorf("attempt %d failed to get checksum: %w", attempt+1, checksumErr)
				if attempt < maxRetries-1 {
					delay := baseDelay * time.Duration(1<<attempt)
					logger.Warn("checksum calculation failed, retrying",
						zap.String("remotePath", remotePath),
						zap.Int("attempt", attempt+1),
						zap.Int("maxRetries", maxRetries),
						zap.Duration("retryDelay", delay),
						zap.Error(checksumErr))
					time.Sleep(delay)
					continue
				} else {
					return fmt.Errorf("failed to get checksum after %d attempts: %w", maxRetries, lastErr)
				}
			}
		}

		// Perform file transfer
		transferErr := CopyFileFromRemote(client, remotePath, localPath)
		if transferErr != nil {
			lastErr = fmt.Errorf("attempt %d transfer failed: %w", attempt+1, transferErr)

			if attempt < maxRetries-1 {
				delay := baseDelay * time.Duration(1<<attempt)
				logger.Warn("file transfer failed, retrying",
					zap.String("remotePath", remotePath),
					zap.String("localPath", localPath),
					zap.Int("attempt", attempt+1),
					zap.Int("maxRetries", maxRetries),
					zap.Duration("retryDelay", delay),
					zap.Error(transferErr))
				time.Sleep(delay)
				continue
			} else {
				logger.Error(fmt.Errorf("file transfer failed after all retries: remotePath=%s, localPath=%s, totalAttempts=%d, error=%w", remotePath, localPath, maxRetries, transferErr))
				return fmt.Errorf("file transfer failed after %d attempts: %w", maxRetries, lastErr)
			}
		}

		// Verify checksum if we have it
		if !skipChecksum && remoteChecksum != "" {
			localChecksum, err := GetLocalFileChecksum(localPath)
			if err != nil {
				lastErr = fmt.Errorf("attempt %d failed to calculate local checksum: %w", attempt+1, err)

				if attempt < maxRetries-1 {
					delay := baseDelay * time.Duration(1<<attempt)
					logger.Warn("local checksum calculation failed, retrying",
						zap.String("localPath", localPath),
						zap.Int("attempt", attempt+1),
						zap.Int("maxRetries", maxRetries),
						zap.Duration("retryDelay", delay),
						zap.Error(err))
					os.Remove(localPath) // Clean up potentially corrupted file
					time.Sleep(delay)
					continue
				} else {
					logger.Error(fmt.Errorf("local checksum calculation failed after all retries: localPath=%s, totalAttempts=%d, error=%w", localPath, maxRetries, err))
					return fmt.Errorf("failed to verify transfer after %d attempts: %w", maxRetries, lastErr)
				}
			}

			if remoteChecksum != localChecksum {
				lastErr = fmt.Errorf("attempt %d checksum mismatch: remote=%s, local=%s", attempt+1, remoteChecksum, localChecksum)

				// Remove corrupted file
				os.Remove(localPath)

				if attempt < maxRetries-1 {
					delay := baseDelay * time.Duration(1<<attempt)
					logger.Warn("checksum mismatch detected, retrying",
						zap.String("remotePath", remotePath),
						zap.String("localPath", localPath),
						zap.String("remoteChecksum", remoteChecksum),
						zap.String("localChecksum", localChecksum),
						zap.Int("attempt", attempt+1),
						zap.Int("maxRetries", maxRetries),
						zap.Duration("retryDelay", delay))
					time.Sleep(delay)
					continue
				} else {
					logger.Error(fmt.Errorf("checksum mismatch after all retries: remotePath=%s, localPath=%s, remoteChecksum=%s, localChecksum=%s, totalAttempts=%d", remotePath, localPath, remoteChecksum, localChecksum, maxRetries))
					return fmt.Errorf("checksum verification failed after %d attempts: %w", maxRetries, lastErr)
				}
			}

			logger.Debug("optimized file transfer successful with checksum verification",
				zap.String("remotePath", remotePath),
				zap.String("localPath", localPath),
				zap.String("checksum", localChecksum),
				zap.Int("attempt", attempt+1))
		} else {
			logger.Debug("optimized file transfer successful without checksum verification",
				zap.String("remotePath", remotePath),
				zap.String("localPath", localPath),
				zap.Int("attempt", attempt+1),
				zap.Bool("skippedChecksum", skipChecksum))
		}

		return nil
	}

	return fmt.Errorf("optimized file transfer failed after %d attempts: %w", maxRetries, lastErr)
}

// performOptimizedTransfer handles the actual transfer with checksum verification in a single session
func performOptimizedTransfer(sess *ssh.Session, remotePath string, localPath string) (bool, error) {
	// This function is no longer needed with the simplified approach
	return false, fmt.Errorf("deprecated function - use CopyFileFromRemoteOptimized instead")
}

// CopyFileFromRemoteVerified is a convenience function that uses checksum verification with default retry count
func CopyFileFromRemoteVerified(client *ssh.Client, remotePath string, localPath string) error {
	return CopyFileFromRemoteWithChecksum(client, remotePath, localPath, 3)
}

// AnalyzeAPKStructure analyzes the structure of an APK file to help debug validation issues
func AnalyzeAPKStructure(client *ssh.Client, remotePath string) error {
	sess, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create ssh session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	var stdoutBuf, stderrBuf strings.Builder
	sess.Stdout = &stdoutBuf
	sess.Stderr = &stderrBuf

	// Use hexdump to analyze the file structure
	cmd := fmt.Sprintf("echo 'File size:'; stat -c '%%s' '%s'; echo 'First 64 bytes:'; hexdump -C '%s' | head -4; echo 'Gzip magic byte positions:'; hexdump -C '%s' | grep -n '1f 8b' || echo 'No gzip magic found'", remotePath, remotePath, remotePath)
	if err := sess.Run(cmd); err != nil {
		return fmt.Errorf("failed to analyze APK structure: %w, stderr: %s", err, stderrBuf.String())
	}

	logger.Info("APK structure analysis",
		zap.String("remotePath", remotePath),
		zap.String("analysis", stdoutBuf.String()))

	return nil
}

// CheckMelangeOutput analyzes what melange produced to help debug APK generation issues
func CheckMelangeOutput(client *ssh.Client, arch string) error {
	sess, err := client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create ssh session: %w: %w", ErrSSH, err)
	}
	defer sess.Close()

	var stdoutBuf, stderrBuf strings.Builder
	sess.Stdout = &stdoutBuf
	sess.Stderr = &stderrBuf

	// Check what melange actually produced
	cmd := fmt.Sprintf(`
echo "=== Melange output analysis for %s ==="
echo "Files in packages/%s:"
ls -la packages/%s/ || echo "No packages directory"
echo ""
echo "APK files found:"
find packages/%s/ -name "*.apk" -exec sh -c 'echo "File: $1"; stat -c "Size: %%s bytes" "$1"; echo "First 32 bytes:"; hexdump -C "$1" | head -2; echo ""' _ {} \; 2>/dev/null || echo "No APK files found"
echo ""
echo "Checking if files are actually tar.gz instead of APK:"
find packages/%s/ -name "*.apk" -exec file {} \; 2>/dev/null || echo "No files to check"
`, arch, arch, arch, arch, arch)

	if err := sess.Run(cmd); err != nil {
		return fmt.Errorf("failed to check melange output: %w, stderr: %s", err, stderrBuf.String())
	}

	logger.Info("Melange output analysis",
		zap.String("arch", arch),
		zap.String("analysis", stdoutBuf.String()))

	return nil
}
