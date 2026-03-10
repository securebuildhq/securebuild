package param

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strconv"
	"strings"

	"github.com/dilutedev/doppler"
)

// camelToSnake converts UpperCamelCase to UPPER_SNAKE_CASE
func camelToSnake(s string) string {
	var result strings.Builder
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			result.WriteRune('_')
		}
		result.WriteRune(r)
	}
	return strings.ToUpper(result.String())
}

type Param struct {
	DBURI string `doppler:"DB_URI"`

	SecureBuildApkRepository string `doppler:"SECUREBUILD_APK_REPOSITORY"`

	ReplicatedAPIToken     string `doppler:"REPLICATED_API_TOKEN"`
	ReplicatedAPIOrigin    string `doppler:"REPLICATED_API_ORIGIN"`
	OCIRegistryBase        string `doppler:"OCI_REGISTRY_BASE"`
	ReplicatedAppSlug      string `doppler:"REPLICATED_APP_SLUG"`
	ReplicatedRegistryHost string `doppler:"REPLICATED_REGISTRY_HOST"`

	AnthropicAPIKey string `doppler:"ANTHROPIC_API_KEY"`
	OpenAIAPIKey    string `doppler:"OPENAI_API_KEY"`

	PoolSize int `doppler:"POOL_SIZE"`

	APKPublicKeyName  string `doppler:"APK_PUBLIC_KEY_NAME"`
	APKPublicKeyData  string `doppler:"APK_PUBLIC_KEY_DATA"`
	APKSigningKeyName string `doppler:"APK_SIGNING_KEY_NAME"`
	APKSigningKeyData string `doppler:"APK_SIGNING_KEY_DATA"`

	CVE0OCIHost string `doppler:"CVE0_OCI_HOST"`

	CosignKey      string `doppler:"COSIGN_KEY"`
	CosignPub      string `doppler:"COSIGN_PUB"`
	CosignPassword string `doppler:"COSIGN_PASSWORD"`

	// OIDC params for keyless signing
	OIDCGCPProjectID       string `doppler:"OIDC_GCP_PROJECT_ID"`
	OIDCGCPAttestorAccount string `doppler:"OIDC_GCP_ATTESTOR_ACCOUNT"`
	OIDCGCPAttestorKeyJSON string `doppler:"OIDC_GCP_ATTESTOR_KEY_JSON"`

	R2BucketName       string `doppler:"R2_BUCKET_NAME"`
	R2FeedBucketName   string `doppler:"R2_FEED_BUCKET_NAME"`
	R2AccessKey        string `doppler:"R2_ACCESS_KEY"`
	R2SecretKey        string `doppler:"R2_SECRET_KEY"`
	R2Endpoint         string `doppler:"R2_ENDPOINT"`
	R2UseDynamicFolder bool   `doppler:"R2_USE_DYNAMIC_FOLDER"`
	R2UsePathStyle     bool   `doppler:"R2_USE_PATH_STYLE"`

	CloudflareAccountID       string `doppler:"CLOUDFLARE_ACCOUNT_ID"`
	CloudflareQueueName       string `doppler:"CLOUDFLARE_QUEUE_NAME"`
	CloudflareAPIKey          string `doppler:"CLOUDFLARE_API_KEY"`
	CloudflareZoneID          string `doppler:"CLOUDFLARE_ZONE_ID"`
	CloudflareCachePurgeToken string `doppler:"CLOUDFLARE_CACHE_PURGE_TOKEN"`

	PostmarkServerToken string `doppler:"POSTMARK_SERVER_TOKEN"`

	UpdaterGithubAPIToken string `doppler:"UPDATER_GITHUB_API_TOKEN"`

	ReleaseMonitorAPIToken string `doppler:"RELEASE_MONITOR_API_TOKEN"`

	ExternalRegistryEncryptionSecret string `doppler:"EXTERNAL_REGISTRY_ENCRYPTION_SECRET"`

	// JWT signing secret for OCI proxy tokens (can reuse existing secret if needed)
	OCIProxyJWTSecret     string `doppler:"OCI_PROXY_JWT_SECRET"`
	OCIProxySkipTLSVerify bool   `doppler:"OCI_PROXY_SKIP_TLS_VERIFY"`

	// Instance type configuration for VM provisioning
	InstanceTypeX86   string `doppler:"INSTANCE_TYPE_X86"`
	InstanceTypeARM64 string `doppler:"INSTANCE_TYPE_ARM64"`

	// Spec Sync Configuration
	SpecSyncEnabled bool   `doppler:"SPECSYNC_ENABLED"`
	SpecSyncToken   string `doppler:"SPECSYNC_GITHUB_TOKEN"`
	SpecSyncBranch  string `doppler:"SPECSYNC_GITHUB_BRANCH"`

	// Pipeline Directory Configuration
	PipelineDir string `doppler:"PIPELINE_DIR"`

	// Logging Configuration
	LogLevel string `doppler:"LOG_LEVEL"`

	// Vulnerability Database Configuration
	GrypeDBRoot string `doppler:"GRYPE_DATABASE_ROOT"`

	// PProf Configuration
	PProfEnabled bool `doppler:"PPROF_ENABLED"`

	// Melange YAML Configuration
	RemoveCommitSHAPins bool `doppler:"REMOVE_COMMIT_SHA_PINS"`
}

// Use a simple string as context key to avoid type compatibility issues
// across packages that can't import each other (e.g., persistence can't import param)
const paramContextKey = "param"

// ParamContextKey is exported for use in middleware and context utilities
const ParamContextKey = paramContextKey

func GetParam(ctx context.Context) *Param {
	p, ok := ctx.Value(paramContextKey).(*Param)
	if !ok || p == nil {
		panic("param not initialized in context - call param.Init first")
	}
	return p
}

// WithParam adds a Param to the context (useful for middleware)
func WithParam(ctx context.Context, p *Param) context.Context {
	return context.WithValue(ctx, paramContextKey, p)
}

// TryGetParam retrieves param from context, returns nil if not found (no panic)
func TryGetParam(ctx context.Context) *Param {
	p, _ := ctx.Value(paramContextKey).(*Param)
	return p
}

type InitSource string

const (
	InitSourceDoppler     InitSource = "doppler"
	InitSourceEnvironment InitSource = "environment"
)

// Init initializes param and returns a context with the param embedded
// overrides is optional - used in tests to override specific values
// Base values always loaded from environment, then overrides applied on top
func Init(source InitSource, overrides map[string]string) (context.Context, error) {
	var p *Param
	var err error

	switch source {
	case InitSourceDoppler:
		// Production: load from Doppler
		p, err = loadFromDoppler()
		if err != nil {
			return nil, err
		}

	case InitSourceEnvironment:
		// Always load from environment first
		p, err = loadFromEnvironment()
		if err != nil {
			return nil, err
		}

		// Apply overrides if provided (for tests)
		if overrides != nil {
			applyOverrides(p, overrides)
		}

	default:
		return nil, fmt.Errorf("invalid init source: %s", source)
	}

	// Return context with param embedded
	ctx := context.Background()
	ctx = context.WithValue(ctx, paramContextKey, p)
	return ctx, nil
}

// loadFromEnvironment loads all params from actual environment variables
func loadFromEnvironment() (*Param, error) {
	p := &Param{}
	v := reflect.ValueOf(p).Elem()
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		field := t.Field(i)
		envVarName := field.Tag.Get("doppler") // Using the same tag for convenience
		if envVarName == "" {
			continue
		}

		envVarValue := os.Getenv(envVarName)
		if envVarValue == "" {
			continue // Don't error if an env var is not set, just skip it
		}

		structField := v.Field(i)
		if structField.CanSet() {
			switch structField.Kind() {
			case reflect.String:
				structField.SetString(envVarValue)
			case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
				intValue, err := strconv.ParseInt(envVarValue, 10, 64)
				if err != nil {
					return nil, fmt.Errorf("failed to parse int for field %s from env var %s: %w", field.Name, envVarName, err)
				}
				structField.SetInt(intValue)
			case reflect.Bool:
				boolValue, err := strconv.ParseBool(envVarValue)
				if err != nil {
					return nil, fmt.Errorf("failed to parse bool for field %s from env var %s: %w", field.Name, envVarName, err)
				}
				structField.SetBool(boolValue)
			default:
				return nil, fmt.Errorf("unsupported field type %s for field %s", structField.Kind(), field.Name)
			}
		}
	}

	return p, nil
}

// applyOverrides applies test overrides to param
// Only overrides fields that are present in the overrides map
func applyOverrides(p *Param, overrides map[string]string) {
	v := reflect.ValueOf(p).Elem()
	t := v.Type()

	for i := 0; i < v.NumField(); i++ {
		field := t.Field(i)
		envVarName := field.Tag.Get("doppler")
		if envVarName == "" {
			continue
		}

		overrideValue, ok := overrides[envVarName]
		if !ok {
			continue
		}

		structField := v.Field(i)
		if structField.CanSet() {
			switch structField.Kind() {
			case reflect.String:
				structField.SetString(overrideValue)
			case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
				if intValue, err := strconv.ParseInt(overrideValue, 10, 64); err == nil {
					structField.SetInt(intValue)
				}
			case reflect.Bool:
				if boolValue, err := strconv.ParseBool(overrideValue); err == nil {
					structField.SetBool(boolValue)
				}
			}
		}
	}
}

// loadFromDoppler loads from Doppler (existing production logic)
func loadFromDoppler() (*Param, error) {
	dp, err := doppler.NewFromEnv()
	if err != nil {
		return nil, fmt.Errorf("failed to create doppler client: %w", err)
	}

	projects, err := dp.ListProjects(1, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to list doppler projects: %w", err)
	}

	var project *doppler.Project
	for _, p := range projects.Projects {
		if p.Name == "securebuild" {
			project = &p
			break
		}
	}

	if project == nil {
		return nil, fmt.Errorf("securebuild project not found")
	}

	configName := "dev"
	if os.Getenv("DOPPLER_CONFIG") != "" {
		configName = os.Getenv("DOPPLER_CONFIG")
	}

	// Download all secrets in a single API call
	downloadParams := doppler.DownloadSecretParams{
		Project:         project.ID,
		Config:          configName,
		Format:          "json",
		NameTransformer: "upper-camel", // Transform to UpperCamel but we'll handle mapping
	}

	secretsJSON, err := dp.DownloadSecret(downloadParams)
	if err != nil {
		return nil, fmt.Errorf("failed to download doppler secrets: %w", err)
	}

	// Parse the JSON response
	var secrets map[string]interface{}
	if err := json.Unmarshal([]byte(secretsJSON), &secrets); err != nil {
		return nil, fmt.Errorf("failed to parse doppler secrets JSON: %w", err)
	}

	// Create a reverse mapping from transformed names to original names
	// upper-camel transforms DB_URI to DbUri, REPLICATED_API_TOKEN to ReplicatedApiToken, etc.
	nameMapping := make(map[string]string)
	for transformedName := range secrets {
		// Convert back from UpperCamel to UPPER_SNAKE
		originalName := camelToSnake(transformedName)
		nameMapping[originalName] = transformedName
	}

	// Map secrets to struct fields
	p := &Param{}
	v := reflect.ValueOf(p).Elem()
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		field := t.Field(i)
		secretName := field.Tag.Get("doppler")
		if secretName == "" {
			continue
		}

		// Use the name mapping to find the transformed secret name
		transformedName, hasMapped := nameMapping[secretName]
		if !hasMapped {
			return nil, fmt.Errorf("failed to find name mapping for secret %s", secretName)
		}

		secretValue, exists := secrets[transformedName]
		if !exists {
			return nil, fmt.Errorf("failed to get doppler secret %s (transformed to %s)", secretName, transformedName)
		}

		// Convert interface{} to string
		secretValueStr := fmt.Sprintf("%v", secretValue)

		structField := v.Field(i)
		if structField.CanSet() {
			switch structField.Kind() {
			case reflect.String:
				structField.SetString(secretValueStr)
			case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
				intValue, err := strconv.ParseInt(secretValueStr, 10, 64)
				if err != nil {
					return nil, fmt.Errorf("failed to parse int for field %s: %w", field.Name, err)
				}
				structField.SetInt(intValue)
			case reflect.Bool:
				boolValue, err := strconv.ParseBool(secretValueStr)
				if err != nil {
					return nil, fmt.Errorf("failed to parse bool for field %s: %w", field.Name, err)
				}
				structField.SetBool(boolValue)
			default:
				return nil, fmt.Errorf("unsupported field type %s for field %s", structField.Kind(), field.Name)
			}
		}
	}

	return p, nil
}
