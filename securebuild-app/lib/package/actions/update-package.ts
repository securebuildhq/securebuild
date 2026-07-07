"use server"

import { Session } from "@/lib/types/session";
import { getPackage, getPackageVersion, updatePackageVersion, extractPackageInfoFromMelange } from "../package";
import { Package, PackageVersion } from "@/lib/types/package";
import { getLastExecutionForPackageVersion } from "@/lib/execution/execution";
import { logger } from "@/lib/utils/logger";
import { ValidationError } from '@/lib/errors/validation-error';
import { validateMelangeYAML } from "@/lib/melange/validation";

export interface UpdateActionOpts {
  melangeYaml?: string
  useRoot?: boolean
  bootstrapEnabled?: boolean
  bootstrapApkRepository?: string | null
  bootstrapKeyringAppend?: string | null
  customDiskSize?: number | null
}

export interface UpdatePackageError {
  isFailed: boolean,
  message: string
}

export async function updatePackageAction(sess: Session, id: string, version: string, apkRelease: number, opts: UpdateActionOpts): Promise<PackageVersion | UpdatePackageError> {
  const pkg = await getPackage(id)

  if (!pkg) {
    return {
      isFailed: true,
      message: "Package not found"
    }
  }

  const pkgVersion = await getPackageVersion(id, version, apkRelease)

  if (!pkgVersion) {
    return {
      isFailed: true,
      message: "Version not found"
    }
  }

  // Validate melange YAML
  if (opts.melangeYaml) {
    try {
      // First validate YAML syntax and structure
      await validateMelangeYAML(opts.melangeYaml);

      // Then validate package name and version match
      const melangeInfo = extractPackageInfoFromMelange(opts.melangeYaml);
      
      if (melangeInfo.name && melangeInfo.name !== pkg.name) {
        return {
          isFailed: true,
          message: `Package name in melange YAML ("${melangeInfo.name}") does not match current package name ("${pkg.name}")`
        };
      }
      
      if (melangeInfo.version && melangeInfo.version !== version) {
        return {
          isFailed: true,
          message: `Package version in melange YAML ("${melangeInfo.version}") does not match selected version ("${version}"). Tip: Try quoting the version in YAML (version: "${melangeInfo.version}") to avoid parsing issues.`
        };
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          isFailed: true,
          message: error.message
        };
      }
      // For other errors, log and continue
      logger.error('Error during melange validation:', error);
    }
  }

  const hasMelangeYamlChanged = opts.melangeYaml && (opts.melangeYaml !== pkgVersion.melangeYaml);
  const hasCustomDiskSizeChanged = opts.customDiskSize !== undefined && opts.customDiskSize !== pkgVersion.customDiskSize;

  // Linked package versions cannot be edited — specs are pulled from git
  if (pkgVersion.gitRemote && hasMelangeYamlChanged) {
    return {
      isFailed: true,
      message: "Cannot edit melange yaml for a linked package version. Create a new release instead."
    }
  }

  // we cannot update the melage yaml or custom disk size if the package version has been built successfully
  const lastExecution = await getLastExecutionForPackageVersion(pkgVersion.id);
  if (lastExecution) {
    const disallowedStatuses = ["success", "building", "publishing"];
    if (hasMelangeYamlChanged && disallowedStatuses.includes(lastExecution.status)) {
      return {
        isFailed: true,
        message: "Cannot update melange yaml if the package version has been built successfully"
      }
    }
    if (hasCustomDiskSizeChanged && disallowedStatuses.includes(lastExecution.status)) {
      return {
        isFailed: true,
        message: "Cannot update custom disk size if the package version has been built successfully"
      }
    }
  }

  const updatedPkgVersion = await updatePackageVersion(pkgVersion.id,
    hasMelangeYamlChanged ? opts.melangeYaml : undefined,
    opts.useRoot !== undefined ? opts.useRoot : false,
    opts.bootstrapEnabled !== undefined ? opts.bootstrapEnabled : false,
    opts.bootstrapApkRepository,
    opts.bootstrapKeyringAppend,
    opts.customDiskSize
  )

  return updatedPkgVersion;
}
