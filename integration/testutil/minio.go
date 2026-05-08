package testutil

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/stretchr/testify/require"
	miniocontainer "github.com/testcontainers/testcontainers-go/modules/minio"
)

// MinIOStorage provides S3-compatible object storage using MinIO Testcontainer
type MinIOStorage struct {
	Container  *miniocontainer.MinioContainer
	Endpoint   string
	BucketName string
	AccessKey  string
	SecretKey  string
	S3Client   *s3.Client
}

// SetupMinIO creates a MinIO Testcontainer for S3-compatible storage
func SetupMinIO(ctx context.Context, t *testing.T) *MinIOStorage {
	t.Helper()

	fmt.Println("Starting MinIO container...")

	// Start MinIO container using Testcontainers
	minioContainer, err := miniocontainer.Run(ctx,
		"minio/minio:RELEASE.2025-09-07T16-13-09Z",
	)
	require.NoError(t, err)

	// Get connection details
	endpoint, err := minioContainer.ConnectionString(ctx)
	require.NoError(t, err)

	// Ensure endpoint has http:// scheme
	if len(endpoint) < 4 || endpoint[:4] != "http" {
		endpoint = "http://" + endpoint
	}

	fmt.Printf("MinIO container started at %s\n", endpoint)

	// Create AWS S3 client with path-style addressing
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion("us-east-1"),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			"minioadmin",
			"minioadmin",
			"",
		)),
		config.WithEndpointResolverWithOptions(aws.EndpointResolverWithOptionsFunc(
			func(service, region string, options ...interface{}) (aws.Endpoint, error) {
				return aws.Endpoint{
					URL:               endpoint,
					HostnameImmutable: true,
					Source:            aws.EndpointSourceCustom,
				}, nil
			},
		)),
	)
	require.NoError(t, err)

	// Create S3 client with path-style addressing (required for MinIO)
	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true
	})

	storage := &MinIOStorage{
		Container:  minioContainer,
		Endpoint:   endpoint,
		BucketName: "test-bucket",
		AccessKey:  "minioadmin",
		SecretKey:  "minioadmin",
		S3Client:   s3Client,
	}

	// Create test bucket
	fmt.Printf("Creating bucket '%s'...\n", storage.BucketName)
	_, err = s3Client.CreateBucket(ctx, &s3.CreateBucketInput{
		Bucket: &storage.BucketName,
	})
	require.NoError(t, err)

	// Wait for bucket to be ready
	waiter := s3.NewBucketExistsWaiter(s3Client)
	err = waiter.Wait(ctx, &s3.HeadBucketInput{
		Bucket: &storage.BucketName,
	}, 30*time.Second)
	require.NoError(t, err)

	fmt.Println("MinIO bucket created and ready")
	return storage
}

// TeardownMinIO stops the MinIO container
func TeardownMinIO(ctx context.Context, t *testing.T, storage *MinIOStorage) {
	t.Helper()

	fmt.Println("Tearing down MinIO container...")

	if storage.Container != nil {
		if err := storage.Container.Terminate(ctx); err != nil {
			t.Logf("Failed to terminate MinIO container: %v", err)
		}
		fmt.Println("MinIO container stopped")
	}
}

// SetupMinIOEnv sets environment variables for MinIO storage
// Uses t.Setenv for automatic cleanup when the test completes
func SetupMinIOEnv(t *testing.T, m *MinIOStorage) {
	t.Setenv("R2_BUCKET_NAME", m.BucketName)
	t.Setenv("R2_ACCESS_KEY", m.AccessKey)
	t.Setenv("R2_SECRET_KEY", m.SecretKey)
	t.Setenv("R2_ENDPOINT", m.Endpoint)
	t.Setenv("R2_USE_PATH_STYLE", "true")

	// Set dummy APK signing keys for testing
	// These are test keys that are not used in production
	t.Setenv("APK_SIGNING_KEY_NAME", "test-key.rsa")
	t.Setenv("APK_SIGNING_KEY_DATA", GenerateTestRSAPrivateKey())
	t.Setenv("APK_PUBLIC_KEY_NAME", "test-key.rsa.pub")
	t.Setenv("APK_PUBLIC_KEY_DATA", "") // Not needed for signing
}

// GenerateTestRSAPrivateKey generates a base64-encoded PEM RSA private key for testing
func GenerateTestRSAPrivateKey() string {
	// Generate a fresh 2048-bit RSA key so CRT parameters are consistent.
	// Go 1.26+ enforces dP/dQ consistency during parsing.
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(fmt.Sprintf("failed to generate test RSA key: %v", err))
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(priv),
	})
	return base64.StdEncoding.EncodeToString(pemBytes)
}

// GenerateTestRSAPublicKey generates a base64-encoded PEM RSA public key for testing
func GenerateTestRSAPublicKey() string {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic(fmt.Sprintf("failed to generate test RSA key: %v", err))
	}
	pubBytes, err := x509.MarshalPKIXPublicKey(&priv.PublicKey)
	if err != nil {
		panic(fmt.Sprintf("failed to marshal public key: %v", err))
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubBytes,
	})
	return base64.StdEncoding.EncodeToString(pemBytes)
}
