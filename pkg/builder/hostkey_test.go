package builder

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"strings"
	"testing"

	"github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"
)

func TestHostKeyFailure(t *testing.T) {
	pub, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	key, err := ssh.NewPublicKey(pub)
	require.NoError(t, err)
	otherPub, _, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	other, err := ssh.NewPublicKey(otherPub)
	require.NoError(t, err)
	encoded := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
	for _, tc := range []struct {
		name      string
		stored    sql.NullString
		enrolled  bool
		presented ssh.PublicKey
		reason    string
	}{
		{"first key", sql.NullString{}, false, key, ""},
		{"same key", sql.NullString{String: encoded, Valid: true}, true, key, ""},
		{"changed key", sql.NullString{String: encoded, Valid: true}, true, other, "key_changed"},
		{"missing pin", sql.NullString{}, true, key, "missing_pinned_key"},
		{"empty pin", sql.NullString{Valid: true}, true, key, "missing_pinned_key"},
		{"malformed pin", sql.NullString{String: "invalid", Valid: true}, true, key, "malformed_pinned_key"},
		{"multiple pins", sql.NullString{String: encoded + "\n" + encoded, Valid: true}, true, key, "malformed_pinned_key"},
		{"options", sql.NullString{String: "no-pty " + encoded, Valid: true}, true, key, "malformed_pinned_key"},
		{"missing timestamp", sql.NullString{String: encoded, Valid: true}, false, key, "inconsistent_enrollment"},
		{"missing presented key", sql.NullString{}, false, nil, "missing_presented_key"},
		{"certificate", sql.NullString{}, false, &ssh.Certificate{Key: key}, "unexpected_certificate"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.reason, hostKeyFailure(tc.stored, tc.enrolled, tc.presented))
		})
	}
}

func TestSSHHostKeyCallbackRejectsUnsupportedBackend(t *testing.T) {
	err := SSHHostKeyCallback(context.Background(), types.BuilderVM{ID: "local", Type: "local"})("unused", nil, nil)
	require.ErrorIs(t, err, ErrSSHHostKeyVerification)
	require.ErrorContains(t, err, "unsupported_backend")
}

func TestSSHHostKeyCallbackReturnsCallerCancellationBeforeVerification(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := SSHHostKeyCallback(ctx, types.BuilderVM{ID: "canceled-vm", Type: "cmx"})("unused", nil, nil)
	require.ErrorIs(t, err, context.Canceled)
	require.NotErrorIs(t, err, ErrSSHHostKeyVerification)
}
