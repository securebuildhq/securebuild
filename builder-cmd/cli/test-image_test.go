package cli

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExecuteImageTestPipelineLoadsReusablePipelineFromBuildWorkDir(t *testing.T) {
	t.Parallel()

	workDir := t.TempDir()
	pipelineDir := filepath.Join(workDir, imagePipelineDir)
	pipelinePath := filepath.Join(pipelineDir, "test", "compare-images.yaml")
	require.NoError(t, os.MkdirAll(filepath.Dir(pipelinePath), 0o755))
	require.NoError(t, os.WriteFile(pipelinePath, []byte(`
name: Compare images
pipeline:
  - name: success
    runs: ":"
`), 0o644))

	testConfig := &ImageTestConfig{Pipeline: []ImageTestStep{{
		Uses: "test/compare-images",
	}}}

	require.NoError(t, executeImageTestPipeline(
		context.Background(),
		testConfig,
		pipelineDir,
		"image:latest-arm64",
		"alpine/kubectl:1.34.2",
		"arm64",
		1,
	))
}

func TestResolveInputs(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		pipelineInputs map[string]PipelineInput
		providedInputs map[string]string
		script         string
		ourImage       string
		refImage       string
		arch           string
		wantInputs     map[string]string
		wantScript     string
		wantErr        bool
		errContains    string
	}{
		{
			name: "all required provided",
			pipelineInputs: map[string]PipelineInput{
				"threshold": {Description: "Max diff", Required: true},
			},
			providedInputs: map[string]string{"threshold": "10"},
			script:         "compare --threshold ${{inputs.threshold}}",
			ourImage:       "test:v1",
			refImage:       "ref:v1",
			arch:           "amd64",
			wantInputs:     map[string]string{"threshold": "10"},
			wantScript:     "compare --threshold 10",
		},
		{
			name: "use default value",
			pipelineInputs: map[string]PipelineInput{
				"format": {Description: "Output format", Default: "json"},
			},
			providedInputs: map[string]string{},
			script:         "output --format ${{inputs.format}}",
			ourImage:       "test:v1",
			refImage:       "ref:v1",
			arch:           "arm64",
			wantInputs:     map[string]string{"format": "json"},
			wantScript:     "output --format json",
		},
		{
			name: "override default",
			pipelineInputs: map[string]PipelineInput{
				"format": {Description: "Output format", Default: "json"},
			},
			providedInputs: map[string]string{"format": "xml"},
			script:         "output --format ${{inputs.format}}",
			ourImage:       "test:v1",
			refImage:       "ref:v1",
			arch:           "amd64",
			wantInputs:     map[string]string{"format": "xml"},
			wantScript:     "output --format xml",
		},
		{
			name: "missing required input",
			pipelineInputs: map[string]PipelineInput{
				"threshold": {Description: "Max diff", Required: true},
			},
			providedInputs: map[string]string{},
			script:         "compare --threshold ${{inputs.threshold}}",
			ourImage:       "test:v1",
			refImage:       "ref:v1",
			arch:           "amd64",
			wantErr:        true,
			errContains:    "missing required input",
		},
		{
			name: "multiple missing required",
			pipelineInputs: map[string]PipelineInput{
				"input1": {Required: true},
				"input2": {Required: true},
			},
			providedInputs: map[string]string{},
			wantErr:        true,
			errContains:    "missing required input",
		},
		{
			name:           "system vars substitution",
			pipelineInputs: map[string]PipelineInput{},
			providedInputs: map[string]string{},
			script:         "docker inspect ${{.OurImage}} && docker inspect ${{.RefImage}} && echo ${{.Arch}}",
			ourImage:       "myimage:v1",
			refImage:       "baseimage:v1",
			arch:           "amd64",
			wantInputs:     map[string]string{},
			wantScript:     "docker inspect myimage:v1 && docker inspect baseimage:v1 && echo amd64",
		},
		{
			name:           "nil pipeline inputs passthrough",
			pipelineInputs: nil,
			providedInputs: map[string]string{"message": "hello", "count": "5"},
			script:         "echo ${{inputs.message}} x ${{inputs.count}}",
			ourImage:       "test:v1",
			refImage:       "ref:v1",
			arch:           "amd64",
			wantInputs:     map[string]string{"message": "hello", "count": "5"},
			wantScript:     "echo hello x 5",
		},
		{
			name:           "empty script",
			pipelineInputs: map[string]PipelineInput{},
			providedInputs: map[string]string{},
			script:         "",
			ourImage:       "test:v1",
			refImage:       "ref:v1",
			arch:           "amd64",
			wantInputs:     map[string]string{},
			wantScript:     "",
		},
		{
			name:           "template error nonexistent field",
			pipelineInputs: map[string]PipelineInput{},
			providedInputs: map[string]string{},
			script:         "invalid template ${{.NonexistentField.SubField}}",
			ourImage:       "test:v1",
			refImage:       "ref:v1",
			arch:           "amd64",
			wantErr:        true,
			errContains:    "template",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			gotInputs, gotScript, err := resolveInputs(
				tt.pipelineInputs,
				tt.providedInputs,
				tt.script,
				tt.ourImage,
				tt.refImage,
				tt.arch,
			)

			if tt.wantErr {
				require.Error(t, err)
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
				return
			}

			require.NoError(t, err)
			assert.Equal(t, tt.wantInputs, gotInputs)
			assert.Equal(t, tt.wantScript, gotScript)
		})
	}
}
