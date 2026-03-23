package storage

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/securebuildhq/securebuild/pkg/dynamicparam"
	"github.com/securebuildhq/securebuild/pkg/param"
)

// R2Client handles operations with Cloudflare R2 storage
type R2Client struct {
	client        *s3.Client
	bucket        string
	dynamicFolder string
}

// NewR2Client creates a new R2 client from context parameters
// Automatically retrieves dynamic folder from dynamicparam if R2UseDynamicFolder is enabled
func NewR2Client(ctx context.Context, bucketName string) (*R2Client, error) {
	p := param.GetParam(ctx)

	if bucketName == "" || p.R2AccessKey == "" || p.R2SecretKey == "" || p.R2Endpoint == "" {
		return nil, fmt.Errorf("R2 configuration parameters are missing")
	}

	// Get dynamic folder from dynamicparam if enabled
	dynamicFolder := ""
	if p.R2UseDynamicFolder {
		folder, err := dynamicparam.GetDynamicParam(ctx, "r2_directory")
		if err != nil {
			return nil, fmt.Errorf("failed to get r2 directory: %w", err)
		}
		dynamicFolder = folder
	}

	region := p.R2Region
	if region == "" {
		region = "auto" // Cloudflare R2; AWS S3 needs the real region (set r2_region in config).
	}

	// Load AWS config with custom endpoint and credentials
	cfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
		config.WithBaseEndpoint(p.R2Endpoint),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			p.R2AccessKey,
			p.R2SecretKey,
			"",
		)),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	// Create S3 client with path-style if configured
	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		if p.R2UsePathStyle {
			o.UsePathStyle = true
		}
	})

	return &R2Client{
		client:        s3Client,
		bucket:        bucketName,
		dynamicFolder: dynamicFolder,
	}, nil
}

// ensurePrefix checks if key already has the dynamic folder prefix, and adds it if missing
func (r *R2Client) ensurePrefix(key string) string {
	if r.dynamicFolder == "" {
		return key
	}
	// If key already starts with dynamic folder, return as-is (from ListObjects)
	if strings.HasPrefix(key, r.dynamicFolder+"/") {
		return key
	}
	// Otherwise, add the prefix (relative path from caller)
	return r.dynamicFolder + "/" + key
}

// =============================================================================
// General-Purpose R2 Operations
// =============================================================================

// ListObjects lists objects with a given prefix
func (r *R2Client) ListObjects(ctx context.Context, prefix string, maxKeys int32) (*s3.ListObjectsV2Output, error) {
	// Apply dynamic folder to prefix
	fullPrefix := r.ensurePrefix(prefix)

	input := &s3.ListObjectsV2Input{
		Bucket:  aws.String(r.bucket),
		Prefix:  aws.String(fullPrefix),
		MaxKeys: aws.Int32(maxKeys),
	}

	result, err := r.client.ListObjectsV2(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("failed to list objects in R2 bucket: %w", err)
	}

	return result, nil
}

// GetObject retrieves an object and returns the body as bytes
// Note: This expects a fully qualified key (e.g., from ListObjects)
func (r *R2Client) GetObjectData(ctx context.Context, key string) ([]byte, error) {
	result, err := r.GetObject(ctx, key)
	if err != nil {
		return nil, fmt.Errorf("failed to get object from R2: %w", err)
	}
	defer result.Body.Close()

	data, err := io.ReadAll(result.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read object from R2: %w", err)
	}

	return data, nil
}

// GetObjectOutput retrieves an object and returns the full S3 GetObjectOutput
// This is useful when you need access to S3 metadata, ETag, LastModified, etc.
// Note: Caller is responsible for closing the Body stream in the returned output
func (r *R2Client) GetObject(ctx context.Context, key string) (*s3.GetObjectOutput, error) {
	fullKey := r.ensurePrefix(key)

	result, err := r.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(fullKey),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get object from R2: %w", err)
	}

	return result, nil
}

// PutObject uploads data to R2
func (r *R2Client) PutObject(ctx context.Context, key string, data io.Reader) error {
	// Apply dynamic folder to key
	fullKey := r.ensurePrefix(key)

	input := &s3.PutObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(fullKey),
		Body:   data,
	}

	_, err := r.client.PutObject(ctx, input)
	if err != nil {
		return fmt.Errorf("failed to upload object to R2: %w", err)
	}

	return nil
}

// DeleteObject deletes a single object
// Accepts either a relative path or a fully qualified key (e.g., from ListObjects)
// Automatically adds dynamic folder prefix if needed
func (r *R2Client) DeleteObject(ctx context.Context, key string) error {
	fullKey := r.ensurePrefix(key)

	_, err := r.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(fullKey),
	})
	if err != nil {
		return fmt.Errorf("failed to delete object from R2: %w", err)
	}

	return nil
}

// DeleteObjects deletes multiple objects in batches (1000 per batch)
// Accepts either relative paths or fully qualified keys (e.g., from ListObjects)
// Automatically adds dynamic folder prefix if needed
func (r *R2Client) DeleteObjects(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil // Nothing to delete
	}

	// Delete objects in batches of 1000 (S3 API limit)
	const batchSize = 1000
	for i := 0; i < len(keys); i += batchSize {
		end := i + batchSize
		if end > len(keys) {
			end = len(keys)
		}

		batch := keys[i:end]
		objectIdentifiers := make([]types.ObjectIdentifier, len(batch))
		for j, key := range batch {
			fullKey := r.ensurePrefix(key)
			objectIdentifiers[j] = types.ObjectIdentifier{
				Key: aws.String(fullKey),
			}
		}

		_, err := r.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(r.bucket),
			Delete: &types.Delete{
				Objects: objectIdentifiers,
			},
		})
		if err != nil {
			return fmt.Errorf("failed to delete objects from R2 bucket: %w", err)
		}
	}

	return nil
}

// CopyObject copies an object within R2
func (r *R2Client) CopyObject(ctx context.Context, sourceKey, destKey string) error {
	// Apply dynamic folder to both source and dest
	fullSourceKey := r.ensurePrefix(sourceKey)
	fullDestKey := r.ensurePrefix(destKey)

	copySource := fmt.Sprintf("%s/%s", r.bucket, fullSourceKey)

	input := &s3.CopyObjectInput{
		Bucket:     aws.String(r.bucket),
		CopySource: aws.String(copySource),
		Key:        aws.String(fullDestKey),
	}

	_, err := r.client.CopyObject(ctx, input)
	if err != nil {
		return fmt.Errorf("failed to copy object in R2: %w", err)
	}

	return nil
}
