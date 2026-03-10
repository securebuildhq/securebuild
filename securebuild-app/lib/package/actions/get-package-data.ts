"use server"

import { Session } from "@/lib/types/session";
import { Package, PackageVersion } from "@/lib/types/package";
import { getPackage, getLatestRevisionByVersion } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function getPackageDataAction(
  sess: Session,
  pkgId: string
): Promise<{ pkg: Package; selectedVersionData: PackageVersion }> {
  // Validate session
  if (!sess?.user) {
    throw new ValidationError("Unauthorized: Valid session required");
  }

  // Get package data
  const pkg = await getPackage(pkgId);
  if (!pkg) {
    throw new ValidationError("Package not found");
  }

  // Get latest version data
  const selectedVersionData = await getLatestRevisionByVersion(pkgId, pkg.lastVersion);
  if (!selectedVersionData) {
    throw new ValidationError("Latest version data not found");
  }

  return { pkg, selectedVersionData };
}
