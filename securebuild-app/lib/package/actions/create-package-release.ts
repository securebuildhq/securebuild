"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { PackageVersion, AdditionalFiles } from "@/lib/types/package";
import { createPackageRelease, getLatestRevisionByVersion } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";
import { bumpReleaseInMelangeYAML } from "@/lib/package/melange";

export async function createPackageReleaseAction(
  pkgId: string,
  version: string,
  melangeYaml: string,
  additionalFiles?: AdditionalFiles,
  copyFilesFromExisting: boolean = true
): Promise<PackageVersion> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }


  // Get the current version to validate it exists
  const existingVersion = await getLatestRevisionByVersion(pkgId, version);
  if (!existingVersion) {
    throw new ValidationError(`Version ${version} does not exist for this package`);
  }

  // Calculate the next release number
  const nextRelease = (existingVersion.apkRelease || 0) + 1;

  // Update the epoch in the melange YAML
  const updatedMelangeYaml = bumpReleaseInMelangeYAML(melangeYaml, nextRelease);

  // Create the new package release
  // copyFilesFromExisting=true: Copy files from existing version (UI default)
  // additionalFiles provided: Use provided files (API/CLI)
  // Both false/undefined: Create release with no additional files
  const pkgVersion = await createPackageRelease(
    pkgId,
    version,
    updatedMelangeYaml,
    additionalFiles,
    copyFilesFromExisting
  );

  return pkgVersion;
}