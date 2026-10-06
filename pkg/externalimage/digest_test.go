package externalimage

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/google/go-containerregistry/pkg/v1"
	"github.com/google/go-containerregistry/pkg/v1/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetImageDescriptorPreservesSchema1DigestWithoutGuessingArchitecture(t *testing.T) {
	const (
		imageName = "legacy/image"
		tag       = "latest"
		digest    = "sha256:0000000000000000000000000000000000000000000000000000000000000000"
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/":
			w.WriteHeader(http.StatusOK)
		case fmt.Sprintf("/v2/%s/manifests/%s", imageName, tag):
			w.Header().Set("Content-Type", string(types.DockerManifestSchema1Signed))
			w.Header().Set("Docker-Content-Digest", digest)
			_, _ = w.Write([]byte("schema1 manifest contents are not parsed"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	registryURL, err := url.Parse(server.URL)
	require.NoError(t, err)

	descriptor, err := GetImageDescriptor(t.Context(), registryURL.Host, imageName, tag, "", "")
	require.NoError(t, err)
	assert.Equal(t, digest, descriptor.Digest)
	assert.Empty(t, descriptor.Architectures)
}

func TestSupportedIndexArchitecturesUsesSecureBuildArchitectureFamilies(t *testing.T) {
	manifest := &v1.IndexManifest{Manifests: []v1.Descriptor{
		// SecureBuild tracks architecture, not OCI variants. Both arm64
		// descriptors map to the single aarch64 status and queue identity.
		{Platform: &v1.Platform{OS: "linux", Architecture: "arm64", Variant: "v8"}},
		{Platform: &v1.Platform{OS: "linux", Architecture: "amd64"}},
		{Platform: &v1.Platform{OS: "linux", Architecture: "arm64", Variant: "v9"}},
		// 32-bit ARM variants and unsupported architectures are not aarch64.
		{Platform: &v1.Platform{OS: "linux", Architecture: "arm", Variant: "v6"}},
		{Platform: &v1.Platform{OS: "linux", Architecture: "arm", Variant: "v7"}},
		{Platform: &v1.Platform{OS: "linux", Architecture: "s390x"}},
		{Platform: &v1.Platform{OS: "windows", Architecture: "amd64"}},
		{Platform: nil},
	}}

	assert.Equal(t, []string{"x86_64", "aarch64"}, supportedIndexArchitectures(manifest))
}

func TestSupportedArchitecture(t *testing.T) {
	tests := []struct {
		os           string
		architecture string
		want         string
		ok           bool
	}{
		{os: "linux", architecture: "amd64", want: "x86_64", ok: true},
		{os: "linux", architecture: "arm64", want: "aarch64", ok: true},
		{os: "linux", architecture: "s390x"},
		{os: "windows", architecture: "amd64"},
	}

	for _, tt := range tests {
		got, ok := supportedArchitecture(tt.os, tt.architecture)
		assert.Equal(t, tt.want, got)
		assert.Equal(t, tt.ok, ok)
	}
}

func TestSupportedIndexArchitecturesAllowsUnsupportedOnlyImages(t *testing.T) {
	manifest := &v1.IndexManifest{Manifests: []v1.Descriptor{
		{Platform: &v1.Platform{OS: "linux", Architecture: "arm", Variant: "v7"}},
		{Platform: &v1.Platform{OS: "linux", Architecture: "ppc64le"}},
		{Platform: &v1.Platform{OS: "windows", Architecture: "amd64"}},
	}}

	assert.Empty(t, supportedIndexArchitectures(manifest))
}
