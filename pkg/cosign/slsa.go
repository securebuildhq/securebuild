package cosign

import (
	"crypto/sha256"
	"fmt"
	"time"

	provenance "github.com/in-toto/attestation/go/predicates/provenance/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// PredicateSLSAProvenance is the predicateType URI for SLSA v1.0 provenance.
const PredicateSLSAProvenance = "https://slsa.dev/provenance/v1"

// SecureBuildBuildType is the buildType URI for SecureBuild image rebuilds.
const SecureBuildBuildType = "https://securebuild.com/provenance/image-rebuild/v1"

// SecureBuildBuilderID is the builder.id for SecureBuild GCP VM builds.
const SecureBuildBuilderID = "https://securebuild.com/builder/gcp-vm/v1"

// SLSAProvenanceInput holds the metadata needed to build a SLSA provenance predicate.
type SLSAProvenanceInput struct {
	BuildID    string
	BuilderID  string
	StartedOn  *time.Time
	FinishedOn *time.Time
	ApkoYAML   string
	Tags       []string
}

// BuildSLSAProvenancePredicate constructs a SLSA v1.0 provenance predicate
// and returns it as JSON bytes. Uses the official protobuf-generated types
// from github.com/in-toto/attestation.
func BuildSLSAProvenancePredicate(input SLSAProvenanceInput) ([]byte, error) {
	apkoDigest := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(input.ApkoYAML)))

	// Convert tags to []interface{} for structpb
	tags := make([]interface{}, len(input.Tags))
	for i, t := range input.Tags {
		tags[i] = t
	}

	extParams, err := structpb.NewStruct(map[string]interface{}{
		"source": map[string]interface{}{
			"apkoConfigDigest": apkoDigest,
			"tags":             tags,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to build external parameters: %w", err)
	}

	pred := &provenance.Provenance{
		BuildDefinition: &provenance.BuildDefinition{
			BuildType:          SecureBuildBuildType,
			ExternalParameters: extParams,
		},
		RunDetails: &provenance.RunDetails{
			Builder: &provenance.Builder{
				Id: SecureBuildBuilderID,
			},
			Metadata: &provenance.BuildMetadata{
				InvocationId: input.BuildID,
			},
		},
	}

	if input.StartedOn != nil {
		pred.RunDetails.Metadata.StartedOn = timestamppb.New(*input.StartedOn)
	}
	if input.FinishedOn != nil {
		pred.RunDetails.Metadata.FinishedOn = timestamppb.New(*input.FinishedOn)
	}

	data, err := protojson.Marshal(pred)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal SLSA provenance predicate: %w", err)
	}

	return data, nil
}
