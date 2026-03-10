export interface PackageFamily {
  id: string;
  name: string;
  monitoringEnabled: boolean;
  checkFrequencyMinutes: number;
  versionPattern: string;
  majorVersionFilter?: string;
  packageNameTemplate: string;
  imageTagTemplate?: string;
  dryRunMode: boolean;
  minVersion?: string;
  notifyOnDetection: boolean;
  notifyOnBuildFailure: boolean;
  checkForUpdatesAt: Date;
  lastCheckAt?: Date;
  lastError?: string;
  consecutiveErrors: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PackageFamilyPackage {
  packageFamilyId: string;
  packageId: string;
  version: string;
  isTemplate: boolean;
  createdAt: Date;
  packageName: string;
  lastExecutionId?: string | null;
  lastExecutionStatus?: string | null;
  lastExecutionCreatedAt?: Date | null;
}

export interface PackageFamilyWithPackages extends PackageFamily {
  packages: PackageFamilyPackage[];
}

export interface CreatePackageFamilyRequest {
  name: string;
  monitoringEnabled: boolean;
  checkFrequencyMinutes: number;
  versionPattern: string;
  majorVersionFilter?: string;
  packageNameTemplate: string;
  imageTagTemplate?: string;
  dryRunMode: boolean;
  minVersion?: string;
  notifyOnDetection: boolean;
  notifyOnBuildFailure: boolean;
}

export interface UpdatePackageFamilyRequest {
  name?: string;
  monitoringEnabled?: boolean;
  checkFrequencyMinutes?: number;
  versionPattern?: string;
  majorVersionFilter?: string;
  packageNameTemplate?: string;
  imageTagTemplate?: string;
  dryRunMode?: boolean;
  minVersion?: string;
  notifyOnDetection?: boolean;
  notifyOnBuildFailure?: boolean;
}

// Helper functions for version parsing
export function parseVersion(version: string | undefined): { major: number | undefined, minor: number | undefined } {
  if (!version) return { major: undefined, minor: undefined };
  
  const parts = version.split('.');
  const major = parts[0] ? parseInt(parts[0]) : undefined;
  const minor = parts[1] ? parseInt(parts[1]) : undefined;
  
  return { major, minor };
}

export function formatVersion(major: number | undefined, minor: number | undefined): string | undefined {
  if (major === undefined && minor === undefined) return undefined;
  if (major !== undefined && minor !== undefined) return `${major}.${minor}`;
  if (major !== undefined) return `${major}`;
  return undefined;
}