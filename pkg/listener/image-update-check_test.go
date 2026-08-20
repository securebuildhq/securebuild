package listener

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDeduplicateImageTags(t *testing.T) {
	tags := deduplicateImageTags([]string{"1.2.3", "1.2", "latest", "1.2.3", "latest"})
	assert.Equal(t, []string{"1.2.3", "1.2", "latest"}, tags)
}

func TestHasNewImageTags(t *testing.T) {
	tests := []struct {
		name      string
		existing  []string
		requested []string
		want      bool
	}{
		{
			name:      "new alias requires build",
			existing:  []string{"1.2.3"},
			requested: []string{"1.2.3", "latest"},
			want:      true,
		},
		{
			name:      "same aliases in different order can reuse build",
			existing:  []string{"latest", "1.2.3"},
			requested: []string{"1.2.3", "latest"},
			want:      false,
		},
		{
			name:      "removing alias does not require build",
			existing:  []string{"1.2.3", "latest"},
			requested: []string{"1.2.3"},
			want:      false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, hasNewImageTags(tt.existing, tt.requested))
		})
	}
}

func TestIsReusableImageBuildStatus(t *testing.T) {
	tests := []struct {
		status string
		want   bool
	}{
		{status: "pending", want: false},
		{status: "queued", want: true},
		{status: "building", want: true},
		{status: "testing", want: true},
		{status: "publishing", want: true},
		{status: "success", want: true},
		{status: "failed", want: false},
		{status: "timed_out", want: false},
		{status: "unknown", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			assert.Equal(t, tt.want, isReusableImageBuildStatus(tt.status))
		})
	}
}
