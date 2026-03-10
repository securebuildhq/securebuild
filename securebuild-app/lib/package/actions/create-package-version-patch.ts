"use server"

import { Session } from "@/lib/types/session";
import { Patch } from "@/lib/types/package";
import { createPackageVersionPatch } from "../package";

export async function createPackageVersionPatchAction(sess: Session, pkgId: string, versionLabel: string, filename: string, patch: string): Promise<Patch> {
  const createdPatch = await createPackageVersionPatch(pkgId, versionLabel, filename, patch);
  return createdPatch;
}
