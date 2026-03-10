"use server";

import { Session } from "@/lib/types/session";
import { AdditionalFile } from "@/lib/types/package";
import { listAdditionalFiles } from "@/lib/package/additional-files";

export async function listAdditionalFilesAction(
  sess: Session,
  packageId: string,
  version: string,
  apkRelease: number
): Promise<AdditionalFile[]> {
  return await listAdditionalFiles(packageId, version, apkRelease);
}