package testutil

import (
	"net"
	"testing"

	"github.com/gliderlabs/ssh"
)

// MockSSHServer creates an in-memory SSH server for testing on a random available port.
// It accepts all connections and responds to exec requests with predefined output.
// Returns the port number and a cleanup function that must be called to stop the server.
func MockSSHServer(t *testing.T) (port int, cleanup func()) {
	t.Helper()

	// Use port 0 to let the OS assign an available port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to start mock SSH server: %v", err)
	}

	// Extract the assigned port
	port = listener.Addr().(*net.TCPAddr).Port

	server := &ssh.Server{
		Handler: func(s ssh.Session) {
			// Handle the session - commands come through s.Command()
			// Just exit successfully for all commands
			s.Exit(0)
		},
	}

	// Allow any password
	server.PasswordHandler = func(ctx ssh.Context, password string) bool {
		return true
	}

	// Allow any public key
	server.PublicKeyHandler = func(ctx ssh.Context, key ssh.PublicKey) bool {
		return true
	}

	// Start server in background
	go func() {
		server.Serve(listener)
	}()

	cleanup = func() {
		server.Close()
		listener.Close()
	}

	return port, cleanup
}
