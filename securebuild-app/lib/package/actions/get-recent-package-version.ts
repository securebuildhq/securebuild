"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getMostRecentPackageVersion } from "../package";
import { PackageVersion } from "@/lib/types/package";

export async function getMostRecentPackageVersionAction(packageId: string): Promise<PackageVersion> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await getMostRecentPackageVersion(packageId);
}