package testutil

import (
	"context"
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
	// This is a test RSA private key (1024 bit), base64 encoded - DO NOT use in production
	return "LS0tLS1CRUdJTiBSU0EgUFJJVkFURSBLRVktLS0tLQpNSUlDWGdJQkFBS0JnUURmdkNRakRUcmVKYXdrYzAyMm1vbU1nQnBlVWNEaWNyU1pONkFKZ0dJOVVOdWt1ODF3CldSTnNxTXR0SWRWMlBYTllkVnhHN3kzanBoQnpJK1d6eUZiN2FxVWR1NzVKdzZLdUQrbmJKMkpQbG55dlpIbnUKWERab1N1M0ZpL21Cdy9KUzRqR3RTVGlTckMzWjhyTDAvT1lMcXFmcXpVRW5MeWFpQXpiSmlMc2R0UUlEQVFBQgpBb0dCQU1ndXdHNlVVYzJlQzIzNXROampZSnJUcThRa2hkNlhIenZQNTJOWStZMC9JYWM5V2MxaUJkMDlFZmF0ClJSOHNVRjRmYzljTC9oVW42cVA2eEhXZGxTUm1RU0haYUVyZ2VxcHFXT2E4NHorVHdWczlPUW81dW9QbzhmL2cKOXdSNksxQ0hkbDlpcHhmUzduM0RJRS95NHpCTkVsSGZDKythNGMwOTRrSi9uWTlCQWtFQSt2SWc3dkQ0LzRVeAphdHcxZmFNVFc5M05adGRUVHpXWG8zclRwMGlndkd6WkgwNUU2cU1JS0hLK09sMVpDU1BjTjZpUFpPZUNPTlFLCks3eDVUVFllRFFKQkFPUTl0cmZqclB3M29rcHNSQjJBUjJJdDNib3NrUDlZQkwxMkxBWVJWSDExamhPQXIybmMKK3Y2QThjaTlteG1ZbDRLejY5SkJmN04rZC9TYnZxdG52RWtDUVFDTmtuNEw3enk2Z3Z6L0tWNndFNGsvWWFHWQpyRS9ldHdCbWhVdlU2ejlyTGdsTUJROFNSSW04c0FjcnpEQUgzUWhIQ2p4ams4dytuVGxqdFQvRjFJc2RBa0F4CjhxZDMycVZTbE1JNVV6UWMyS1BHZ284UlhRdG1OZGJqdDJhdTlUL3VMTG1vM3ZLRVVrM0RRR2lwSzRVenRzY0IKWFdwd0d0RmRjSUhEMEFtTDdTbXhBa0VBOUJ2QWsyL3lnQnFNamhRSGhpT0F2VUwrcE1RZmZlSm8wc1cram9FUQpzMDM4clBPbXJCLzlUUExwcG5Jc3dsQzBtUExoRE1CZTlnUk1qQzAvWVlvbWRBPT0KLS0tLS1FTkQgUlNBIFBSSVZBVEUgS0VZLS0tLS0K"
}
