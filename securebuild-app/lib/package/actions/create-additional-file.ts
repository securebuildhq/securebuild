"use server";

import { Session } from "@/lib/types/session";
import { AdditionalFile } from "@/lib/types/package";
import { createAdditionalFile } from "@/lib/package/additional-files";

export async function createAdditionalFileAction(
  sess: Session,
  packageId: string,
  version: string,
  apkRelease: number,
  path: string,
  content: string
): Promise<AdditionalFile> {
  return await createAdditionalFile(packageId, version, apkRelease, path, content);
}