package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/require"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestTriggerImageSendsAdditionalImageTags(t *testing.T) {
	client := NewClient("https://api.example.test", "token", false)
	client.httpClient.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		var request ImageTriggerRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
		require.Equal(t, "go", request.ImageName)
		require.Equal(t, "1.24.13", request.Tag)
		require.Equal(t, []string{"1.24", "latest"}, request.ImageTags)
		return &http.Response{
			StatusCode: http.StatusAccepted,
			Body:       io.NopCloser(bytes.NewBufferString(`{"job_id":"job-1"}`)),
			Header:     make(http.Header),
		}, nil
	})
	response, err := client.TriggerImage(context.Background(), ImageTriggerRequest{
		ImageName: "go",
		Tag:       "1.24.13",
		ImageTags: []string{"1.24", "latest"},
	})
	require.NoError(t, err)
	require.Equal(t, "job-1", response.JobID)
}
