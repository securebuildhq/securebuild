package cli

import (
	"context"
	"testing"
)

func TestPushToExternalRegistriesReportsEveryDestinationWhenLayoutIsInvalid(t *testing.T) {
	config := &ImageBuildConfig{
		WorkDir: t.TempDir(),
		Tags:    []string{"1.0", "latest"},
		ExternalRegistries: []ExternalRegistryConfig{
			{ID: "ier_1", RegistryURL: "registry.example.com/one"},
			{ID: "ier_2", RegistryURL: "registry.example.com/two"},
		},
	}

	results := pushToExternalRegistries(context.Background(), config)
	if got, want := len(results), 4; got != want {
		t.Fatalf("results = %d, want %d: %#v", got, want, results)
	}
	seen := map[string]bool{}
	for _, result := range results {
		if result.Success || result.Error == "" {
			t.Fatalf("expected failed result with error: %#v", result)
		}
		seen[result.RegistryID+"/"+result.Tag] = true
	}
	for _, key := range []string{"ier_1/1.0", "ier_1/latest", "ier_2/1.0", "ier_2/latest"} {
		if !seen[key] {
			t.Errorf("missing result %s", key)
		}
	}
}
