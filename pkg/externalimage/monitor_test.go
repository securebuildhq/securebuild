package externalimage

import (
	"context"
	"regexp"
	"testing"
)

func TestGetImageDigest(t *testing.T) {
	tests := []struct {
		name      string
		registry  string
		imageName string
		tag       string
		want      string
		wantErr   bool
	}{
		{
			name:      "bash",
			registry:  "index.docker.io",
			imageName: "bash",
			tag:       "latest",
			want:      `^sha256:[a-f0-9]{64}$`,
			wantErr:   false,
		},
		{
			name:      "nginx with defined index sha",
			registry:  "index.docker.io",
			imageName: "repldev/test-images",
			tag:       "nginx-1.24.0",
			// this is the index digest for repldev/testimages:nginx-1.24.0, see https://hub.docker.com/repository/docker/repldev/test-images/tags/nginx-1.24.0
			// the index digest is the most inclusive digest, and is also the digest reported for running images by the replicated SDK
			want:    `^sha256:f6daac2445b0ce70e64d77442ccf62839f3f1b4c24bf6746a857eff014e798c8$`,
			wantErr: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := GetImageDigest(context.Background(), tt.registry, tt.imageName, tt.tag, "", "")
			if (err != nil) != tt.wantErr {
				t.Errorf("GetImageDigest() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			// Use regex matching instead of exact string comparison
			matched, regexErr := regexp.MatchString(tt.want, got)
			if regexErr != nil {
				t.Errorf("GetImageDigest() regex error = %v", regexErr)
				return
			}
			if !matched {
				t.Errorf("GetImageDigest() = %v, want pattern %v", got, tt.want)
			}
		})
	}
}
