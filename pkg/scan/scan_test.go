package scan

import "testing"

func Test_getRegistryHostname(t *testing.T) {
	tests := []struct {
		name     string
		imageURL string
		want     string
	}{
		{
			name:     "test",
			imageURL: "registry.replicated.com/library/alpine:latest",
			want:     "registry.replicated.com",
		},
		{
			name:     "dockerhub",
			imageURL: "index.docker.io/library/alpine:latest",
			want:     "index.docker.io",
		},
		{
			name:     "bash:latest",
			imageURL: "bash:latest",
			want:     "index.docker.io",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := getRegistryHostname(tt.imageURL)
			if err != nil {
				t.Errorf("getRegistryHostname() error = %v", err)
				return
			}

			if got != tt.want {
				t.Errorf("getRegistryHostname() = %v, want %v", got, tt.want)
			}
		})
	}
}
