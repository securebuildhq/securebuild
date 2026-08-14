"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Patch } from "@/lib/types/package";
import { listPackageVersionPatches } from "../package";
export async function listPackageVersionPatchesAction(pkgId: string, versionLabel: string): Promise<Patch[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const patches = await listPackageVersionPatches(pkgId, versionLabel);
  return patches;
}
