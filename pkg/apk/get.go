package apk

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/jackc/pgx/v5"
	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/persistence"
	"github.com/securebuildhq/securebuild/pkg/storage"
)

// CatalogAPK represents a record in the apk_catalog table
type CatalogAPK struct {
	Filename     string
	Arch         string
	IndexContent string
	IsWithdrawn  bool
}

// GetAPKIndexStream returns the S3 GetObjectOutput for streaming the APK index
func GetAPKIndexStream(ctx context.Context, arch string) (*s3.GetObjectOutput, error) {
	// Create R2 client (dynamic folder retrieved automatically)
	r2Client, err := storage.NewR2Client(ctx, param.GetParam(ctx).R2BucketName)
	if err != nil {
		return nil, fmt.Errorf("failed to create R2 client: %w", err)
	}

	// Build the key for APKINDEX.tar.gz
	key := fmt.Sprintf("%s/%s", arch, "APKINDEX.tar.gz")

	// Get the object from R2
	result, err := r2Client.GetObject(ctx, key)
	if err != nil {
		// If object doesn't exist, return nil (caller handles this)
		var noSuchKey *types.NoSuchKey
		if errors.As(err, &noSuchKey) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to get object from R2: %w", err)
	}

	return result, nil
}

// GetAPKIndex downloads the APK index to a temporary file and returns the file path
// This function is kept for backward compatibility with existing code that needs a file path
func GetAPKIndex(ctx context.Context, arch string) (string, error) {
	// Get the S3 object
	s3Object, err := GetAPKIndexStream(ctx, arch)
	if err != nil {
		return "", fmt.Errorf("failed to get APK index stream: %w", err)
	}
	if s3Object == nil {
		// this is handled by callers like "file does not exist"
		return "", nil
	}
	defer s3Object.Body.Close()

	// Create a temporary file
	tempFile, err := os.CreateTemp("", "apkindex-*.tar.gz")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	defer tempFile.Close()

	// Copy the object content to the temporary file
	_, err = io.Copy(tempFile, s3Object.Body)
	if err != nil {
		os.Remove(tempFile.Name())
		return "", fmt.Errorf("failed to write to temp file: %w", err)
	}

	return tempFile.Name(), nil
}

// GetCatalogAPK retrieves an APK catalog record by filename and arch
func GetCatalogAPK(ctx context.Context, filename string, arch string) (*CatalogAPK, error) {
	conn := persistence.MustGetPooledPostgresSession(ctx)
	defer conn.Release()

	query := `SELECT filename, arch, index_content, is_withdrawn FROM apk_catalog WHERE filename = $1 AND arch = $2`
	var catalog CatalogAPK
	err := conn.QueryRow(ctx, query, filename, arch).Scan(&catalog.Filename, &catalog.Arch, &catalog.IndexContent, &catalog.IsWithdrawn)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("apk catalog record not found for filename %s and arch %s", filename, arch)
		}
		return nil, fmt.Errorf("failed to get apk catalog record: %w", err)
	}

	return &catalog, nil
}
