export interface AdminTeam {
  id: string;
  name: string;
  created_at: string;
  stripe_customer_id?: string;
  payment_email?: string;
  registry_username?: string;
  full_catalog_access: boolean;
  feature_flags: string[];
  service_account_count: number;
}

export interface AdminTeamsListResponse {
  teams: AdminTeam[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface AdminTeamDetailResponse {
  team: AdminTeam;
}

export interface AdminTeamUpdateRequest {
  feature_flags: string[];
}

export interface AdminTeamUpdateResponse {
  team: AdminTeam;
}

export interface FeatureFlag {
  key: string;
  name: string;
  description: string;
}

// Available feature flags
export const AVAILABLE_FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: 'custom_melange_upload',
    name: 'Allow Custom Melange Upload',
    description: 'Allows team to upload custom melange configurations'
  },
  {
    key: 'custom_apko_upload',
    name: 'Allow Custom APKO Upload',
    description: 'Allows team to upload custom APKO configurations'
  }
];