"use server"

import { Patch } from "@/lib/types/package";
import { Session } from "@/lib/types/session";
import { createPackageVersionPatchByRelease } from "../package";

export async function createPackageVersionPatchByReleaseAction(sess: Session, pkgId: string, versionLabel: string, apkRelease: number, filename: string, patch: string): Promise<Patch> {
  const patchResult = await createPackageVersionPatchByRelease(pkgId, versionLabel, apkRelease, filename, patch);
  return patchResult;
}
