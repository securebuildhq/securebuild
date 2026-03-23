package param

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"

	"github.com/dilutedev/doppler"
	"github.com/securebuildhq/securebuild/pkg/logger"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
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

// StaticVM represents a statically configured VM for the static build backend.
// Architecture is detected at startup via SSH (uname -m), not configured here.
type StaticVM struct {
	Host       string `yaml:"host" json:"host"`
	User       string `yaml:"user" json:"user"`
	Port       int    `yaml:"port" json:"port"`
	SSHKeyPath string `yaml:"ssh_key_path" json:"ssh_key_path"`
	SSHKey     string `yaml:"ssh_key" json:"ssh_key"`
}

type Param struct {
	DBURI string `yaml:"db_uri"`

	ApkRepository string `yaml:"apk_repository"`

	ReplicatedAPIToken  string `yaml:"replicated_api_token"`
	ReplicatedAPIOrigin string `yaml:"replicated_api_origin"`

	RegistryImagePrefix string `yaml:"registry_image_prefix"`
	OCIImagePrefix      string `yaml:"oci_image_prefix"`
	RegistryUsername    string `yaml:"registry_username"`
	RegistryPassword    string `yaml:"registry_password"`

	AnthropicAPIKey string `yaml:"anthropic_api_key"`
	OpenAIAPIKey    string `yaml:"openai_api_key"`

	PoolSize int `yaml:"pool_size"`

	APKPublicKeyName  string `yaml:"apk_public_key_name"`
	APKPublicKeyData  string `yaml:"apk_public_key_data"`
	APKSigningKeyData string `yaml:"apk_signing_key_data"`

	CosignKey      string `yaml:"cosign_key"`
	CosignPub      string `yaml:"cosign_pub"`
	CosignPassword string `yaml:"cosign_password"`

	// OIDC params for keyless signing
	OIDCGCPProjectID       string `yaml:"oidc_gcp_project_id"`
	OIDCGCPAttestorAccount string `yaml:"oidc_gcp_attestor_account"`
	OIDCGCPAttestorKeyJSON string `yaml:"oidc_gcp_attestor_key_json"`

	R2BucketName       string `yaml:"r2_bucket_name"`
	R2FeedBucketName   string `yaml:"r2_feed_bucket_name"`
	R2AccessKey        string `yaml:"r2_access_key"`
	R2SecretKey        string `yaml:"r2_secret_key"`
	R2Endpoint         string `yaml:"r2_endpoint"`
	R2UseDynamicFolder bool   `yaml:"r2_use_dynamic_folder"`
	R2UsePathStyle     bool   `yaml:"r2_use_path_style"`

	CloudflareAccountID       string `yaml:"cloudflare_account_id"`
	CloudflareQueueName       string `yaml:"cloudflare_queue_name"`
	CloudflareAPIKey          string `yaml:"cloudflare_api_key"`
	CloudflareZoneID          string `yaml:"cloudflare_zone_id"`
	CloudflareCachePurgeToken string `yaml:"cloudflare_cache_purge_token"`

	UpdaterGithubAPIToken string `yaml:"updater_github_api_token"`

	ReleaseMonitorAPIToken string `yaml:"release_monitor_api_token"`

	ExternalRegistryEncryptionSecret string `yaml:"external_registry_encryption_secret"`

	// JWT signing secret for OCI proxy tokens (can reuse existing secret if needed)
	OCIProxyJWTSecret     string `yaml:"oci_proxy_jwt_secret"`
	OCIProxySkipTLSVerify bool   `yaml:"oci_proxy_skip_tls_verify"`

	// Instance type configuration for VM provisioning
	InstanceTypeX86   string `yaml:"instance_type_x86"`
	InstanceTypeARM64 string `yaml:"instance_type_arm64"`

	// Spec Sync Configuration
	SpecSyncEnabled bool   `yaml:"specsync_enabled"`
	SpecSyncToken   string `yaml:"specsync_github_token"`
	SpecSyncBranch  string `yaml:"specsync_github_branch"`

	// Pipeline Directory Configuration
	PipelineDir string `yaml:"pipeline_dir"`

	// Logging Configuration
	LogLevel string `yaml:"log_level"`

	// Vulnerability Database Configuration
	GrypeDBRoot  string `yaml:"grype_database_root"`
	VunnelImage  string `yaml:"vunnel_image"`

	// PProf Configuration
	PProfEnabled bool `yaml:"pprof_enabled"`

	// Melange YAML Configuration
	RemoveCommitSHAPins bool `yaml:"remove_commit_sha_pins"`

	// Build backend configuration
	BuildBackend      string     `yaml:"build_backend"`
	MaxParallelBuilds int        `yaml:"max_parallel_builds"`
	StaticVMs         []StaticVM `yaml:"static_vms"`

	// Authentication configuration
	AuthMethod        string `yaml:"auth_method"`
	AdminUserEmail    string `yaml:"admin_user_email"`
	AdminUserPassword string `yaml:"admin_user_password"`
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
	InitSourceYAMLFile    InitSource = "yaml_file"
)

// ResolveInitSource reads SECUREBUILD_CONFIG_SOURCE from the environment and
// returns the corresponding InitSource:
//
//	missing / "doppler" → InitSourceDoppler
//	"env"              → InitSourceEnvironment
//	*.yaml / *.yml     → InitSourceYAMLFile
func ResolveInitSource() (InitSource, error) {
	configSource := os.Getenv("SECUREBUILD_CONFIG_SOURCE")
	switch {
	case configSource == "" || configSource == "doppler":
		return InitSourceDoppler, nil
	case configSource == "env":
		return InitSourceEnvironment, nil
	default:
		ext := filepath.Ext(configSource)
		if ext == ".yaml" || ext == ".yml" {
			return InitSourceYAMLFile, nil
		}
		return "", fmt.Errorf("invalid SECUREBUILD_CONFIG_SOURCE: %s (expected 'doppler', 'env', or path to .yaml/.yml file)", configSource)
	}
}

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

	case InitSourceYAMLFile:
		configPath := os.Getenv("SECUREBUILD_CONFIG_SOURCE")
		p, err = loadFromYAMLFile(configPath)
		if err != nil {
			return nil, err
		}

		// Overlay environment variables on top so they take precedence over the file.
		if err = overlayFromEnvironment(p); err != nil {
			return nil, err
		}

		// Apply overrides if provided (for tests)
		if overrides != nil {
			applyOverrides(p, overrides)
		}

	default:
		return nil, fmt.Errorf("invalid init source: %s", source)
	}

	// Apply defaults
	if p.MaxParallelBuilds <= 0 {
		p.MaxParallelBuilds = 1
	}

	// CMX is limited to 1 build at a time (runs in HOME; no per-build work dirs).
	if p.BuildBackend == "cmx" && p.MaxParallelBuilds > 1 {
		logger.Warn("CMX backend limits MaxParallelBuilds to 1; overriding config",
			zap.Int("configured", p.MaxParallelBuilds))
		p.MaxParallelBuilds = 1
	}

	// Return context with param embedded
	ctx := context.Background()
	ctx = context.WithValue(ctx, paramContextKey, p)
	return ctx, nil
}

// yamlTagToEnvVar converts a yaml tag value to the UPPER_SNAKE_CASE env var name.
func yamlTagToEnvVar(yamlTag string) string {
	return strings.ToUpper(yamlTag)
}

// overlayFromEnvironment applies any set environment variables on top of p,
// letting env vars take precedence over values already loaded (e.g. from a YAML file).
func overlayFromEnvironment(p *Param) error {
	v := reflect.ValueOf(p).Elem()
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		field := t.Field(i)
		yamlTag := field.Tag.Get("yaml")
		if yamlTag == "" {
			continue
		}
		envVarValue := os.Getenv(yamlTagToEnvVar(yamlTag))
		if envVarValue == "" {
			continue
		}
		if err := setFieldValue(v.Field(i), field, envVarValue); err != nil {
			return err
		}
	}
	return nil
}

// loadFromEnvironment loads all params from actual environment variables.
// It reads the `yaml` tag on each field and uppercases it to derive the env var name.
func loadFromEnvironment() (*Param, error) {
	p := &Param{}
	v := reflect.ValueOf(p).Elem()
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		field := t.Field(i)
		yamlTag := field.Tag.Get("yaml")
		if yamlTag == "" {
			continue
		}

		envVarName := yamlTagToEnvVar(yamlTag)
		envVarValue := os.Getenv(envVarName)
		if envVarValue == "" {
			continue // Don't error if an env var is not set, just skip it
		}

		if err := setFieldValue(v.Field(i), field, envVarValue); err != nil {
			return nil, err
		}
	}

	return p, nil
}

// setFieldValue sets a struct field from a string value, handling scalar types and
// complex types (structs, slices) via YAML unmarshaling.
func setFieldValue(structField reflect.Value, field reflect.StructField, value string) error {
	if !structField.CanSet() {
		return nil
	}

	switch structField.Kind() {
	case reflect.String:
		structField.SetString(value)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		intValue, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return fmt.Errorf("failed to parse int for field %s: %w", field.Name, err)
		}
		structField.SetInt(intValue)
	case reflect.Bool:
		boolValue, err := strconv.ParseBool(value)
		if err != nil {
			return fmt.Errorf("failed to parse bool for field %s: %w", field.Name, err)
		}
		structField.SetBool(boolValue)
	case reflect.Slice, reflect.Struct, reflect.Map:
		// For complex types, unmarshal the string value as YAML
		target := reflect.New(structField.Type()).Interface()
		if err := yaml.Unmarshal([]byte(value), target); err != nil {
			return fmt.Errorf("failed to unmarshal YAML for field %s: %w", field.Name, err)
		}
		structField.Set(reflect.ValueOf(target).Elem())
	default:
		return fmt.Errorf("unsupported field type %s for field %s", structField.Kind(), field.Name)
	}
	return nil
}

// applyOverrides applies test overrides to param.
// Override keys use UPPER_SNAKE_CASE (matching env var names).
func applyOverrides(p *Param, overrides map[string]string) {
	v := reflect.ValueOf(p).Elem()
	t := v.Type()

	for i := 0; i < v.NumField(); i++ {
		field := t.Field(i)
		yamlTag := field.Tag.Get("yaml")
		if yamlTag == "" {
			continue
		}

		envVarName := yamlTagToEnvVar(yamlTag)
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
			case reflect.Slice, reflect.Struct, reflect.Map:
				target := reflect.New(structField.Type()).Interface()
				if err := yaml.Unmarshal([]byte(overrideValue), target); err == nil {
					structField.Set(reflect.ValueOf(target).Elem())
				}
			}
		}
	}
}

// loadFromYAMLFile loads params from a YAML config file.
func loadFromYAMLFile(path string) (*Param, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file %s: %w", path, err)
	}

	p := &Param{}
	if err := yaml.Unmarshal(data, p); err != nil {
		return nil, fmt.Errorf("failed to parse YAML config file %s: %w", path, err)
	}

	return p, nil
}

// loadFromDoppler loads from Doppler (existing production logic).
// Reads the `yaml` tag, uppercases it to find the Doppler secret name in the nameMapping.
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
		yamlTag := field.Tag.Get("yaml")
		if yamlTag == "" {
			continue
		}

		// Convert yaml tag (lowercase) to UPPER_SNAKE for Doppler lookup
		secretName := yamlTagToEnvVar(yamlTag)

		// Use the name mapping to find the transformed secret name
		transformedName, hasMapped := nameMapping[secretName]
		if !hasMapped {
			// Secret not found in Doppler - skip silently (new fields may not exist in Doppler yet)
			continue
		}

		secretValue, exists := secrets[transformedName]
		if !exists {
			continue
		}

		// Convert interface{} to string
		secretValueStr := fmt.Sprintf("%v", secretValue)

		if err := setFieldValue(v.Field(i), field, secretValueStr); err != nil {
			return nil, err
		}
	}

	return p, nil
}
