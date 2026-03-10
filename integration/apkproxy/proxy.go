package apkproxy_test

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/apkproxy"
	"github.com/stretchr/testify/require"
)

type TestProxy struct {
	Address string
	Cancel  context.CancelFunc
}

// setupTestProxy starts the APK proxy server
// NOTE: Param and persistence must already be initialized before calling this function.
// The ctx parameter must have param and DBURI already set.
func setupTestProxy(ctx context.Context, t *testing.T, testDB *testutil.TestDatabase, minioStorage *testutil.MinIOStorage) *TestProxy {
	t.Helper()

	fmt.Println("Starting APK Proxy server...")

	// Find a random available port
	listener, err := net.Listen("tcp", "localhost:0")
	require.NoError(t, err, "Failed to find available port")

	proxyAddress := listener.Addr().String()
	listener.Close()

	fmt.Printf("Using random port: %s\n", proxyAddress)

	// Create cancellable context for proxy server (based on enriched ctx passed in)
	proxyCtx, cancel := context.WithCancel(ctx)

	// Start proxy in goroutine
	go func() {
		if err := apkproxy.StartProxy(proxyCtx, proxyAddress); err != nil && err != context.Canceled {
			t.Logf("Proxy server error: %v", err)
		}
	}()

	// Wait for proxy to be ready
	ready := false
	for i := 0; i < 30; i++ {
		resp, err := http.Get("http://" + proxyAddress + "/")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				ready = true
				break
			}
		}
		time.Sleep(1 * time.Second)
	}

	require.True(t, ready, "Proxy server failed to become ready")
	fmt.Printf("Proxy server started at %s\n", proxyAddress)

	return &TestProxy{
		Address: proxyAddress,
		Cancel:  cancel,
	}
}

// teardownTestProxy stops the APK proxy server
func teardownTestProxy(t *testing.T, proxy *TestProxy) {
	t.Helper()

	fmt.Println("Tearing down test proxy...")

	if proxy.Cancel != nil {
		proxy.Cancel()
		fmt.Println("Proxy server stopped")
	}
}
