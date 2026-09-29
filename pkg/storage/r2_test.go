package storage

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/stretchr/testify/require"
)

func TestObjectSizeDistinguishesAbsenceFromErrorsAndUsesPrefix(t *testing.T) {
	for _, status := range []int{200, 404, 403, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, http.MethodHead, r.Method)
				require.Equal(t, "/scans/environment/digest/x86_64/raw_result.json.gz", r.URL.Path)
				if status == 200 {
					w.Header().Set("Content-Length", "42")
				}
				w.WriteHeader(status)
			}))
			defer server.Close()
			client := s3.NewFromConfig(aws.Config{
				Region: "auto", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""), RetryMaxAttempts: 1,
			}, func(o *s3.Options) { o.BaseEndpoint = aws.String(server.URL); o.UsePathStyle = true })
			store := &R2Client{client: client, bucket: "scans", dynamicFolder: "environment"}
			for _, key := range []string{"digest/x86_64/raw_result.json.gz", "environment/digest/x86_64/raw_result.json.gz"} {
				size, exists, err := store.ObjectSize(context.Background(), key)
				switch status {
				case 200:
					require.NoError(t, err)
					require.True(t, exists)
					require.EqualValues(t, 42, size)
				case 404:
					require.NoError(t, err)
					require.False(t, exists)
				default:
					require.Error(t, err)
					require.False(t, exists)
				}
			}
		})
	}
}
