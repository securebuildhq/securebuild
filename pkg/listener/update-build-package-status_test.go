package listener

import (
	"testing"
	"time"
)

func TestPackageExecutionReadyForSuccess(t *testing.T) {
	tests := []struct {
		name            string
		x86Assigned     bool
		x86Status       string
		x86Indexed      bool
		aarch64Assigned bool
		aarch64Status   string
		aarch64Indexed  bool
		want            bool
	}{
		{
			name:            "both architectures built and indexed",
			x86Assigned:     true,
			x86Status:       "success",
			x86Indexed:      true,
			aarch64Assigned: true,
			aarch64Status:   "success",
			aarch64Indexed:  true,
			want:            true,
		},
		{
			name:            "both builds complete but neither indexed",
			x86Assigned:     true,
			x86Status:       "success",
			aarch64Assigned: true,
			aarch64Status:   "success",
			want:            false,
		},
		{
			name:            "only x86 index is ready",
			x86Assigned:     true,
			x86Status:       "success",
			x86Indexed:      true,
			aarch64Assigned: true,
			aarch64Status:   "success",
			want:            false,
		},
		{
			name:            "index cannot compensate for unfinished build",
			x86Assigned:     true,
			x86Status:       "publishing",
			x86Indexed:      true,
			aarch64Assigned: true,
			aarch64Status:   "success",
			aarch64Indexed:  true,
			want:            false,
		},
		{
			name:            "single assigned architecture is ready",
			x86Assigned:     true,
			x86Status:       "success",
			x86Indexed:      true,
			aarch64Assigned: false,
			want:            true,
		},
		{
			name:            "single assigned architecture is not indexed",
			x86Assigned:     false,
			aarch64Assigned: true,
			aarch64Status:   "success",
			aarch64Indexed:  false,
			want:            false,
		},
		{
			name: "no assigned architecture",
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := packageExecutionReadyForSuccess(
				tt.x86Assigned, tt.x86Status, tt.x86Indexed,
				tt.aarch64Assigned, tt.aarch64Status, tt.aarch64Indexed,
			)
			if got != tt.want {
				t.Fatalf("packageExecutionReadyForSuccess() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestRepositoryPublicationTimedOut(t *testing.T) {
	now := time.Date(2026, time.September, 4, 12, 0, 0, 0, time.UTC)
	beforeTimeout := now.Add(-DefaultPublishingTimeout + time.Second)
	afterTimeout := now.Add(-DefaultPublishingTimeout - time.Second)
	indexedAt := now.Add(-time.Minute)

	tests := []struct {
		name            string
		statusUpdatedAt *time.Time
		indexedAt       *time.Time
		want            bool
	}{
		{name: "missing status timestamp", want: false},
		{name: "still within timeout", statusUpdatedAt: &beforeTimeout, want: false},
		{name: "publication timed out", statusUpdatedAt: &afterTimeout, want: true},
		{name: "indexed execution never times out", statusUpdatedAt: &afterTimeout, indexedAt: &indexedAt, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := repositoryPublicationTimedOut(now, tt.statusUpdatedAt, tt.indexedAt)
			if got != tt.want {
				t.Fatalf("repositoryPublicationTimedOut() = %v, want %v", got, tt.want)
			}
		})
	}
}
