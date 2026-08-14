"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Image } from "@/lib/types/image";
import { updateImageGitLink } from "../image";

export async function updateImageGitLinkAction(
  imageId: string,
  gitRemote: string,
  apkoFilePath: string,
  imageTagTemplate: string,
): Promise<Image> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await updateImageGitLink(
    imageId,
    gitRemote || null,
    apkoFilePath || null,
    imageTagTemplate || null,
  );
}
