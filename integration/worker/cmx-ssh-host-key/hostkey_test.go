package cmx_host_key_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	sshd "github.com/gliderlabs/ssh"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/buildbackend"
	"github.com/securebuildhq/securebuild/pkg/builder"
	buildertypes "github.com/securebuildhq/securebuild/pkg/builder/types"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/scan"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"
)

func newSigner(t *testing.T) ssh.Signer {
	t.Helper()
	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	signer, err := ssh.NewSignerFromKey(privateKey)
	require.NoError(t, err)
	return signer
}

func TestCMXSSHHostKeyTOFU(t *testing.T) {
	if testing.Short() {
		t.Skip("requires PostgreSQL in Docker and SchemaHero")
	}
	ctx := context.Background()
	db := testutil.SetupTestDatabase(ctx, t)
	t.Cleanup(func() { testutil.TeardownTestDatabase(context.Background(), t, db) })

	var sequence atomic.Int32
	var deleted sync.Map
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "test-token" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v3/vm":
			_, _ = fmt.Fprintf(w, `{"vms":[{"id":"vm-tofu-%d","status":"queued"}]}`, sequence.Add(1))
		case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/v3/vm/"):
			deleted.Store(strings.TrimPrefix(r.URL.Path, "/v3/vm/"), true)
			_, _ = io.WriteString(w, `{}`)
		case r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, "/ttl"):
			_, _ = io.WriteString(w, `{"vm":{"expires_at":"2030-01-01T00:00:00Z"}}`)
		case r.Method == http.MethodGet:
			_, _ = io.WriteString(w, `{"vm":{"status":"running"}}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(api.Close)
	ctx = context.WithValue(ctx, param.ParamContextKey, &param.Param{
		DBURI: db.ConnStr, BuildBackend: "cmx", ReplicatedAPIOrigin: api.URL, ReplicatedAPIToken: "test-token",
	})
	require.NoError(t, persistence.InitPostgres(ctx))
	t.Cleanup(func() { persistence.ClosePool(ctx) })

	keyA, keyB := newSigner(t), newSigner(t)
	var authentications, commands, connections atomic.Int32
	var artifacts sync.Map
	server := &sshd.Server{
		HostSigners: []sshd.Signer{keyA},
		ConnCallback: func(_ sshd.Context, conn net.Conn) net.Conn {
			connections.Add(1)
			return conn
		},
		PublicKeyHandler: func(_ sshd.Context, _ sshd.PublicKey) bool {
			authentications.Add(1)
			return true
		},
		Handler: func(session sshd.Session) {
			commands.Add(1)
			command := strings.Join(session.Command(), " ")
			if strings.HasPrefix(command, "cat > ") {
				content, _ := io.ReadAll(session)
				artifacts.Store(command, string(content))
			} else if command == "echo $HOME" {
				_, _ = io.WriteString(session, "/home/builder\n")
			} else {
				_, _ = io.WriteString(session, "test output\n")
			}
			_ = session.Exit(0)
		},
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	serverDone := make(chan struct{})
	go func() { defer close(serverDone); _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close(); <-serverDone })
	port := listener.Addr().(*net.TCPAddr).Port

	provision := func(t *testing.T) buildertypes.BuilderVM {
		t.Helper()
		vm, err := builder.ProvisionVMForBuild(ctx, "test-worker", "x86_64", 0, false)
		require.NoError(t, err)
		_, err = db.Pool.Exec(ctx, `UPDATE machine_pool SET ip_address='127.0.0.1', port=$2, status='installing' WHERE id=$1`, vm.ID, port)
		require.NoError(t, err)
		vm, err = builder.GetBuilderVM(ctx, vm.ID)
		require.NoError(t, err)
		return vm
	}
	connect := func(t *testing.T, vm buildertypes.BuilderVM) {
		t.Helper()
		client, err := builder.GetSSHClient(ctx, vm)
		require.NoError(t, err)
		require.NoError(t, client.Close())
	}
	assertRejected := func(t *testing.T, vm buildertypes.BuilderVM, reason string) {
		t.Helper()
		beforeAuth, beforeCommands, beforeConnections := authentications.Load(), commands.Load(), connections.Load()
		runner, err := buildbackend.NewRunner(ctx, vm)
		require.Nil(t, runner)
		require.ErrorIs(t, err, builder.ErrSSHHostKeyVerification)
		require.ErrorContains(t, err, reason)
		require.Equal(t, beforeAuth, authentications.Load(), "rejection must precede client authentication")
		require.Equal(t, beforeCommands, commands.Load(), "rejection must precede remote commands and transfers")
		require.Equal(t, beforeConnections+1, connections.Load(), "identity failures must not be retried")
	}

	t.Run("first connection pins the key and reconnects survive storage restart", func(t *testing.T) {
		vm := provision(t)
		connect(t, vm)
		var pinned string
		var enrolled time.Time
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT host_key,enrolled_at FROM machine_ssh_host_key WHERE vm_id=$1`, vm.ID).Scan(&pinned, &enrolled))
		require.Equal(t, strings.TrimSpace(string(ssh.MarshalAuthorizedKey(keyA.PublicKey()))), pinned)
		persistence.ClosePool(ctx)
		require.NoError(t, persistence.InitPostgres(ctx))
		runner, err := buildbackend.NewRunner(ctx, vm)
		require.NoError(t, err)
		output, err := runner.RunCommand(ctx, "test command")
		require.NoError(t, err)
		require.Equal(t, "test output\n", output)
		require.NoError(t, runner.WriteFile("/tmp/artifact", "verified artifact"))
		require.NoError(t, runner.Close())
		content, ok := artifacts.Load("cat > /tmp/artifact")
		require.True(t, ok)
		require.Equal(t, "verified artifact", content)
		var after time.Time
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT enrolled_at FROM machine_ssh_host_key WHERE vm_id=$1`, vm.ID).Scan(&after))
		require.Equal(t, enrolled, after, "reconnections must not rewrite enrollment")
	})

	t.Run("changed key quarantines the VM and endpoint reuse enrolls a new ID", func(t *testing.T) {
		vm := provision(t)
		connect(t, vm)
		_, err := db.Pool.Exec(ctx, `UPDATE machine_pool SET status='running' WHERE id=$1`, vm.ID)
		require.NoError(t, err)
		server.AddHostKey(keyB)
		assertRejected(t, vm, "key_changed")
		var reason string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT failure_reason FROM machine_ssh_host_key WHERE vm_id=$1 AND failed_at IS NOT NULL`, vm.ID).Scan(&reason))
		require.Equal(t, "key_changed", reason)
		fleet, err := scan.GetRunningBuildersForScan(ctx)
		require.NoError(t, err)
		for _, candidate := range fleet {
			require.NotEqual(t, vm.ID, candidate.ID)
		}
		// Even the original key cannot undo quarantine.
		server.AddHostKey(keyA)
		// A pre-existing pin from a deployment before the source-marker column
		// must also survive startup migration, including its quarantine state.
		_, err = db.Pool.Exec(ctx, `UPDATE machine_pool SET ssh_host_key_enrollment_source=NULL WHERE id=$1`, vm.ID)
		require.NoError(t, err)
		require.NoError(t, builder.MigrateMachinePool(ctx))
		assertRejected(t, vm, "quarantined")
		require.NoError(t, builder.DeleteVMWithReason(ctx, vm.ID, builder.TerminationReasonSSHHostKey))
		_, wasDeleted := deleted.Load(vm.ID)
		require.True(t, wasDeleted, "retirement must use the authenticated CMX API")
		var retiredPin string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT host_key FROM machine_ssh_host_key WHERE vm_id=$1`, vm.ID).Scan(&retiredPin))
		require.Equal(t, strings.TrimSpace(string(ssh.MarshalAuthorizedKey(keyA.PublicKey()))), retiredPin)
		assertRejected(t, vm, "missing_enrollment")
		server.AddHostKey(keyB)
		replacement := provision(t)
		require.NotEqual(t, vm.ID, replacement.ID)
		connect(t, replacement)
		var pinned string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT host_key FROM machine_ssh_host_key WHERE vm_id=$1`, replacement.ID).Scan(&pinned))
		require.Equal(t, strings.TrimSpace(string(ssh.MarshalAuthorizedKey(keyB.PublicKey()))), pinned)
		server.AddHostKey(keyA)
	})

	for _, tc := range []struct{ name, mutation, reason string }{
		{"missing enrolled key", `UPDATE machine_ssh_host_key SET host_key=NULL WHERE vm_id=$1`, "missing_pinned_key"},
		{"malformed enrolled key", `UPDATE machine_ssh_host_key SET host_key='invalid' WHERE vm_id=$1`, "malformed_pinned_key"},
		{"lost enrollment record", `DELETE FROM machine_ssh_host_key WHERE vm_id=$1`, "missing_enrollment"},
		{"retired VM", `DELETE FROM machine_pool WHERE id=$1`, "missing_enrollment"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			vm := provision(t)
			connect(t, vm)
			_, err := db.Pool.Exec(ctx, tc.mutation, vm.ID)
			require.NoError(t, err)
			require.NoError(t, builder.MigrateMachinePool(ctx))
			assertRejected(t, vm, tc.reason)
		})
	}

	t.Run("unknown VM cannot enroll", func(t *testing.T) {
		vm := provision(t)
		vm.ID = "unknown-vm"
		assertRejected(t, vm, "missing_enrollment")
		var count int
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM machine_ssh_host_key WHERE vm_id=$1`, vm.ID).Scan(&count))
		require.Zero(t, count)
	})

	t.Run("concurrent first connections agree on a single pin", func(t *testing.T) {
		vm := provision(t)
		results := make(chan error, 8)
		for range 8 {
			go func() {
				client, err := builder.GetSSHClient(ctx, vm)
				if err == nil {
					err = client.Close()
				}
				results <- err
			}()
		}
		for range 8 {
			require.NoError(t, <-results)
		}
	})

	t.Run("competing first keys never overwrite the winner", func(t *testing.T) {
		vm := provision(t)
		start := make(chan struct{})
		type result struct {
			key ssh.PublicKey
			err error
		}
		results := make(chan result, 2)
		for _, key := range []ssh.PublicKey{keyA.PublicKey(), keyB.PublicKey()} {
			go func() {
				<-start
				results <- result{key, builder.SSHHostKeyCallback(ctx, vm)("same endpoint", nil, key)}
			}()
		}
		close(start)
		first, second := <-results, <-results
		if first.err != nil {
			first, second = second, first
		}
		require.NoError(t, first.err)
		require.ErrorIs(t, second.err, builder.ErrSSHHostKeyVerification)
		var pinned string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT host_key FROM machine_ssh_host_key WHERE vm_id=$1`, vm.ID).Scan(&pinned))
		require.Equal(t, strings.TrimSpace(string(ssh.MarshalAuthorizedKey(first.key))), pinned)
	})

	t.Run("pool assignment can verify while holding the builder row lock", func(t *testing.T) {
		vm := provision(t)
		connect(t, vm)
		_, err := db.Pool.Exec(ctx, `UPDATE machine_pool SET status='running' WHERE id=$1`, vm.ID)
		require.NoError(t, err)
		assignCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		assigned, err := builder.TakeVMWithAssignment(assignCtx, "x86_64", "build_package", "test-task")
		require.NoError(t, err)
		require.Equal(t, vm.ID, assigned.ID)
	})

	t.Run("startup enrolls existing builders without replacing them or losing assignments", func(t *testing.T) {
		vm := provision(t)
		// Simulate an existing builder from before the enrollment schema rollout.
		_, err := db.Pool.Exec(ctx, `UPDATE machine_pool SET status='running', ssh_host_key_enrollment_source=NULL WHERE id=$1`, vm.ID)
		require.NoError(t, err)
		_, err = db.Pool.Exec(ctx, `DELETE FROM machine_ssh_host_key WHERE vm_id=$1`, vm.ID)
		require.NoError(t, err)
		require.NoError(t, builder.AssignVMToTask(ctx, vm.ID, "build_package", "existing-task", "/home/builder/existing-work"))
		beforeConnections := connections.Load()
		results := make(chan error, 4)
		for range 4 {
			go func() { results <- builder.MigrateMachinePool(ctx) }()
		}
		for range 4 {
			require.NoError(t, <-results)
		}
		require.Equal(t, beforeConnections, connections.Load(), "migration must preserve builders without connecting over SSH")
		_, wasDeleted := deleted.Load(vm.ID)
		require.False(t, wasDeleted)
		var status, source string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT status,ssh_host_key_enrollment_source FROM machine_pool WHERE id=$1`, vm.ID).Scan(&status, &source))
		require.Equal(t, "running", status)
		require.Equal(t, "legacy", source)
		assignment, err := builder.GetMachineAssignment(ctx, vm.ID)
		require.NoError(t, err)
		require.Equal(t, "existing-task", assignment.AssignedTaskID)
		require.Equal(t, "/home/builder/existing-work", assignment.WorkDir)
		fleet, err := scan.GetRunningBuildersForScan(ctx)
		require.NoError(t, err)
		available := false
		for _, candidate := range fleet {
			available = available || candidate.ID == vm.ID
		}
		require.True(t, available, "legacy builders must remain selectable before first enrollment")
		_, err = db.Pool.Exec(ctx, `DELETE FROM machine_assignment WHERE machine_id=$1`, vm.ID)
		require.NoError(t, err)
		assignCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		assigned, err := builder.TakeVMWithAssignment(assignCtx, "x86_64", "build_package", "post-rollout-task")
		require.NoError(t, err)
		require.Equal(t, vm.ID, assigned.ID)
		var pinned string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT host_key FROM machine_ssh_host_key WHERE vm_id=$1`, vm.ID).Scan(&pinned))
		require.Equal(t, strings.TrimSpace(string(ssh.MarshalAuthorizedKey(keyA.PublicKey()))), pinned)
		server.AddHostKey(keyB)
		defer server.AddHostKey(keyA)
		assertRejected(t, vm, "key_changed")
		require.NoError(t, builder.MigrateMachinePool(ctx))
		assertRejected(t, vm, "quarantined")
		_, err = db.Pool.Exec(ctx, `DELETE FROM machine_ssh_host_key WHERE vm_id=$1`, vm.ID)
		require.NoError(t, err)
		require.NoError(t, builder.MigrateMachinePool(ctx))
		assertRejected(t, vm, "missing_enrollment")
	})

	t.Run("database failure cannot bypass verification", func(t *testing.T) {
		vm := provision(t)
		beforeAuth := authentications.Load()
		cancelled, cancel := context.WithCancel(ctx)
		cancel()
		client, err := builder.GetSSHClient(cancelled, vm)
		require.Nil(t, client)
		require.ErrorIs(t, err, context.Canceled)
		require.Equal(t, beforeAuth, authentications.Load())
	})
}
