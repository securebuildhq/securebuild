package ociproxy_test

import (
	"context"
	"fmt"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/remote/transport"
	"github.com/securebuildhq/securebuild/integration/testutil"
	"github.com/stretchr/testify/require"
)

// TestOCIProxyHappyPath tests pushing and pulling an image through the OCI proxy
// In production, the image is pushed from builder CLI. This test pushes the image without CLI. So that still needs to be tested.
func TestOCIProxyHappyPath(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping integration test in short mode")
	}

	ctx := context.Background()

	// Setup test database
	testDB := testutil.SetupTestDatabase(ctx, t)
	defer testutil.TeardownTestDatabase(ctx, t, testDB)

	// Apply seed data
	projectRoot, err := testutil.FindProjectRoot()
	require.NoError(t, err)

	seedDataDir := filepath.Join(projectRoot, "integration", "ociproxy", "testdata", "seed-data")
	err = testutil.ApplySchemaHero(ctx, testDB.ConnStr, seedDataDir, true)
	require.NoError(t, err)

	// Setup test registry
	registry := testutil.SetupTestRegistry(ctx, t)
	defer testutil.TeardownTestRegistry(ctx, t, registry)

	// Create a minimal test image from scratch
	fmt.Println("Creating minimal test image...")
	img, err := createTestImage()
	require.NoError(t, err)

	// Push test image to registry with authentication
	// Use static credentials to push to the upstream registry path that matches REPLICATED_APP_SLUG
	fmt.Println("Pushing test image to registry...")
	testImageRef := fmt.Sprintf("%s/securebuild/test-image:latest", registry.Address)
	testRef, err := name.ParseReference(testImageRef)
	require.NoError(t, err)

	auth := &authn.Basic{
		Username: registry.StaticUsername,
		Password: registry.StaticPassword,
	}

	// Create base transport with TLS config
	baseTransport := http.DefaultTransport.(*http.Transport).Clone()
	baseTransport.TLSClientConfig = registry.TLSConfig

	// Step 1: Explicitly exchange Basic auth for JWT token using transport.Exchange
	// First, ping the registry to get the auth challenge
	challenge, err := transport.Ping(ctx, testRef.Context().Registry, baseTransport)
	require.NoError(t, err)

	fmt.Printf("Registry auth challenge: scheme=%s\n", challenge.Scheme)

	// Exchange credentials for token using transport.Exchange()
	scopes := []string{testRef.Context().Scope(transport.PushScope)}
	token, err := transport.Exchange(ctx, testRef.Context().Registry, auth, baseTransport, scopes, challenge)
	require.NoError(t, err)

	fmt.Printf("Successfully exchanged credentials for JWT token\n")

	// Now use the token to push the image
	bearerAuth := &authn.Bearer{Token: token.Token}
	err = remote.Write(testRef, img, remote.WithAuth(bearerAuth), remote.WithTransport(baseTransport))
	require.NoError(t, err)

	fmt.Printf("Image pushed successfully to %s\n", testImageRef)

	// Get the image digest
	imgDigest, err := img.Digest()
	require.NoError(t, err)
	fmt.Printf("Image digest: %s\n", imgDigest)

	// Start OCI Proxy server
	proxy := setupTestProxy(ctx, t, testDB, registry)
	defer teardownTestProxy(t, proxy)

	// Pull image through proxy using service account credentials
	fmt.Println("Pulling image through OCI proxy...")
	proxyImageRef := fmt.Sprintf("%s/test-image:latest", proxy.Address)
	proxyRef, err := name.ParseReference(proxyImageRef)
	require.NoError(t, err)

	// Use service account credentials from seed data
	proxyAuth := &authn.Basic{
		Username: "testociteam",  // registry_username from securebuild-team seed data
		Password: "testpassword", // matches bcrypt hash in service-account seed data
	}

	pulledImg, err := remote.Image(proxyRef, remote.WithAuth(proxyAuth))
	require.NoError(t, err)

	pulledDigest, err := pulledImg.Digest()
	require.NoError(t, err)
	fmt.Printf("Pulled image digest: %s\n", pulledDigest)

	// Verify pulled image matches pushed image
	require.Equal(t, imgDigest, pulledDigest, "Pulled image digest should match pushed image digest")
}
