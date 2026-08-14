"use server";

import { getServerSession } from "@/lib/auth/server-session";

import { AdditionalFile } from "@/lib/types/package";
import { renameAdditionalFile } from "@/lib/package/additional-files";

export async function renameAdditionalFileAction(
  packageId: string,
  version: string,
  apkRelease: number,
  oldPath: string,
  newPath: string
): Promise<AdditionalFile> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await renameAdditionalFile(packageId, version, apkRelease, oldPath, newPath);
}