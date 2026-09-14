package buildpriority

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestOrder(t *testing.T) {
	tests := []struct {
		name  string
		items []Candidate
		want  []string
	}{
		{
			name: "numeric upstream versions before queue age",
			items: []Candidate{
				{ID: "old", Family: "go", Versions: []string{"1.9.9"}},
				{ID: "middle", Family: "go", Versions: []string{"1.25.9"}},
				{ID: "new", Family: "go", Versions: []string{"1.26.0"}},
			},
			want: []string{"new", "middle", "old"},
		},
		{
			name: "rank within families rather than compare unrelated versions",
			items: []Candidate{
				{ID: "go-old", Family: "go", Versions: []string{"1.25.0"}},
				{ID: "go-new", Family: "go", Versions: []string{"1.26.0"}},
				{ID: "postgres-old", Family: "postgres", Versions: []string{"17.0"}},
				{ID: "postgres-new", Family: "postgres", Versions: []string{"18.0"}},
			},
			want: []string{"go-new", "postgres-new", "go-old", "postgres-old"},
		},
		{
			name: "manual priority overrides version rank",
			items: []Candidate{
				{ID: "old", Family: "go", Versions: []string{"1.25.0"}, Priority: 1},
				{ID: "new", Family: "go", Versions: []string{"1.26.0"}},
			},
			want: []string{"old", "new"},
		},
		{
			name: "aliases, prereleases, and duplicate versions",
			items: []Candidate{
				{ID: "rc", Family: "image", Versions: []string{"v1.26.0-rc.1"}},
				{ID: "stable-first", Family: "image", Versions: []string{"latest", "1", "1.26", "1.26.0"}},
				{ID: "stable-second", Family: "image", Versions: []string{"v1.26.0"}},
			},
			want: []string{"stable-first", "stable-second", "rc"},
		},
		{
			name: "unknown metadata preserves FIFO and remains runnable",
			items: []Candidate{
				{ID: "deleted"},
				{ID: "rolling", Family: "image", Versions: []string{"latest", "nightly"}},
				{ID: "versioned", Family: "other", Versions: []string{"2.0.0"}},
			},
			want: []string{"deleted", "rolling", "versioned"},
		},
		{
			name: "latest package version ignores insertion order",
			items: []Candidate{
				{ID: "old", Family: "family", Versions: []string{"1.9.0"}},
				{ID: "new", Family: "family", Versions: []string{"1.10.0", "1.8.0", "1.9.0"}},
			},
			want: []string{"new", "old"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for i := range tt.items {
				tt.items[i].CreatedAt = time.Unix(int64(i), 0)
			}
			require.Equal(t, tt.want, Order(tt.items))
		})
	}
}

func TestOrderDeterministicTies(t *testing.T) {
	require.Equal(t, []string{"a", "b"}, Order([]Candidate{{ID: "b"}, {ID: "a"}}))
	require.Empty(t, Order(nil))
}
