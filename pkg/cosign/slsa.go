package cosign

import (
	"crypto/sha256"
	"fmt"
	"time"
)

// SLSAProvenancePredicateType is the predicateType URI for SLSA v1.0 provenance.
const SLSAProvenancePredicateType = "https://slsa.dev/provenance/v1"

// SecureBuildBuildType is the buildType URI for SecureBuild image rebuilds.
const SecureBuildBuildType = "https://securebuild.com/provenance/image-rebuild/v1"

// SecureBuildBuilderID is the builder.id for SecureBuild GCP VM builds.
const SecureBuildBuilderID = "https://securebuild.com/builder/gcp-vm/v1"

// SLSAProvenancePredicate is the top-level SLSA v1.0 provenance predicate.
type SLSAProvenancePredicate struct {
	BuildDefinition SLSABuildDefinition `json:"buildDefinition"`
	RunDetails      SLSARunDetails      `json:"runDetails"`
}

// SLSABuildDefinition represents the buildDefinition in SLSA v1.0.
type SLSABuildDefinition struct {
	BuildType            string                   `json:"buildType"`
	ExternalParameters   SLSAExternalParameters   `json:"externalParameters"`
	InternalParameters   SLSAInternalParameters   `json:"internalParameters"`
	ResolvedDependencies []SLSAResourceDescriptor `json:"resolvedDependencies"`
}

// SLSAExternalParameters holds the user-controlled build inputs.
type SLSAExternalParameters struct {
	Source SLSASourceParameters `json:"source"`
}

// SLSASourceParameters describes the source inputs for the build.
type SLSASourceParameters struct {
	ApkoConfigDigest string   `json:"apkoConfigDigest"`
	Tags             []string `json:"tags"`
}

// SLSAInternalParameters holds builder-controlled parameters.
type SLSAInternalParameters struct {
	BuilderVersion string `json:"builderVersion,omitempty"`
}

// SLSAResourceDescriptor identifies a resolved dependency.
type SLSAResourceDescriptor struct {
	URI    string            `json:"uri"`
	Digest map[string]string `json:"digest,omitempty"`
}

// SLSARunDetails describes the build execution.
type SLSARunDetails struct {
	Builder  SLSABuilder  `json:"builder"`
	Metadata SLSAMetadata `json:"metadata"`
}

// SLSABuilder identifies the build platform.
type SLSABuilder struct {
	ID string `json:"id"`
}

// SLSAMetadata holds build invocation metadata.
type SLSAMetadata struct {
	InvocationID string  `json:"invocationId"`
	StartedOn    *string `json:"startedOn,omitempty"`
	FinishedOn   *string `json:"finishedOn,omitempty"`
}

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
// from the available build metadata.
func BuildSLSAProvenancePredicate(input SLSAProvenanceInput) SLSAProvenancePredicate {
	apkoDigest := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(input.ApkoYAML)))

	return SLSAProvenancePredicate{
		BuildDefinition: SLSABuildDefinition{
			BuildType: SecureBuildBuildType,
			ExternalParameters: SLSAExternalParameters{
				Source: SLSASourceParameters{
					ApkoConfigDigest: apkoDigest,
					Tags:             input.Tags,
				},
			},
			ResolvedDependencies: []SLSAResourceDescriptor{},
		},
		RunDetails: SLSARunDetails{
			Builder: SLSABuilder{
				ID: SecureBuildBuilderID,
			},
			Metadata: SLSAMetadata{
				InvocationID: input.BuildID,
				StartedOn:    formatTimePtr(input.StartedOn),
				FinishedOn:   formatTimePtr(input.FinishedOn),
			},
		},
	}
}

func formatTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}
