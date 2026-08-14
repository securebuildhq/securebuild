"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { deletePackageRelease, getPackage } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function deletePackageReleaseAction(
  pkgId: string,
  version: string,
  apkRelease: number
): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }


  // Validate input parameters
  if (!pkgId?.trim()) {
    throw new ValidationError("Package ID is required");
  }

  if (!version?.trim()) {
    throw new ValidationError("Version is required");
  }

  if (!Number.isInteger(apkRelease) || apkRelease < 0) {
    throw new ValidationError("APK release must be a non-negative integer");
  }

  // Get package and check delete protection
  const pkg = await getPackage(pkgId);

  // Check delete protection
  if (pkg.isDeleteProtectionEnabled) {
    throw new ValidationError("Cannot delete package release: delete protection is enabled", 403);
  }

  // Call the core delete function
  await deletePackageRelease(pkgId, version, apkRelease);
}
