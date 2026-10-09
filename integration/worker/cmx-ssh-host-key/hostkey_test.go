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
	"os/exec"
	"path/filepath"
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
	var poolVMResponses sync.Map
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
		case r.Method == http.MethodGet && r.URL.Path == "/v3/vms":
			_, _ = io.WriteString(w, `{"vms":[`)
			for id := int32(1); id <= sequence.Load(); id++ {
				if id > 1 {
					_, _ = io.WriteString(w, ",")
				}
				_, _ = fmt.Fprintf(w, `{"id":"vm-tofu-%d"}`, id)
			}
			_, _ = io.WriteString(w, `]}`)
		case r.Method == http.MethodGet:
			if response, ok := poolVMResponses.Load(strings.TrimPrefix(r.URL.Path, "/v3/vm/")); ok {
				_, _ = io.WriteString(w, response.(string))
			} else {
				_, _ = io.WriteString(w, `{"vm":{"status":"running"}}`)
			}
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
	var toolVersions sync.Map
	var finalBuildFileCallbacks sync.Map
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
				if command == "cat > /home/builder/builder" {
					_, _ = io.Copy(io.Discard, session)
					_ = session.Exit(0)
					return
				}
				content, _ := io.ReadAll(session)
				artifacts.Store(command, string(content))
				if command == "cat > /home/builder/build-x86_64.env" {
					if callback, ok := finalBuildFileCallbacks.Load(session.User()); ok {
						if err := callback.(func() error)(); err != nil {
							_, _ = fmt.Fprintln(session.Stderr(), err)
							_ = session.Exit(1)
							return
						}
					}
				}
			} else if command == "echo $HOME" {
				_, _ = io.WriteString(session, "/home/builder\n")
			} else if strings.HasPrefix(command, "if command -v ") {
				tool := strings.Fields(command)[3]
				if version, ok := toolVersions.Load(tool); ok {
					_, _ = fmt.Fprintf(session, "Version: %s\n", version)
				}
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

	t.Run("pool archives setup identity failures separately from ordinary setup failures", func(t *testing.T) {
		identityVM := provision(t)
		connect(t, identityVM)
		ordinaryVM := provision(t)
		machineID, err := builder.GetMachineID()
		require.NoError(t, err)
		for i, vm := range []buildertypes.BuilderVM{identityVM, ordinaryVM} {
			architecture := []string{"x86_64", "aarch64"}[i]
			_, err := db.Pool.Exec(ctx, `UPDATE machine_pool SET machine_id=$2, status='queued', architecture=$3 WHERE id=$1`, vm.ID, machineID, architecture)
			require.NoError(t, err)
			poolVMResponses.Store(vm.ID, fmt.Sprintf(`{"vm":{"id":%q,"status":"running","direct_ssh_endpoint":"127.0.0.1","direct_ssh_port":%d,"expires_at":"2030-01-01T00:00:00Z"}}`, vm.ID, port))
			builder.GetVMContext(vm.ID)
		}
		_, err = db.Pool.Exec(ctx, `UPDATE machine_pool SET private_key='invalid' WHERE id=$1`, ordinaryVM.ID)
		require.NoError(t, err)
		server.AddHostKey(keyB)
		defer server.AddHostKey(keyA)
		beforeAuth, beforeCommands := authentications.Load(), commands.Load()
		poolParams := *param.GetParam(ctx)
		poolParams.PoolSize = 1
		poolCtx, cancel := context.WithCancel(context.WithValue(ctx, param.ParamContextKey, &poolParams))
		defer cancel()
		require.NoError(t, builder.CreatePool(poolCtx))

		// Wait for both history records and final pool deletion before stopping
		// maintenance; setup runs asynchronously after the first five-second tick.
		require.Eventually(t, func() bool {
			var retired int
			err := db.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM machine_pool_history history
				WHERE id IN ($1,$2) AND NOT EXISTS (SELECT 1 FROM machine_pool WHERE machine_pool.id=history.id)`, identityVM.ID, ordinaryVM.ID).Scan(&retired)
			return err == nil && retired == 2
		}, 10*time.Second, 20*time.Millisecond)
		cancel()
		var details string
		require.NoError(t, db.Pool.QueryRow(ctx, `SELECT failure_details FROM machine_pool_history WHERE id=$1`, identityVM.ID).Scan(&details))
		require.Contains(t, details, "key_changed")
		for _, tc := range []struct{ vmID, reason string }{
			{identityVM.ID, builder.TerminationReasonSSHHostKey},
			{ordinaryVM.ID, builder.TerminationReasonBuildEnvFailed},
		} {
			var reason string
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT termination_reason FROM machine_pool_history WHERE id=$1`, tc.vmID).Scan(&reason))
			require.Equal(t, tc.reason, reason)
			_, wasDeleted := deleted.Load(tc.vmID)
			require.True(t, wasDeleted, "setup failure must retire through the authenticated CMX API")
		}
		require.Equal(t, beforeAuth, authentications.Load(), "failed setup must not reach client authentication")
		require.Equal(t, beforeCommands, commands.Load(), "failed setup must not send commands")
	})

	t.Run("completed setup distinguishes retirement from unavailable identity", func(t *testing.T) {
		// A normal executable retains the Go module metadata used to select
		// Anchore tool versions. The SSH server models those tools as installed.
		driver := filepath.Join(t.TempDir(), "setup-driver")
		buildCtx, cancelBuild := context.WithTimeout(ctx, 2*time.Minute)
		defer cancelBuild()
		output, err := exec.CommandContext(buildCtx, "go", "build", "-o", driver, "./testdata/setup-driver").CombinedOutput()
		require.NoError(t, err, "%s", output)
		output, err = exec.CommandContext(buildCtx, driver, "versions").CombinedOutput()
		require.NoError(t, err, "%s", output)
		for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
			tool, version, ok := strings.Cut(line, ":")
			require.True(t, ok)
			toolVersions.Store(tool, version)
		}
		for _, tc := range []struct{ name, mutation, result string }{
			{"valid identity becomes ready", "", "ready"},
			{"concurrent retirement", "retire", "missing_machine"},
			{"lost identity", `DELETE FROM machine_ssh_host_key WHERE vm_id=$1`, "ssh_identity_failure"},
			{"quarantined identity", `UPDATE machine_ssh_host_key SET failed_at=NOW(), failure_reason='key_changed' WHERE vm_id=$1`, "ssh_identity_failure"},
		} {
			t.Run(tc.name, func(t *testing.T) {
				vm := provision(t)
				t.Cleanup(func() {
					require.NoError(t, builder.DeleteVMWithReason(ctx, vm.ID, builder.TerminationReasonManualDeletion))
				})
				_, err := db.Pool.Exec(ctx, `UPDATE machine_pool SET username=$1 WHERE id=$1`, vm.ID)
				require.NoError(t, err)
				mutationResult := make(chan error, 1)
				finalBuildFileCallbacks.Store(vm.ID, func() error {
					var err error
					if tc.mutation == "retire" {
						err = builder.DeleteVMWithReason(ctx, vm.ID, builder.TerminationReasonExcess)
					} else if tc.mutation != "" {
						_, err = db.Pool.Exec(ctx, tc.mutation, vm.ID)
					}
					mutationResult <- err
					return err
				})
				defer finalBuildFileCallbacks.Delete(vm.ID)
				setupCtx, cancelSetup := context.WithTimeout(ctx, time.Minute)
				output, err := exec.CommandContext(setupCtx, driver, db.ConnStr, vm.ID).CombinedOutput()
				cancelSetup()
				require.NoError(t, err, "%s", output)
				select {
				case err := <-mutationResult:
					require.NoError(t, err)
				default:
					t.Fatalf("setup never reached its final transfer: %s", output)
				}
				require.Contains(t, string(output), "setup-result:"+tc.result, "%s", output)
				if tc.mutation == "retire" {
					var reason string
					var pin string
					require.NoError(t, db.Pool.QueryRow(ctx, `SELECT termination_reason FROM machine_pool_history WHERE id=$1`, vm.ID).Scan(&reason))
					require.Equal(t, builder.TerminationReasonExcess, reason)
					require.NoError(t, db.Pool.QueryRow(ctx, `SELECT host_key FROM machine_ssh_host_key WHERE vm_id=$1`, vm.ID).Scan(&pin))
					require.Equal(t, strings.TrimSpace(string(ssh.MarshalAuthorizedKey(keyA.PublicKey()))), pin)
				} else {
					var status string
					require.NoError(t, db.Pool.QueryRow(ctx, `SELECT status FROM machine_pool WHERE id=$1`, vm.ID).Scan(&status))
					if tc.result == "ready" {
						require.Equal(t, "running", status)
					} else {
						require.Equal(t, "installing", status, "unavailable identities must never become ready")
					}
				}
			})
		}
	})

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

	for _, deadline := range []bool{false, true} {
		name := "caller cancellation"
		if deadline {
			name = "caller deadline"
		}
		t.Run(name+" during verification preserves VM diagnostics", func(t *testing.T) {
			vm := provision(t)
			connect(t, vm)
			builder.GetVMContext(vm.ID).SetFailureDetails("existing failure details")
			tx, err := db.Pool.Begin(ctx)
			require.NoError(t, err)
			defer tx.Rollback(ctx)
			_, err = tx.Exec(ctx, `SELECT vm_id FROM machine_ssh_host_key WHERE vm_id=$1 FOR UPDATE`, vm.ID)
			require.NoError(t, err)

			requestCtx, cancel := context.WithCancel(ctx)
			want := error(context.Canceled)
			if deadline {
				cancel()
				requestCtx, cancel = context.WithTimeout(ctx, 2*time.Second)
				want = context.DeadlineExceeded
			}
			defer cancel()
			beforeAuth := authentications.Load()
			results := make(chan error, 1)
			go func() {
				client, err := builder.GetSSHClient(requestCtx, vm)
				if client != nil {
					_ = client.Close()
				}
				results <- err
			}()
			require.Eventually(t, func() bool {
				var waiting bool
				err := db.Pool.QueryRow(ctx, `SELECT EXISTS (
					SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'
					AND query LIKE '%FROM machine_ssh_host_key identity JOIN machine_pool machine%'
					AND pid <> pg_backend_pid())`).Scan(&waiting)
				return err == nil && waiting
			}, time.Second, 10*time.Millisecond, "verification must be waiting on the locked enrollment")
			if !deadline {
				cancel()
			}
			select {
			case err := <-results:
				require.ErrorIs(t, err, want)
				require.NotErrorIs(t, err, builder.ErrSSHHostKeyVerification)
			case <-time.After(5 * time.Second):
				t.Fatal("canceled verification did not return")
			}
			require.Equal(t, beforeAuth, authentications.Load(), "cancellation must precede client authentication")
			_, _, _, details := builder.GetVMContext(vm.ID).GetDebugInfo()
			require.Equal(t, "existing failure details", details)
			require.NoError(t, tx.Rollback(ctx))
			var pinned string
			require.NoError(t, db.Pool.QueryRow(ctx, `SELECT host_key FROM machine_ssh_host_key WHERE vm_id=$1 AND failed_at IS NULL`, vm.ID).Scan(&pinned))
			require.Equal(t, strings.TrimSpace(string(ssh.MarshalAuthorizedKey(keyA.PublicKey()))), pinned)
		})
	}

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
