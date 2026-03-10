/**
 * TypeScript interfaces for APKO configuration matching the Go structs in autoimg-cmd/cli/apko.go
 */

export interface APKOContents {
  repositories: string[];
  keyring: string[];
  packages: string[];
}

export interface APKOEntrypoint {
  command: string;
}

export interface APKOAccounts {
  "run-as"?: string;
}

export interface APKOConfig {
  contents: APKOContents;
  entrypoint?: APKOEntrypoint;
  cmd?: string;
  "work-dir"?: string;
  environment?: Record<string, string>;
  accounts?: APKOAccounts;
  archs?: string[];
}

/**
 * Request payload for custom APKO submission API
 */
export interface CustomAPKORequest {
  /** The name for this APKO configuration (image name without registry) */
  name: string;
  /** Tags to apply to the built image */
  tags: string[];
  /** The APKO configuration as base64 encoded YAML string */
  config: string;
  /** Optional README content */
  readme?: string;
  /** Registry URLs where this image should be pushed */
  registry_urls: string[];
}

/**
 * Response from custom APKO submission API
 */
export interface CustomAPKOResponse {
  /** Success indicator */
  success: boolean;
  /** The created custom image ID */
  custom_image_id?: string;
  /** The created custom APKO ID */
  custom_apko_id?: string;
  /** The created custom APKO version ID */
  custom_apko_version_id?: string;
  /** Build ID if build was triggered */
  build_id?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Validation result for APKO configuration
 */
export interface APKOValidationResult {
  valid: boolean;
  errors: string[];
}