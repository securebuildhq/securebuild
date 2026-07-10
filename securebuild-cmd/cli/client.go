package cli

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

type Client struct {
	endpoint   string
	token      string
	httpClient *http.Client
}

func NewClient(endpoint, token string, debug bool) *Client {
	transport := http.DefaultTransport
	if debug {
		transport = &debugTransport{base: http.DefaultTransport}
	}
	return &Client{
		endpoint:   endpoint,
		token:      token,
		httpClient: &http.Client{Transport: transport},
	}
}

type TriggerRequest struct {
	PackageFamilyName string `json:"package_family_name"`
	Tag               string `json:"tag"`
}

type TriggerResponse struct {
	JobID string `json:"job_id"`
}

type JobStatusResponse struct {
	Status           string `json:"status"`
	Error            string `json:"error,omitempty"`
	PackageVersionID string `json:"package_version_id,omitempty"`
}

type PackageVersionResponse struct {
	Status        string `json:"status"`
	Version       string `json:"version"`
	PackageName   string `json:"package_name"`
	APKRelease    int    `json:"apk_release"`
	X8664Status   string `json:"x86_64_status,omitempty"`
	Aarch64Status string `json:"aarch64_status,omitempty"`
}

func (c *Client) setHeaders(req *http.Request) {
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)
}

type debugTransport struct {
	base http.RoundTripper
}

func (t *debugTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	t.logRequest(req)

	resp, err := t.base.RoundTrip(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[debug] error: %v\n", err)
		return nil, err
	}

	t.logResponse(resp)
	return resp, nil
}

func (t *debugTransport) logRequest(req *http.Request) {
	fmt.Fprintf(os.Stderr, "[debug] >>> %s %s\n", req.Method, req.URL.String())
	for key, vals := range req.Header {
		for _, val := range vals {
			if strings.EqualFold(key, "Authorization") {
				val = redactToken(val)
			}
			fmt.Fprintf(os.Stderr, "[debug] >>> %s: %s\n", key, val)
		}
	}
	if req.Body != nil {
		body, _ := io.ReadAll(req.Body)
		req.Body = io.NopCloser(bytes.NewReader(body))
		if isTextContentType(req.Header.Get("Content-Type")) {
			fmt.Fprintf(os.Stderr, "[debug] >>> body: %s\n", string(body))
		} else if len(body) > 0 {
			fmt.Fprintf(os.Stderr, "[debug] >>> body: (%d bytes)\n", len(body))
		}
	}
}

func (t *debugTransport) logResponse(resp *http.Response) {
	fmt.Fprintf(os.Stderr, "[debug] <<< %d %s\n", resp.StatusCode, resp.Status)
	for key, vals := range resp.Header {
		for _, val := range vals {
			fmt.Fprintf(os.Stderr, "[debug] <<< %s: %s\n", key, val)
		}
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body = io.NopCloser(bytes.NewReader(body))
	if isTextContentType(resp.Header.Get("Content-Type")) {
		if len(body) > 0 {
			fmt.Fprintf(os.Stderr, "[debug] <<< body: %s\n", string(body))
		}
	} else if len(body) > 0 {
		fmt.Fprintf(os.Stderr, "[debug] <<< body: (%d bytes)\n", len(body))
	}
}

func redactToken(val string) string {
	const prefix = "Bearer "
	if strings.HasPrefix(val, prefix) {
		token := val[len(prefix):]
		if len(token) > 8 {
			return prefix + token[:4] + "..." + token[len(token)-4:]
		}
		return prefix + "[redacted]"
	}
	return "[redacted]"
}

func isTextContentType(ct string) bool {
	return strings.Contains(ct, "json") || strings.Contains(ct, "text") || strings.Contains(ct, "xml") || strings.Contains(ct, "html")
}

func (c *Client) Trigger(ctx context.Context, req TriggerRequest) (*TriggerResponse, error) {
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.endpoint+"/api/v1/package-update", bytes.NewBuffer(body))
	if err != nil {
		return nil, err
	}
	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusAccepted {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API returned status %d: %s", resp.StatusCode, string(respBody))
	}

	var result TriggerResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) GetJobStatus(ctx context.Context, jobID string) (*JobStatusResponse, error) {
	httpReq, err := http.NewRequestWithContext(ctx, "GET", c.endpoint+"/api/v1/job/"+jobID+"/status", nil)
	if err != nil {
		return nil, err
	}
	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return &JobStatusResponse{Status: "expired"}, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var result JobStatusResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) GetPackageVersion(ctx context.Context, id string) (*PackageVersionResponse, error) {
	httpReq, err := http.NewRequestWithContext(ctx, "GET", c.endpoint+"/api/v1/package-version/"+id, nil)
	if err != nil {
		return nil, err
	}
	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return &PackageVersionResponse{Status: "not_found"}, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var result PackageVersionResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) CheckAPKAvailable(ctx context.Context, apkURL string) (bool, error) {
	httpReq, err := http.NewRequestWithContext(ctx, "HEAD", apkURL, nil)
	if err != nil {
		return false, err
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK, nil
}

func (c *Client) CheckAPKInIndex(ctx context.Context, apkRepository, arch, packageName, version string, release int) (bool, error) {
	indexURL := fmt.Sprintf("%s/%s/APKINDEX.tar.gz", apkRepository, arch)

	httpReq, err := http.NewRequestWithContext(ctx, "GET", indexURL, nil)
	if err != nil {
		return false, err
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, nil
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, err
	}

	gzReader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return false, err
	}
	defer gzReader.Close()

	tarReader := tar.NewReader(gzReader)
	var indexContent []byte
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return false, err
		}
		if header.Name == "APKINDEX" {
			indexContent, err = io.ReadAll(tarReader)
			if err != nil {
				return false, err
			}
			break
		}
	}

	if indexContent == nil {
		return false, nil
	}

	targetVersion := fmt.Sprintf("%s-r%d", version, release)
	blocks := bytes.Split(indexContent, []byte("\n\n"))
	for _, block := range blocks {
		lines := bytes.Split(block, []byte("\n"))
		foundP := false
		foundV := false
		for _, line := range lines {
			parts := bytes.SplitN(line, []byte(":"), 2)
			if len(parts) != 2 {
				continue
			}
			key := string(parts[0])
			val := string(parts[1])
			if key == "P" && val == packageName {
				foundP = true
			}
			if key == "V" && val == targetVersion {
				foundV = true
			}
		}
		if foundP && foundV {
			return true, nil
		}
	}

	return false, nil
}
