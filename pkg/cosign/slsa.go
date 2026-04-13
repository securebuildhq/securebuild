package cosign

import (
	"crypto/sha256"
	"fmt"
	"time"

	slsav1 "github.com/in-toto/in-toto-golang/in_toto/slsa_provenance/v1"
)

// SecureBuildBuildType is the buildType URI for SecureBuild image rebuilds.
const SecureBuildBuildType = "https://securebuild.com/provenance/image-rebuild/v1"

// SecureBuildBuilderID is the builder.id for SecureBuild GCP VM builds.
const SecureBuildBuilderID = "https://securebuild.com/builder/gcp-vm/v1"

// SecureBuildSourceParameters holds the user-controlled build inputs specific to SecureBuild.
type SecureBuildSourceParameters struct {
	ApkoConfigDigest string   `json:"apkoConfigDigest"`
	Tags             []string `json:"tags"`
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
// from the available build metadata using the official in-toto types.
func BuildSLSAProvenancePredicate(input SLSAProvenanceInput) slsav1.ProvenancePredicate {
	apkoDigest := fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(input.ApkoYAML)))

	return slsav1.ProvenancePredicate{
		BuildDefinition: slsav1.ProvenanceBuildDefinition{
			BuildType: SecureBuildBuildType,
			ExternalParameters: SecureBuildSourceParameters{
				ApkoConfigDigest: apkoDigest,
				Tags:             input.Tags,
			},
			ResolvedDependencies: []slsav1.ResourceDescriptor{},
		},
		RunDetails: slsav1.ProvenanceRunDetails{
			Builder: slsav1.Builder{
				ID: SecureBuildBuilderID,
			},
			BuildMetadata: slsav1.BuildMetadata{
				InvocationID: input.BuildID,
				StartedOn:    input.StartedOn,
				FinishedOn:   input.FinishedOn,
			},
		},
	}
}
