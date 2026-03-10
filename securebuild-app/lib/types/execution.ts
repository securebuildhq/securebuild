export interface Execution {
  id: string;
  packageId: string;
  packageName: string;
  versionLabel: string;
  apkRelease: number;
  status: string;
  createdAt: Date;

  x86_64BuildStdout: string;
  x86_64BuildStderr: string;
  x86_64BuildExitCode: number;
  x86_64BuildCommand: string;
  x86_64BuildStartedAt: Date;
  x86_64BuildFinishedAt: Date;
  x86_64BuilderID: string;

  aarch64BuildStdout: string;
  aarch64BuildStderr: string;
  aarch64BuildExitCode: number;
  aarch64BuildCommand: string;
  aarch64BuildStartedAt: Date;
  aarch64BuildFinishedAt: Date;
  aarch64BuilderID: string;

  x86_64_publishOutput: string;
  aarch64_publishOutput: string;

  useRoot: boolean;
  bootstrapEnabled: boolean;
  bootstrapApkRepository: string | null;
  bootstrapKeyringAppend: string | null;

  cause: string;
  causeId: string;
}
