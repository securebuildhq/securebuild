"use server";

import { Session } from "@/lib/types/session";
import { deleteAdditionalFile } from "@/lib/package/additional-files";

export async function deleteAdditionalFileAction(
  sess: Session,
  packageId: string,
  version: string,
  apkRelease: number,
  path: string
): Promise<void> {
  return await deleteAdditionalFile(packageId, version, apkRelease, path);
}