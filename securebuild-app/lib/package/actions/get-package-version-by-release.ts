"use server"

import { Session } from "@/lib/types/session";
import { getPackageVersionByVersionAndRelease } from "../package";
import { PackageVersion } from "@/lib/types/package";

export async function getPackageVersionByReleaseAction(sess: Session, pkgId: string, versionLabel: string, apkRelease: number): Promise<PackageVersion> {
  const pkgVersion = await getPackageVersionByVersionAndRelease(pkgId, versionLabel, apkRelease);
  return pkgVersion;
}
