package externalimage

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/securebuildhq/securebuild/pkg/param"
	"github.com/securebuildhq/securebuild/pkg/storage"
)

// stripDigestAlgo removes the algorithm prefix from a digest string.
// "sha256:ab3f..." -> "ab3f..."
func stripDigestAlgo(digest string) string {
	if idx := strings.Index(digest, ":"); idx != -1 {
		return digest[idx+1:]
	}
	return digest
}

// blobStore wraps an R2Client for external image blob storage.
type blobStore struct {
	client *storage.R2Client
}

func newBlobStore(ctx context.Context) (*blobStore, error) {
	p := param.GetParam(ctx)
	bucket := p.R2ImageScansBucketName
	client, err := storage.NewR2Client(ctx, bucket)
	if err != nil {
		return nil, fmt.Errorf("failed to create blob store client: %w", err)
	}
	return &blobStore{client: client}, nil
}

// --- Key generation (deterministic from primary key) ---

func rawResultKey(digest, arch string) string {
	return fmt.Sprintf("%s/%s/raw_result.json.gz", stripDigestAlgo(digest), arch)
}

func parsedResultsDetailsKey(digest, arch string) string {
	return fmt.Sprintf("%s/%s/parsed_results_details.json.gz", stripDigestAlgo(digest), arch)
}

func sbomKey(digest, arch string) string {
	return fmt.Sprintf("%s/%s/sbom.json.gz", stripDigestAlgo(digest), arch)
}

// gzipData compresses a string using gzip and returns the compressed bytes.
func gzipData(data string) ([]byte, error) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write([]byte(data)); err != nil {
		return nil, fmt.Errorf("failed to gzip data: %w", err)
	}
	if err := gz.Close(); err != nil {
		return nil, fmt.Errorf("failed to close gzip writer: %w", err)
	}
	return buf.Bytes(), nil
}

// gunzipData decompresses gzip-compressed bytes and returns the original string.
func gunzipData(data []byte) (string, error) {
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gz.Close()
	decompressed, err := io.ReadAll(gz)
	if err != nil {
		return "", fmt.Errorf("failed to decompress gzip data: %w", err)
	}
	return string(decompressed), nil
}

// --- Upload (gzip-compressed) ---

func (s *blobStore) putRawResult(ctx context.Context, digest, arch, data string) error {
	compressed, err := gzipData(data)
	if err != nil {
		return err
	}
	return s.client.PutObject(ctx, rawResultKey(digest, arch), bytes.NewReader(compressed))
}

func (s *blobStore) putParsedResultsDetails(ctx context.Context, digest, arch, data string) error {
	compressed, err := gzipData(data)
	if err != nil {
		return err
	}
	return s.client.PutObject(ctx, parsedResultsDetailsKey(digest, arch), bytes.NewReader(compressed))
}

func (s *blobStore) putSBOM(ctx context.Context, digest, arch, data string) error {
	compressed, err := gzipData(data)
	if err != nil {
		return err
	}
	return s.client.PutObject(ctx, sbomKey(digest, arch), bytes.NewReader(compressed))
}

// --- Download (gzip-decompressed) ---

func (s *blobStore) getRawResult(ctx context.Context, digest, arch string) (string, error) {
	data, err := s.client.GetObjectData(ctx, rawResultKey(digest, arch))
	if err != nil {
		return "", err
	}
	return gunzipData(data)
}

func (s *blobStore) getParsedResultsDetails(ctx context.Context, digest, arch string) (string, error) {
	data, err := s.client.GetObjectData(ctx, parsedResultsDetailsKey(digest, arch))
	if err != nil {
		return "", err
	}
	return gunzipData(data)
}

func (s *blobStore) getSBOM(ctx context.Context, digest, arch string) (string, error) {
	data, err := s.client.GetObjectData(ctx, sbomKey(digest, arch))
	if err != nil {
		return "", err
	}
	return gunzipData(data)
}
