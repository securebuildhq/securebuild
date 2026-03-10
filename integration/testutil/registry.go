package testutil

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v3"
	"github.com/go-jose/go-jose/v3/jwt"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

type TestRegistry struct {
	Container      testcontainers.Container
	Host           string
	Port           int
	Address        string
	StaticUsername string
	StaticPassword string
	TLSConfig      *tls.Config
	TokenServer    *http.Server
	TokenAuthPort  int
}

// accessItem represents the Docker token access claim
type accessItem struct {
	Type    string   `json:"type"`
	Name    string   `json:"name"`
	Actions []string `json:"actions"`
}

// tokenClaims represents the JWT claims for Docker registry tokens
type tokenClaims struct {
	jwt.Claims
	Access []accessItem `json:"access"`
}

// generateSelfSignedCert creates a self-signed TLS certificate for testing
func generateSelfSignedCert(certFile, keyFile string) error {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return fmt.Errorf("failed to generate private key: %w", err)
	}

	notBefore := time.Now()
	notAfter := notBefore.Add(24 * time.Hour)

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return fmt.Errorf("failed to generate serial number: %w", err)
	}

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			Organization: []string{"Test Registry"},
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IPAddresses:           []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:              []string{"localhost", "registry"},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return fmt.Errorf("failed to create certificate: %w", err)
	}

	certOut, err := os.Create(certFile)
	if err != nil {
		return fmt.Errorf("failed to create cert file: %w", err)
	}
	defer certOut.Close()

	if err := pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes}); err != nil {
		return fmt.Errorf("failed to write certificate: %w", err)
	}

	keyOut, err := os.Create(keyFile)
	if err != nil {
		return fmt.Errorf("failed to create key file: %w", err)
	}
	defer keyOut.Close()

	privBytes, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return fmt.Errorf("failed to marshal private key: %w", err)
	}

	if err := pem.Encode(keyOut, &pem.Block{Type: "PRIVATE KEY", Bytes: privBytes}); err != nil {
		return fmt.Errorf("failed to write private key: %w", err)
	}

	return nil
}

// startMockTokenService starts a mock token authentication service on localhost
// This service validates credentials and issues JWT tokens
func startMockTokenService(t *testing.T, privateKey *rsa.PrivateKey, cert *x509.Certificate, staticUsername, staticPassword string) (*http.Server, int) {
	t.Helper()

	// Find an available port
	listener, err := net.Listen("tcp", "localhost:0")
	require.NoError(t, err)
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("/v2/token", func(w http.ResponseWriter, r *http.Request) {
		// Validate Basic Auth credentials
		username, password, ok := r.BasicAuth()
		if !ok {
			w.Header().Set("WWW-Authenticate", `Basic realm="Token Service"`)
			http.Error(w, "Authorization required", http.StatusUnauthorized)
			return
		}

		// Validate credentials match static credentials
		if username != staticUsername || password != staticPassword {
			w.Header().Set("WWW-Authenticate", `Basic realm="Token Service"`)
			http.Error(w, "Invalid credentials", http.StatusUnauthorized)
			fmt.Printf("Mock token service rejected invalid credentials: username=%s\n", username)
			return
		}

		fmt.Printf("Mock token service validated credentials for username=%s\n", username)
		scope := r.URL.Query().Get("scope")
		service := r.URL.Query().Get("service")

		// Create JWT claims
		now := time.Now()
		accessItems := []accessItem{}

		// Parse scope and add to access
		if scope != "" {
			parts := strings.Split(scope, ":")
			if len(parts) >= 3 {
				accessItems = append(accessItems, accessItem{
					Type:    parts[0],
					Name:    parts[1],
					Actions: strings.Split(parts[2], ","),
				})
			}
		}

		claims := tokenClaims{
			Claims: jwt.Claims{
				Issuer:    "mock-token-issuer",
				Subject:   "testuser",
				Audience:  jwt.Audience{service},
				Expiry:    jwt.NewNumericDate(now.Add(5 * time.Minute)),
				NotBefore: jwt.NewNumericDate(now.Add(-24 * time.Hour)),
				IssuedAt:  jwt.NewNumericDate(now),
				ID:        fmt.Sprintf("token-%d", now.UnixNano()),
			},
			Access: accessItems,
		}

		// Create JSONWebKey with certificate chain (like makeSigningKeyWithChain in registry tests)
		jwk := &jose.JSONWebKey{
			Key:          privateKey,
			Certificates: []*x509.Certificate{cert},
			Algorithm:    string(jose.RS256),
		}

		// Create signer with EmbedJWK to include certificate in JWT header
		signingKey := jose.SigningKey{
			Algorithm: jose.RS256,
			Key:       jwk,
		}
		signerOpts := jose.SignerOptions{
			EmbedJWK: true,
		}
		signerOpts.WithType("JWT")

		signer, err := jose.NewSigner(signingKey, &signerOpts)
		if err != nil {
			http.Error(w, "Failed to create signer", http.StatusInternalServerError)
			t.Logf("Failed to create signer: %v", err)
			return
		}

		// Sign and serialize the JWT (like makeTestToken in registry tests)
		jwtResult, err := jwt.Signed(signer).Claims(claims).CompactSerialize()
		if err != nil {
			http.Error(w, "Failed to sign token", http.StatusInternalServerError)
			t.Logf("Failed to sign token: %v", err)
			return
		}

		response := map[string]interface{}{
			"token":      jwtResult,
			"expires_in": 300,
			"issued_at":  now.Format(time.RFC3339),
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)

		fmt.Printf("Mock token service issued token for scope=%s service=%s\n", scope, service)
	})

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
	}

	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			t.Logf("Mock token service error: %v", err)
		}
	}()

	time.Sleep(100 * time.Millisecond)
	fmt.Printf("Mock token service started on port %d\n", port)
	return server, port
}

// SetupTestRegistry creates a Docker Registry 3.0.0 container with TLS and authentication
func SetupTestRegistry(ctx context.Context, t *testing.T) *TestRegistry {
	t.Helper()

	fmt.Println("Starting Docker Registry container...")

	// Create temporary directory for registry data and certs
	tmpDir := t.TempDir()
	certFile := filepath.Join(tmpDir, "cert.pem")
	keyFile := filepath.Join(tmpDir, "key.pem")

	// Generate self-signed certificate for TLS
	err := generateSelfSignedCert(certFile, keyFile)
	require.NoError(t, err)

	// Step 1: Generate RSA key pair for JWT signing
	tokenPrivateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)

	// Create a self-signed certificate for the token signing key
	// Registry expects a certificate file, not just a public key
	tokenPublicKeyFile := filepath.Join(tmpDir, "token-cert.pem")
	tokenPrivateKeyFile := filepath.Join(tmpDir, "token-key.pem")

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: "Token Signing Key",
		},
		NotBefore:             time.Now().Add(-24 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}

	certDER, err := x509.CreateCertificate(rand.Reader, &template, &template, &tokenPrivateKey.PublicKey, tokenPrivateKey)
	require.NoError(t, err)

	// Parse certificate DER into x509.Certificate for token service
	tokenCert, err := x509.ParseCertificate(certDER)
	require.NoError(t, err)

	// Write certificate
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
	err = os.WriteFile(tokenPublicKeyFile, certPEM, 0644)
	require.NoError(t, err)

	// Write private key (not used by registry, but we need it for signing)
	privateKeyPEM := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(tokenPrivateKey),
	})
	err = os.WriteFile(tokenPrivateKeyFile, privateKeyPEM, 0644)
	require.NoError(t, err)

	// Define static credentials for token service
	staticUsername := "serviceaccount"
	staticPassword := "serviceaccount-secret-token"

	// Step 1: Start mock token service on localhost with certificate and static credentials
	tokenServer, tokenPort := startMockTokenService(t, tokenPrivateKey, tokenCert, staticUsername, staticPassword)

	// Step 1: Configure registry to use token auth
	// The realm tells clients where to get tokens - localhost is correct since clients run on the host
	// The registry itself never calls the auth service, it only validates tokens using the certificate
	tokenRealm := fmt.Sprintf("http://localhost:%d/v2/token", tokenPort)

	registryReq := testcontainers.ContainerRequest{
		Image:        "registry:3.0.0",
		ExposedPorts: []string{"5000/tcp"},
		Env: map[string]string{
			"REGISTRY_HTTP_ADDR":                        "0.0.0.0:5000",
			"REGISTRY_HTTP_TLS_CERTIFICATE":             "/certs/cert.pem",
			"REGISTRY_HTTP_TLS_KEY":                     "/certs/key.pem",
			"REGISTRY_AUTH":                             "token",
			"REGISTRY_AUTH_TOKEN_REALM":                 tokenRealm,
			"REGISTRY_AUTH_TOKEN_SERVICE":               "registry",
			"REGISTRY_AUTH_TOKEN_ISSUER":                "mock-token-issuer",
			"REGISTRY_AUTH_TOKEN_ROOTCERTBUNDLE":        "/auth/token-cert.pem",
			"REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY": "/var/lib/registry",
		},
		Files: []testcontainers.ContainerFile{
			{
				HostFilePath:      certFile,
				ContainerFilePath: "/certs/cert.pem",
				FileMode:          0644,
			},
			{
				HostFilePath:      keyFile,
				ContainerFilePath: "/certs/key.pem",
				FileMode:          0644,
			},
			{
				HostFilePath:      tokenPublicKeyFile,
				ContainerFilePath: "/auth/token-cert.pem",
				FileMode:          0644,
			},
		},
		WaitingFor: wait.ForLog("listening on").
			WithStartupTimeout(30 * time.Second),
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: registryReq,
		Started:          true,
	})
	require.NoError(t, err)

	host, err := container.Host(ctx)
	require.NoError(t, err)

	mappedPort, err := container.MappedPort(ctx, "5000/tcp")
	require.NoError(t, err)
	port := mappedPort.Int()

	address := fmt.Sprintf("%s:%d", host, port)
	fmt.Printf("Registry started at %s\n", address)

	return &TestRegistry{
		Container:      container,
		Host:           host,
		Port:           port,
		Address:        address,
		StaticUsername: staticUsername,
		StaticPassword: staticPassword,
		TLSConfig:      &tls.Config{InsecureSkipVerify: true},
		TokenServer:    tokenServer,
		TokenAuthPort:  tokenPort,
	}
}

// TeardownTestRegistry cleans up the test registry
func TeardownTestRegistry(ctx context.Context, t *testing.T, registry *TestRegistry) {
	t.Helper()

	fmt.Println("Tearing down test registry...")

	// Shutdown mock token service
	if registry.TokenServer != nil {
		if err := registry.TokenServer.Shutdown(ctx); err != nil {
			t.Logf("Failed to shutdown token server: %v", err)
		}
		fmt.Println("Token server stopped")
	}

	if registry.Container != nil {
		if err := registry.Container.Terminate(ctx); err != nil {
			t.Logf("Failed to terminate registry container: %v", err)
		}
		fmt.Println("Registry container stopped")
	}
}
