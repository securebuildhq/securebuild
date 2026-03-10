package ociproxy_test

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	v1 "github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/empty"
	"github.com/google/go-containerregistry/pkg/v1/mutate"
	"github.com/google/go-containerregistry/pkg/v1/tarball"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/securebuildhq/securebuild/pkg/ociproxy"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/stretchr/testify/require"
)

type TestProxy struct {
	Address string
	Cancel  context.CancelFunc
}

// setupTestProxy starts the OCI proxy server
func setupTestProxy(ctx context.Context, t *testing.T, testDB *testutil.TestDatabase, registry *testutil.TestRegistry) *TestProxy {
	t.Helper()

	fmt.Println("Starting OCI Proxy server...")

	// Find a random available port
	listener, err := net.Listen("tcp", "localhost:0")
	require.NoError(t, err, "Failed to find available port")

	proxyAddress := listener.Addr().String()
	listener.Close()

	fmt.Printf("Using random port: %s\n", proxyAddress)

	// Initialize param package with test overrides (NO MORE t.Setenv!)
	overrides := map[string]string{
		"DB_URI":                    testDB.ConnStr,
		"CVE0_OCI_HOST":             proxyAddress,
		"REPLICATED_REGISTRY_HOST":  registry.Address,
		"REPLICATED_APP_SLUG":       "securebuild",
		"REPLICATED_API_TOKEN":      registry.StaticPassword,
		"OCI_PROXY_JWT_SECRET":      "test-jwt-secret-for-integration-testing",
		"OCI_PROXY_SKIP_TLS_VERIFY": "true",
	}
	ctx, err = param.Init(param.InitSourceEnvironment, overrides)
	require.NoError(t, err)

	// Initialize persistence pool
	err = persistence.InitPostgres(ctx)
	require.NoError(t, err)

	// Create cancellable context for proxy server (based on enriched ctx)
	proxyCtx, cancel := context.WithCancel(ctx)

	// Start proxy in goroutine
	go func() {
		if err := ociproxy.StartProxy(proxyCtx, proxyAddress); err != nil && err != context.Canceled {
			t.Logf("Proxy server error: %v", err)
		}
	}()

	// Wait for proxy to be ready
	ready := false
	for i := 0; i < 30; i++ {
		resp, err := http.Get("http://" + proxyAddress + "/v2/")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusOK {
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

// teardownTestProxy stops the OCI proxy server
func teardownTestProxy(t *testing.T, proxy *TestProxy) {
	t.Helper()

	fmt.Println("Tearing down test proxy...")

	if proxy.Cancel != nil {
		proxy.Cancel()
		fmt.Println("Proxy server stopped")
	}
}

// createTestImage creates a minimal OCI image from scratch with a single file
func createTestImage() (v1.Image, error) {
	// Start with an empty image (no base image)
	img := empty.Image

	// Create a tar archive containing hello.txt
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)

	content := []byte("hello world\n")
	header := &tar.Header{
		Name: "hello.txt",
		Mode: 0644,
		Size: int64(len(content)),
	}

	if err := tw.WriteHeader(header); err != nil {
		return nil, fmt.Errorf("failed to write tar header: %w", err)
	}

	if _, err := tw.Write(content); err != nil {
		return nil, fmt.Errorf("failed to write tar content: %w", err)
	}

	if err := tw.Close(); err != nil {
		return nil, fmt.Errorf("failed to close tar writer: %w", err)
	}

	// Create a layer from the tar archive
	layer, err := tarball.LayerFromOpener(func() (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(buf.Bytes())), nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create layer: %w", err)
	}

	// Append the layer to the empty image
	img, err = mutate.AppendLayers(img, layer)
	if err != nil {
		return nil, fmt.Errorf("failed to append layer: %w", err)
	}

	return img, nil
}
