export interface VersionInfo {
  version: string;
  apkRelease: number;
}

export interface Package {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  lastBuildTime?: Date;
  lastBuildStatus?: string;
  lastVersion: string;
  lastAPKRelease: number;
  subpackages: Package[];
  versionLabels: string[];
  versionInfos?: VersionInfo[];
  isDeleteProtectionEnabled?: boolean;
  parentId?: string;
  parentName?: string;
}

export interface PackageVersion {
  id: string;
  packageId: string;
  createdAt: Date;
  updatedAt: Date;
  version: string;
  melangeYaml: string;
  apkRelease?: number;
  useRoot: boolean;
  bootstrapEnabled: boolean;
  bootstrapApkRepository?: string | null;
  bootstrapKeyringAppend?: string | null;
  customDiskSize?: number | null;
  gitRemote?: string;
  melangeFilePath?: string;
  gitTag?: string;
  gitCommitSha?: string;
}

export enum PackageBuildStatus {
  PENDING = "pending",
  RUNNING = "running",
  SUCCESS = "success",
  FAILED = "failed",
}

export interface PackageBuild {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  status: PackageBuildStatus;
}

export interface CompbinedOutput {
  stdout: string;
  stderr: string;
}

export interface Patch {
  id: string;
  filename: string;
  patch: string;
}

export interface AdditionalFile {
  id: string;
  path: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdditionalFiles {
  filename: string;
  data: string;  // base64 encoded tar.gz
}


export interface PackageTestBuild {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  melangeYaml: string;
  status: PackageBuildStatus;

  buildOutput?: CompbinedOutput;
}

export interface PackageDependency {
  packageId: string;
  packageName: string;
  packageVersion: string;
  packageVersionId: string;
  packageVersionAPKRelease: number;
  status?: string;
  isExternalDependency: boolean;
}
