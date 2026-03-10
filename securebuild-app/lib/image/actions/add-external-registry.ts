"use server"

import { Session } from "@/lib/types/session";
import { createImageExternalRegistry, getImage } from "../image";
import { ImageExternalRegistry } from "@/lib/types/image";

export async function addExternalRegistryAction(sess: Session, imageId: string, registryUrl: string, username: string, password: string): Promise<ImageExternalRegistry> {
  const img = await getImage(imageId);
  if (!img) {
    throw new Error("Image not found");
  }

  const externalRegistry = await createImageExternalRegistry(imageId, registryUrl, username, password);
  return externalRegistry;
}