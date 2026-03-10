package security

import (
	"reflect"
	"testing"
)

func TestVersionMatchesPackage(t *testing.T) {
	tests := []struct {
		name        string
		versions    []string
		packageName string
		want        []string
	}{
		{
			name:        "openssl - accept all versions, single -r0 versions with leading non-r0",
			versions:    []string{"1.1.1x-r1", "3.0.13-r0", "3.1.5-r0", "9.1.1551-r0", "1.3.1-r2"},
			packageName: "openssl",
			want:        []string{"1.1.1x-r1", "1.3.1-r2"},
		},
		{
			name:        "redis-8 - accept 8.* only, multiple consecutive -r0 with leading -r0",
			versions:    []string{"6.2.20-r0", "7.2.11-r0", "7.4.6-r0", "8.0.4-r0", "8.2.2-r0", "8.2.3-r0", "8.2.4-r1", "8.2.5-r0", "9.0.1-r0"},
			packageName: "redis-8",
			want:        []string{"8.0.4-r0", "8.2.4-r1"},
		},
		{
			name:        "redis-7.4 - accept 7.4.* only, multiple consecutive -r0 with leading non-r0",
			versions:    []string{"6.2.20-r0", "7.2.11-r0", "7.4.6-r1", "7.4.7-r0", "7.4.8-r0", "7.4.9-r3", "7.4.10-r0", "8.0.4-r0", "8.2.2-r0"},
			packageName: "redis-7.4",
			want:        []string{"7.4.6-r1", "7.4.9-r3"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := filterVersions(tt.versions, tt.packageName)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("filterVersions(%q, %q) = %v, want %v",
					tt.versions, tt.packageName, got, tt.want)
			}
		})
	}
}
