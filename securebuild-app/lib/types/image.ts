import { CatalogItem } from "./catalog";


export interface Image {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  alternateImage: string;
  readme: string | null;
  isPublic?: boolean;

  lastScannedAt: Date | null;
  lastBuiltAt: Date | null;
  lastBuildStatus: ImageBuildStatus | null;

  defaultTagVulnCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };

  canonicalVulnCounts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };

  fixableCVECount?: number;

  apkos: ImageAPKO[];

  catalogItems: ImageContainedInCatalogItem[];

  currentTags: ImageTag[];

  externalRegistries: ImageExternalRegistry[];

  gitRemote?: string;
  apkoFilePath?: string;
  imageTagTemplate?: string;
}

export interface ImageExternalRegistry {
  id: string;
  registryUrl: string;
  username: string;
  createdAt?: Date;
}

export interface ImageTag {
  tag: string;
  builtAt: Date;
  lastScannedAt: Date | null;
  lastScanResultX86?: string | null;
  lastScanResultAarch64?: string | null;
  lastScanResultAlternateX86?: string | null;
  lastScanResultAlternateAarch64?: string | null;
}

export interface ImageContainedInCatalogItem {
  catalogItemId: string;
  catalogItemName: string;
}

export interface ImageAPKO {
  id: string;
  name: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  readme: string | null;
  lastBuiltAt: Date | null;
  testYaml: string | null;

  latestVersion: ImageAPKOVersion;
  gitTag?: string;
  gitCommitSha?: string;
  apkoFilePath?: string;
}

export interface ImageAPKOVersion {
  id: string;
  apkoYaml: string;
  createdAt: Date;
  updatedAt: Date;
  gitRemote?: string;
  apkoFilePath?: string;
  gitCommitSha?: string;
}

export interface ImageBuild {
  id: string;
  imageId: string | null;
  imageApkoVersionId: string;
  imageName: string | null;
  imageTags: string[];
  status: ImageBuildStatus;
  createdAt: Date;
  timeoutAt: Date | null;
  builderId: string | null;
  buildStartedAt: Date | null;
  buildFinishedAt: Date | null;
  // Log fields
  apkoStdout?: string | null;
  apkoStderr?: string | null;
  grypeAarch64Stderr?: string | null;
  grypeX86_64Stderr?: string | null;
  grypeAlternateAarch64Stderr?: string | null;
  grypeAlternateX86_64Stderr?: string | null;

  builderStdout?: string | null;
  workerError?: string | null;
}

export type ImageBuildStatus =
  | "pending"
  | "queued"
  | "building"
  | "testing"
  | "publishing"
  | "running"
  | "success"
  | "failed"
  | "timed_out";
