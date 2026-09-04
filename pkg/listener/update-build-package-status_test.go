package listener

import "testing"

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
