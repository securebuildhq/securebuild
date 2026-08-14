"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Patch } from "@/lib/types/package";
import { listPackageVersionPatchesByRelease } from "../package";

export async function listPackageVersionPatchesByReleaseAction(pkgId: string, versionLabel: string, apkRelease: number): Promise<Patch[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const patches = await listPackageVersionPatchesByRelease(pkgId, versionLabel, apkRelease);
  return patches;
}
