"use server"

import { Image } from "@/lib/types/image";
import { Session } from "@/lib/types/session";
import { updateImageGitLink } from "../image";

export async function updateImageGitLinkAction(
  session: Session,
  imageId: string,
  gitRemote: string,
  apkoFilePath: string,
  imageTagTemplate: string,
): Promise<Image> {
  if (!session?.user) {
    throw new Error("Unauthorized: Valid session required");
  }
  return await updateImageGitLink(
    imageId,
    gitRemote || null,
    apkoFilePath || null,
    imageTagTemplate || null,
  );
}
