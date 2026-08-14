"use server";

import { getServerSession } from "@/lib/auth/server-session";

import { deleteAdditionalFile } from "@/lib/package/additional-files";

export async function deleteAdditionalFileAction(
  packageId: string,
  version: string,
  apkRelease: number,
  path: string
): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await deleteAdditionalFile(packageId, version, apkRelease, path);
}