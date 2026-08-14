"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { createImageExternalRegistry, getImage } from "../image";
import { ImageExternalRegistry } from "@/lib/types/image";

export async function addExternalRegistryAction(imageId: string, registryUrl: string, username: string, password: string): Promise<ImageExternalRegistry> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const img = await getImage(imageId);
  if (!img) {
    throw new Error("Image not found");
  }

  const externalRegistry = await createImageExternalRegistry(imageId, registryUrl, username, password);
  return externalRegistry;
}