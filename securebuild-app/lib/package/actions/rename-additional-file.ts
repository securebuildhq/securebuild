"use server";

import { Session } from "@/lib/types/session";
import { AdditionalFile } from "@/lib/types/package";
import { renameAdditionalFile } from "@/lib/package/additional-files";

export async function renameAdditionalFileAction(
  sess: Session,
  packageId: string,
  version: string,
  apkRelease: number,
  oldPath: string,
  newPath: string
): Promise<AdditionalFile> {
  return await renameAdditionalFile(packageId, version, apkRelease, oldPath, newPath);
}