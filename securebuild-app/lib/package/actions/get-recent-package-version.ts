"use server"

import { Session } from "@/lib/types/session";
import { getMostRecentPackageVersion } from "../package";
import { PackageVersion } from "@/lib/types/package";

export async function getMostRecentPackageVersionAction(sess: Session, packageId: string): Promise<PackageVersion> {
  return await getMostRecentPackageVersion(packageId);
}