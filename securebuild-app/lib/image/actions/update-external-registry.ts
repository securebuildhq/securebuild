"use server"

import { Session } from "@/lib/types/session";
import { ImageExternalRegistry } from "@/lib/types/image";
import { getImage, updateImageExternalRegistry } from "../image";

export async function updateExternalRegistryAction(
  sess: Session,
  imageId: string,
  registryId: string,
  registryUrl: string,
  username: string,
  password?: string,
): Promise<ImageExternalRegistry> {
  if (!sess?.user) {
    throw new Error("Unauthorized: Valid session required");
  }

  const img = await getImage(imageId);
  if (!img) {
    throw new Error("Image not found");
  }

  return updateImageExternalRegistry(imageId, registryId, registryUrl, username, password);
}
