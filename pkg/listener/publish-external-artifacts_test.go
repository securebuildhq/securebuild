package listener

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	imagetypes "github.com/securebuildhq/securebuild/pkg/image/types"
	"github.com/securebuildhq/securebuild/pkg/oci"
	"github.com/securebuildhq/securebuild/pkg/param"
)

func TestReadExternalRegistryPushResults(t *testing.T) {
	path := filepath.Join(t.TempDir(), "external-registry-results.json")
	data := `[{"registry_id":"ier_1","registry_url":"registry.example.com/team/image","tag":"1.2.3","success":true}]`
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatal(err)
	}
	results, err := readExternalRegistryPushResults(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || !results[0].Success || results[0].RegistryID != "ier_1" || results[0].Tag != "1.2.3" {
		t.Fatalf("unexpected results: %#v", results)
	}
}

func TestExternalRepositoryStripsProtocol(t *testing.T) {
	repo, err := externalRepository("https://registry.example.com/team/image/")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := repo.Name(), "registry.example.com/team/image"; got != want {
		t.Fatalf("repository = %q, want %q", got, want)
	}
}

func TestUniqueLayers(t *testing.T) {
	layers := []oci.Descriptor{
		{Digest: "sha256:1", Annotations: map[string]string{"dev.cosignproject.cosign/predicateType": "spdx"}},
		{Digest: "sha256:1", Annotations: map[string]string{"dev.cosignproject.cosign/predicateType": "spdx"}},
		{Digest: "sha256:2", Annotations: map[string]string{"dev.cosignproject.cosign/predicateType": "slsa"}},
	}
	got := uniqueLayers(layers)
	if want := []oci.Descriptor{layers[0], layers[2]}; !reflect.DeepEqual(got, want) {
		t.Fatalf("uniqueLayers() = %#v, want %#v", got, want)
	}
}

func TestVerifyExternalArtifactsRunsAllCosignChecks(t *testing.T) {
	original := verifyExternalReference
	t.Cleanup(func() { verifyExternalReference = original })
	var gotRef string
	verifyExternalReference = func(_ context.Context, digestRef string, _ imagetypes.ImageExternalRegistry) error {
		gotRef = digestRef
		return nil
	}

	ctx := param.WithParam(context.Background(), &param.Param{OIDCGCPAttestorAccount: "attestor@example.com"})
	if err := verifyExternalArtifacts(ctx, "registry.example.com/team/image@sha256:abc", imagetypes.ImageExternalRegistry{}); err != nil {
		t.Fatal(err)
	}
	if gotRef != "registry.example.com/team/image@sha256:abc" {
		t.Fatalf("verified reference = %q", gotRef)
	}
}
