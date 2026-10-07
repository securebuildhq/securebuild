package listener

import (
	"context"
	"testing"
	"time"

	externalimagetypes "github.com/securebuildhq/securebuild/pkg/externalimage/types"
	listenertypes "github.com/securebuildhq/securebuild/pkg/listener/types"
	"github.com/stretchr/testify/require"
)

func TestResolveExternalImageArchitecturesReturnsContextCancellation(t *testing.T) {
	tests := []struct {
		name    string
		context func() context.Context
		want    error
	}{
		{
			name: "canceled",
			context: func() context.Context {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				return ctx
			},
			want: context.Canceled,
		},
		{
			name: "deadline exceeded",
			context: func() context.Context {
				ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
				t.Cleanup(cancel)
				return ctx
			},
			want: context.DeadlineExceeded,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := resolveExternalImageArchitectures(
				tt.context(),
				listenertypes.ExternalImageSbomPayload{},
				&externalimagetypes.ExternalImage{},
			)
			require.ErrorIs(t, err, tt.want)
			require.Equal(t, tt.want, err)
		})
	}
}

func TestValidateSBOMWorkArchitecture(t *testing.T) {
	externalImage := &externalimagetypes.ExternalImage{}

	t.Run("verified work does not resolve the registry again", func(t *testing.T) {
		resolverCalled := false
		ctx := WithMockResolveExternalImageArchitectures(context.Background(),
			func(context.Context, listenertypes.ExternalImageSbomPayload, *externalimagetypes.ExternalImage) ([]string, error) {
				resolverCalled = true
				return nil, nil
			})

		architectures, valid, err := validateSBOMWorkArchitecture(ctx, listenertypes.ExternalImageSbomPayload{
			Arch:                 "aarch64",
			ArchitectureVerified: true,
		}, externalImage)
		require.NoError(t, err)
		require.True(t, valid)
		require.Nil(t, architectures)
		require.False(t, resolverCalled)
	})

	t.Run("legacy work is accepted only for a discovered architecture", func(t *testing.T) {
		ctx := WithMockResolveExternalImageArchitectures(context.Background(),
			func(context.Context, listenertypes.ExternalImageSbomPayload, *externalimagetypes.ExternalImage) ([]string, error) {
				return []string{"x86_64"}, nil
			})

		architectures, valid, err := validateSBOMWorkArchitecture(ctx, listenertypes.ExternalImageSbomPayload{
			Arch: "aarch64",
		}, externalImage)
		require.NoError(t, err)
		require.False(t, valid)
		require.Equal(t, []string{"x86_64"}, architectures)

		_, valid, err = validateSBOMWorkArchitecture(ctx, listenertypes.ExternalImageSbomPayload{
			Arch: "x86_64",
		}, externalImage)
		require.NoError(t, err)
		require.True(t, valid)
	})
}
