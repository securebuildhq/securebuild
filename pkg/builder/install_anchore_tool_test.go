package builder

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuilderArchitectureToGoArch(t *testing.T) {
	tests := map[string]string{
		"x86_64":  "amd64",
		"amd64":   "amd64",
		"aarch64": "arm64",
		"arm64":   "arm64",
	}
	for input, want := range tests {
		t.Run(input, func(t *testing.T) {
			got, err := builderArchitectureToGoArch(input)
			require.NoError(t, err)
			assert.Equal(t, want, got)
		})
	}

	_, err := builderArchitectureToGoArch("s390x")
	require.ErrorContains(t, err, "unsupported")
}
