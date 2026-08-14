"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Patch } from "@/lib/types/package";
import { createPackageVersionPatchByRelease } from "../package";

export async function createPackageVersionPatchByReleaseAction(pkgId: string, versionLabel: string, apkRelease: number, filename: string, patch: string): Promise<Patch> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const patchResult = await createPackageVersionPatchByRelease(pkgId, versionLabel, apkRelease, filename, patch);
  return patchResult;
}
