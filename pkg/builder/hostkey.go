package builder

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/telemetry"
	"go.uber.org/zap"
	"golang.org/x/crypto/ssh"
)

// ErrSSHHostKeyVerification identifies permanent host-identity failures. Retrying
// must never clear a pin or enroll a replacement key for the same VM ID.
var ErrSSHHostKeyVerification = errors.New("SSH host key verification failed")

// SSHHostKeyError reports an identity failure without including key material.
type SSHHostKeyError struct {
	VMID   string
	Reason string
}

func (e *SSHHostKeyError) Error() string {
	return fmt.Sprintf("%s for VM %s: %s", ErrSSHHostKeyVerification, e.VMID, e.Reason)
}

func (e *SSHHostKeyError) Unwrap() error { return ErrSSHHostKeyVerification }

// SSHHostKeyCallback verifies CMX connections against a durable, VM-scoped TOFU
// pin. Static hosts retain their existing policy; local hosts never use SSH.
func SSHHostKeyCallback(ctx context.Context, vm types.BuilderVM) ssh.HostKeyCallback {
	if vm.Type == "static" {
		// Static-host policy is outside the CMX TOFU rollout.
		return ssh.InsecureIgnoreHostKey()
	}
	return func(addr string, _ net.Addr, key ssh.PublicKey) error {
		if vm.Type != "cmx" && vm.Type != "" {
			return &SSHHostKeyError{VMID: vm.ID, Reason: "unsupported_backend"}
		}
		verifyCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		enrolled, err := verifyCMXHostKey(verifyCtx, vm.ID, key)
		if err != nil {
			reason := "storage_error"
			var identityErr *SSHHostKeyError
			if errors.As(err, &identityErr) {
				reason = identityErr.Reason
			}
			telemetry.Increment(telemetry.MetricCMXSSHHostKeyFailed, []string{"reason:" + reason})
			logger.Error(err, zap.String("vmID", vm.ID), zap.String("addr", addr), zap.String("reason", reason))
			GetVMContext(vm.ID).SetFailureDetails(err.Error())
			return err
		}
		if enrolled {
			telemetry.Increment(telemetry.MetricCMXSSHHostKeyEnrolled, nil)
			logger.Info("enrolled CMX SSH host key", zap.String("vmID", vm.ID), zap.String("addr", addr))
		}
		return nil
	}
}

// verifyCMXHostKey locks only the identity row. Pool assignment can hold a lock
// on machine_pool while resolving HOME over SSH, so locking that row here would
// deadlock the assignment against its own handshake.
func verifyCMXHostKey(ctx context.Context, vmID string, key ssh.PublicKey) (bool, error) {
	conn, err := persistence.GetPooledPostgresSession(ctx)
	if err != nil {
		return false, fmt.Errorf("get SSH host key storage: %w", err)
	}
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin SSH host key verification: %w", err)
	}
	defer tx.Rollback(ctx)

	var stored sql.NullString
	var enrolledAt, failedAt sql.NullTime
	err = tx.QueryRow(ctx, `SELECT identity.host_key, identity.enrolled_at, identity.failed_at
		FROM machine_ssh_host_key identity JOIN machine_pool machine ON machine.id = identity.vm_id
		WHERE identity.vm_id = $1 AND machine.type = 'cmx'
		FOR UPDATE OF identity`, vmID).Scan(&stored, &enrolledAt, &failedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, &SSHHostKeyError{VMID: vmID, Reason: "missing_enrollment"}
	}
	if err != nil {
		return false, fmt.Errorf("read SSH host key enrollment: %w", err)
	}
	if failedAt.Valid {
		return false, &SSHHostKeyError{VMID: vmID, Reason: "quarantined"}
	}

	reason := hostKeyFailure(stored, enrolledAt.Valid, key)
	if reason != "" {
		if _, err := tx.Exec(ctx, `UPDATE machine_ssh_host_key SET failed_at = NOW(), failure_reason = $2 WHERE vm_id = $1`, vmID, reason); err != nil {
			return false, fmt.Errorf("quarantine SSH host key enrollment: %w", err)
		}
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit SSH host key quarantine: %w", err)
		}
		return false, &SSHHostKeyError{VMID: vmID, Reason: reason}
	}
	if enrolledAt.Valid {
		return false, nil
	}

	encoded := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
	if _, err := tx.Exec(ctx, `UPDATE machine_ssh_host_key SET host_key = $2, enrolled_at = NOW() WHERE vm_id = $1`, vmID, encoded); err != nil {
		return false, fmt.Errorf("enroll SSH host key: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit SSH host key enrollment: %w", err)
	}
	return true, nil
}

func hostKeyFailure(stored sql.NullString, enrolled bool, presented ssh.PublicKey) string {
	if presented == nil {
		return "missing_presented_key"
	}
	// CMX serves plain host keys. Certificate renewal needs its own trust policy.
	if _, isCertificate := presented.(*ssh.Certificate); isCertificate {
		return "unexpected_certificate"
	}
	if !enrolled {
		if stored.Valid {
			return "inconsistent_enrollment"
		}
		return ""
	}
	if !stored.Valid || stored.String == "" {
		return "missing_pinned_key"
	}
	expected, _, options, rest, err := ssh.ParseAuthorizedKey([]byte(stored.String))
	if err != nil || len(options) != 0 || len(bytes.TrimSpace(rest)) != 0 {
		return "malformed_pinned_key"
	}
	if !bytes.Equal(expected.Marshal(), presented.Marshal()) {
		return "key_changed"
	}
	return ""
}

// cmxHostKeyEligibleSQL includes provisioning VMs awaiting first enrollment,
// but excludes missing records and quarantined identities. Pins outlive pool
// rows, so stale callers cannot enroll a retired VM again.
const cmxHostKeyEligibleSQL = `(type <> 'cmx' OR EXISTS (
	SELECT 1 FROM machine_ssh_host_key identity
	WHERE identity.vm_id = machine_pool.id AND identity.failed_at IS NULL))`

// Already-running legacy builders remain selectable until their first verified
// handshake enrolls the pin. Newly provisioned builders must finish setup and
// enroll before becoming ready. Partial or lost enrollments never qualify.
const cmxHostKeyReadySQL = `(type <> 'cmx' OR EXISTS (
	SELECT 1 FROM machine_ssh_host_key identity
	WHERE identity.vm_id = machine_pool.id AND identity.failed_at IS NULL
	AND ((identity.host_key IS NOT NULL AND identity.enrolled_at IS NOT NULL)
	OR (machine_pool.ssh_host_key_enrollment_source = 'legacy'
	AND identity.host_key IS NULL AND identity.enrolled_at IS NULL))))`

func cmxHostKeyUnavailable(ctx context.Context, vmID string) (bool, error) {
	conn, err := persistence.GetPooledPostgresSession(ctx)
	if err != nil {
		return false, err
	}
	defer conn.Release()
	var unavailable bool
	err = conn.QueryRow(ctx, `SELECT NOT `+cmxHostKeyEligibleSQL+` FROM machine_pool WHERE id = $1`, vmID).Scan(&unavailable)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return unavailable, err
}
