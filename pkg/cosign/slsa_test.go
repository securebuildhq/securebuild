package cosign

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"testing"
	"time"
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
	if predicate.RunDetails.Metadata.InvocationID != "abc123" {
		t.Fatalf("expected invocationId %q, got %q", "abc123", predicate.RunDetails.Metadata.InvocationID)
	}

	// Verify timestamps
	if predicate.RunDetails.Metadata.StartedOn == nil || *predicate.RunDetails.Metadata.StartedOn != "2025-01-15T10:00:00Z" {
		t.Fatalf("unexpected startedOn: %v", predicate.RunDetails.Metadata.StartedOn)
	}
	if predicate.RunDetails.Metadata.FinishedOn == nil || *predicate.RunDetails.Metadata.FinishedOn != "2025-01-15T10:05:00Z" {
		t.Fatalf("unexpected finishedOn: %v", predicate.RunDetails.Metadata.FinishedOn)
	}

	// Verify APKO config digest
	expectedDigest := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte("packages:\n  - zlib\n")))
	if predicate.BuildDefinition.ExternalParameters.Source.ApkoConfigDigest != expectedDigest {
		t.Fatalf("expected apkoConfigDigest %q, got %q", expectedDigest, predicate.BuildDefinition.ExternalParameters.Source.ApkoConfigDigest)
	}

	// Verify tags
	if len(predicate.BuildDefinition.ExternalParameters.Source.Tags) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(predicate.BuildDefinition.ExternalParameters.Source.Tags))
	}

	// Verify JSON serialization round-trips
	data, err := json.Marshal(predicate)
	if err != nil {
		t.Fatalf("failed to marshal predicate: %v", err)
	}
	var roundTripped SLSAProvenancePredicate
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

	if predicate.RunDetails.Metadata.StartedOn != nil {
		t.Fatalf("expected nil startedOn, got %v", predicate.RunDetails.Metadata.StartedOn)
	}
	if predicate.RunDetails.Metadata.FinishedOn != nil {
		t.Fatalf("expected nil finishedOn, got %v", predicate.RunDetails.Metadata.FinishedOn)
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
