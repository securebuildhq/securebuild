"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { PackageVersion } from "@/lib/types/package";
import { createPackageVersion } from "../package";

export async function createPackageVersionAction(pkgId: string, version: string): Promise<PackageVersion> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

    const pkgVersion = await createPackageVersion(pkgId, version);
    return pkgVersion;
}