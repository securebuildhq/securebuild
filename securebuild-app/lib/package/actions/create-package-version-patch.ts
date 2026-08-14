"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Patch } from "@/lib/types/package";
import { createPackageVersionPatch } from "../package";

export async function createPackageVersionPatchAction(pkgId: string, versionLabel: string, filename: string, patch: string): Promise<Patch> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const createdPatch = await createPackageVersionPatch(pkgId, versionLabel, filename, patch);
  return createdPatch;
}
