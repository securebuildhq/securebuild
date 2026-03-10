"use server";

import { Session } from "@/lib/types/session";
import { AdditionalFile } from "@/lib/types/package";
import { updateAdditionalFile } from "@/lib/package/additional-files";

export async function updateAdditionalFileAction(
  sess: Session,
  packageId: string,
  version: string,
  apkRelease: number,
  path: string,
  content: string
): Promise<AdditionalFile> {
  return await updateAdditionalFile(packageId, version, apkRelease, path, content);
}