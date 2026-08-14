"use server";

import { getServerSession } from "@/lib/auth/server-session";

import { AdditionalFile } from "@/lib/types/package";
import { updateAdditionalFile } from "@/lib/package/additional-files";

export async function updateAdditionalFileAction(
  packageId: string,
  version: string,
  apkRelease: number,
  path: string,
  content: string
): Promise<AdditionalFile> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await updateAdditionalFile(packageId, version, apkRelease, path, content);
}