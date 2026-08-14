"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getPackageVersionByVersionAndRelease } from "../package";
import { PackageVersion } from "@/lib/types/package";

export async function getPackageVersionByReleaseAction(pkgId: string, versionLabel: string, apkRelease: number): Promise<PackageVersion> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const pkgVersion = await getPackageVersionByVersionAndRelease(pkgId, versionLabel, apkRelease);
  return pkgVersion;
}
