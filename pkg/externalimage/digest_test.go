package externalimage

import (
	"testing"

	"github.com/google/go-containerregistry/pkg/v1"
	"github.com/stretchr/testify/assert"
)

func TestSupportedIndexArchitectures(t *testing.T) {
	manifest := &v1.IndexManifest{Manifests: []v1.Descriptor{
		{Platform: &v1.Platform{OS: "linux", Architecture: "arm64", Variant: "v8"}},
		{Platform: &v1.Platform{OS: "linux", Architecture: "amd64"}},
		{Platform: &v1.Platform{OS: "linux", Architecture: "arm64", Variant: "v9"}},
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
