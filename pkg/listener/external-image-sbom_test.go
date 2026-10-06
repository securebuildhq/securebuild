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
