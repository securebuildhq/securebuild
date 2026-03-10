"use server"

import { Patch } from "@/lib/types/package";
import { Session } from "@/lib/types/session";
import { listPackageVersionPatchesByRelease } from "../package";

export async function listPackageVersionPatchesByReleaseAction(sess: Session, pkgId: string, versionLabel: string, apkRelease: number): Promise<Patch[]> {
  const patches = await listPackageVersionPatchesByRelease(pkgId, versionLabel, apkRelease);
  return patches;
}
