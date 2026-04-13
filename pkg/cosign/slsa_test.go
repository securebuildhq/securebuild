package cosign

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	slsav1 "github.com/in-toto/in-toto-golang/in_toto/slsa_provenance/v1"
)

func TestBuildSLSAProvenancePredicate(t *testing.T) {
	startedOn := time.Date(2025, 1, 15, 10, 0, 0, 0, time.UTC)
	finishedOn := time.Date(2025, 1, 15, 10, 5, 0, 0, time.UTC)

	input := SLSAProvenanceInput{
		BuildID:    "abc123",
		BuilderID:  "vm-456",
		StartedOn:  &startedOn,
		FinishedOn: &finishedOn,
		ApkoYAML:   "packages:\n  - zlib\n",
		Tags:       []string{"v1.16.2", "latest"},
	}

	predicate := BuildSLSAProvenancePredicate(input)

	// Verify buildType
	if predicate.BuildDefinition.BuildType != SecureBuildBuildType {
		t.Fatalf("expected buildType %q, got %q", SecureBuildBuildType, predicate.BuildDefinition.BuildType)
	}

	// Verify builder ID
	if predicate.RunDetails.Builder.ID != SecureBuildBuilderID {
		t.Fatalf("expected builder.id %q, got %q", SecureBuildBuilderID, predicate.RunDetails.Builder.ID)
	}

	// Verify invocation ID
	if predicate.RunDetails.BuildMetadata.InvocationID != "abc123" {
		t.Fatalf("expected invocationId %q, got %q", "abc123", predicate.RunDetails.BuildMetadata.InvocationID)
	}

	// Verify timestamps
	if predicate.RunDetails.BuildMetadata.StartedOn == nil || !predicate.RunDetails.BuildMetadata.StartedOn.Equal(startedOn) {
		t.Fatalf("unexpected startedOn: %v", predicate.RunDetails.BuildMetadata.StartedOn)
	}
	if predicate.RunDetails.BuildMetadata.FinishedOn == nil || !predicate.RunDetails.BuildMetadata.FinishedOn.Equal(finishedOn) {
		t.Fatalf("unexpected finishedOn: %v", predicate.RunDetails.BuildMetadata.FinishedOn)
	}

	// Verify APKO config digest
	expectedDigest := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte("packages:\n  - zlib\n")))
	extParams, ok := predicate.BuildDefinition.ExternalParameters.(SecureBuildSourceParameters)
	if !ok {
		t.Fatalf("expected ExternalParameters to be SecureBuildSourceParameters")
	}
	if extParams.ApkoConfigDigest != expectedDigest {
		t.Fatalf("expected apkoConfigDigest %q, got %q", expectedDigest, extParams.ApkoConfigDigest)
	}

	// Verify tags
	if len(extParams.Tags) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(extParams.Tags))
	}

	// Verify JSON serialization round-trips
	data, err := json.Marshal(predicate)
	if err != nil {
		t.Fatalf("failed to marshal predicate: %v", err)
	}
	var roundTripped slsav1.ProvenancePredicate
	if err := json.Unmarshal(data, &roundTripped); err != nil {
		t.Fatalf("failed to unmarshal predicate: %v", err)
	}
	if roundTripped.BuildDefinition.BuildType != SecureBuildBuildType {
		t.Fatalf("round-trip lost buildType")
	}
}

func TestBuildSLSAProvenancePredicate_NilTimestamps(t *testing.T) {
	input := SLSAProvenanceInput{
		BuildID:   "def456",
		BuilderID: "vm-789",
		ApkoYAML:  "packages:\n  - curl\n",
		Tags:      []string{"v1.0.0"},
	}

	predicate := BuildSLSAProvenancePredicate(input)

	if predicate.RunDetails.BuildMetadata.StartedOn != nil {
		t.Fatalf("expected nil startedOn, got %v", predicate.RunDetails.BuildMetadata.StartedOn)
	}
	if predicate.RunDetails.BuildMetadata.FinishedOn != nil {
		t.Fatalf("expected nil finishedOn, got %v", predicate.RunDetails.BuildMetadata.FinishedOn)
	}

	// Verify omitempty works in JSON
	data, err := json.Marshal(predicate)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}
	var raw map[string]interface{}
	json.Unmarshal(data, &raw)
	runDetails := raw["runDetails"].(map[string]interface{})
	metadata := runDetails["metadata"].(map[string]interface{})
	if _, exists := metadata["startedOn"]; exists {
		t.Fatalf("expected startedOn to be omitted from JSON when nil")
	}
	if _, exists := metadata["finishedOn"]; exists {
		t.Fatalf("expected finishedOn to be omitted from JSON when nil")
	}
}
