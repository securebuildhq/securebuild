package storage

import (
	"context"
	"encoding/xml"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/stretchr/testify/require"
)

func TestDeleteObjectsBatchesAndSurfacesFailures(t *testing.T) {
	for _, mode := range []string{"success", "partial failure", "denied", "missing bucket", "server error"} {
		t.Run(mode, func(t *testing.T) {
			var batches []int
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				require.Equal(t, http.MethodPost, r.Method, "deletion must not preflight keys with HEAD")
				require.Equal(t, "/scans", r.URL.Path)
				var body struct {
					Objects []struct{ Key string } `xml:"Object"`
				}
				require.NoError(t, xml.NewDecoder(r.Body).Decode(&body))
				batches = append(batches, len(body.Objects))
				for _, object := range body.Objects {
					require.Contains(t, object.Key, "environment/digest/")
				}
				w.Header().Set("Content-Type", "application/xml")
				switch mode {
				case "success":
					fmt.Fprint(w, `<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>`)
				case "partial failure":
					fmt.Fprint(w, `<DeleteResult><Error><Key>bad-key</Key><Code>AccessDenied</Code><Message>denied</Message></Error></DeleteResult>`)
				case "denied":
					w.WriteHeader(403)
					fmt.Fprint(w, `<Error><Code>AccessDenied</Code></Error>`)
				case "missing bucket":
					w.WriteHeader(404)
					fmt.Fprint(w, `<Error><Code>NoSuchBucket</Code></Error>`)
				case "server error":
					w.WriteHeader(500)
				}
			}))
			defer server.Close()
			client := s3.NewFromConfig(aws.Config{
				Region: "auto", Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""), RetryMaxAttempts: 1,
			}, func(o *s3.Options) { o.BaseEndpoint = aws.String(server.URL); o.UsePathStyle = true })
			store := &R2Client{client: client, bucket: "scans", dynamicFolder: "environment"}
			keys := make([]string, 1002)
			for i := range keys {
				keys[i] = fmt.Sprintf("digest/%d", i)
			}
			keys[0] = "environment/digest/0"
			err := store.DeleteObjects(context.Background(), keys)
			if mode == "success" {
				require.NoError(t, err)
				require.Equal(t, []int{1000, 2}, batches)
			} else {
				require.Error(t, err)
				require.Equal(t, []int{1000}, batches)
			}
		})
	}
}
