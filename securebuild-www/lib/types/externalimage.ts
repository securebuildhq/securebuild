
export interface ExternalImage {
  digest: string;
  registry: string;
  imageName: string;
  imageTag: string;
  createdAt: Date;
}

export type SBOMStatus = 'pending' | 'generating' | 'succeeded' | 'failed' | null;
export type ScanStatus = 'queued' | 'running' | 'succeeded' | 'failed' | null;

export interface TagCompletionStatus {
  digest: string;
  isSbomComplete: boolean;
  isScanComplete: boolean;
  isSignatureComplete: boolean;
  sbomStatus: SBOMStatus;
  scanStatus: ScanStatus;
}

export interface TrackedExternalImage {
  registry: string;
  imageName: string;
  imageTags: string[];
  createdAt: Date;

  hasX8664: boolean;
  hasArm64: boolean;

  tagCompletionStatus: { [tag: string]: TagCompletionStatus };
}
