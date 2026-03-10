"use server"

import { Patch } from "@/lib/types/package";
import { Session } from "@/lib/types/session";
import { listPackageVersionPatches } from "../package";
export async function listPackageVersionPatchesAction(sess: Session, pkgId: string, versionLabel: string): Promise<Patch[]> {
  const patches = await listPackageVersionPatches(pkgId, versionLabel);
  return patches;
}
