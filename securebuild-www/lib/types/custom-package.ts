export interface CustomPackage {
  id: string;
  parent_id?: string;
  name: string;
  team_id: string;
  created_at: Date;
  updated_at?: Date;
  check_for_updates_at?: Date;
  is_delete_protection_enabled: boolean;
}

export interface CustomPackageVersion {
  id: string;
  custom_package_id: string;
  version: string;
  melange_yaml?: string;
  created_at: Date;
  updated_at?: Date;
  license?: string;
  apk_release: number;
  use_root: boolean;
}

export interface CustomPackageVersionAdditionalFile {
  id: string;
  custom_package_version_id: string;
  path: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export interface ProcessedMelange {
  yaml: string;
  packageName: string;
  version: string;
  allNames: string[]; // includes main, subpackages, provides
  subpackages?: string[];
  provides?: string[];
}

export interface CustomPackageResponse {
  success: boolean;
  error?: string;
  package_id?: string;
  package_version_id?: string;
  package_name?: string;
  build_id?: string;
  status?: string;
}

export interface PackageConflict {
  name: string;
  team_id: string;
  table: 'package' | 'custom_package';
}

export interface VendorPackageRequest {
  melange_yaml: string; // base64-encoded-gzipped-yaml
  additional_files?: {
    name: string;
    data: string; // base64-encoded-gzipped-data
  }[];
  use_root?: boolean;
}