"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Package, PackageVersion } from "@/lib/types/package";
import { getPackage, getLatestRevisionByVersion } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function getPackageDataAction(
  pkgId: string
): Promise<{ pkg: Package; selectedVersionData: PackageVersion }> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
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
