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
		StartedOn:  &startedOn,
		FinishedOn: &finishedOn,
		ApkoYAML:   "packages:\n  - zlib\n",
		Tags:       []string{"v1.16.2", "latest"},
	}

	data, err := BuildSLSAProvenancePredicate(input)
	if err != nil {
		t.Fatalf("BuildSLSAProvenancePredicate returned error: %v", err)
	}

	// Parse as generic JSON to verify structure
	var predicate map[string]interface{}
	if err := json.Unmarshal(data, &predicate); err != nil {
		t.Fatalf("failed to unmarshal predicate JSON: %v", err)
	}

	// Verify buildType
	buildDef := predicate["buildDefinition"].(map[string]interface{})
	if buildDef["buildType"] != SecureBuildBuildType {
		t.Fatalf("expected buildType %q, got %q", SecureBuildBuildType, buildDef["buildType"])
	}

	// Verify builder ID
	runDetails := predicate["runDetails"].(map[string]interface{})
	builder := runDetails["builder"].(map[string]interface{})
	if builder["id"] != SecureBuildBuilderID {
		t.Fatalf("expected builder.id %q, got %q", SecureBuildBuilderID, builder["id"])
	}

	// Verify invocation ID
	metadata := runDetails["metadata"].(map[string]interface{})
	if metadata["invocationId"] != "abc123" {
		t.Fatalf("expected invocationId %q, got %q", "abc123", metadata["invocationId"])
	}

	// Verify timestamps exist
	if _, ok := metadata["startedOn"]; !ok {
		t.Fatal("expected startedOn to be present")
	}
	if _, ok := metadata["finishedOn"]; !ok {
		t.Fatal("expected finishedOn to be present")
	}

	// Verify APKO config digest in external parameters
	extParams := buildDef["externalParameters"].(map[string]interface{})
	source := extParams["source"].(map[string]interface{})
	expectedDigest := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte("packages:\n  - zlib\n")))
	if source["apkoConfigDigest"] != expectedDigest {
		t.Fatalf("expected apkoConfigDigest %q, got %q", expectedDigest, source["apkoConfigDigest"])
	}

	// Verify tags
	tags := source["tags"].([]interface{})
	if len(tags) != 2 {
		t.Fatalf("expected 2 tags, got %d", len(tags))
	}
}

func TestBuildSLSAProvenancePredicate_NilTimestamps(t *testing.T) {
	input := SLSAProvenanceInput{
		BuildID:  "def456",
		ApkoYAML: "packages:\n  - curl\n",
		Tags:     []string{"v1.0.0"},
	}

	data, err := BuildSLSAProvenancePredicate(input)
	if err != nil {
		t.Fatalf("BuildSLSAProvenancePredicate returned error: %v", err)
	}

	var predicate map[string]interface{}
	if err := json.Unmarshal(data, &predicate); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	runDetails := predicate["runDetails"].(map[string]interface{})
	metadata := runDetails["metadata"].(map[string]interface{})

	if _, exists := metadata["startedOn"]; exists {
		t.Fatal("expected startedOn to be omitted from JSON when nil")
	}
	if _, exists := metadata["finishedOn"]; exists {
		t.Fatal("expected finishedOn to be omitted from JSON when nil")
	}
}
