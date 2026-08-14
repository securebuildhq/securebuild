"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { deleteImageExternalRegistry, getImage } from "../image";

export async function removeExternalRegistryAction(imageId: string, registryId: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const img = await getImage(imageId);
  if (!img) {
    throw new Error("Image not found");
  }

  await deleteImageExternalRegistry(registryId);
}