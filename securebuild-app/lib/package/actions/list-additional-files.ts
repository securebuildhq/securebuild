"use server";

import { getServerSession } from "@/lib/auth/server-session";

import { AdditionalFile } from "@/lib/types/package";
import { listAdditionalFiles } from "@/lib/package/additional-files";

export async function listAdditionalFilesAction(
  packageId: string,
  version: string,
  apkRelease: number
): Promise<AdditionalFile[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await listAdditionalFiles(packageId, version, apkRelease);
}