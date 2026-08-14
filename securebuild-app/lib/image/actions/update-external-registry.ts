"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { ImageExternalRegistry } from "@/lib/types/image";
import { getImage, updateImageExternalRegistry } from "../image";

export async function updateExternalRegistryAction(
  imageId: string,
  registryId: string,
  registryUrl: string,
  username: string,
  password?: string,
): Promise<ImageExternalRegistry> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }


  const img = await getImage(imageId);
  if (!img) {
    throw new Error("Image not found");
  }

  return updateImageExternalRegistry(imageId, registryId, registryUrl, username, password);
}
