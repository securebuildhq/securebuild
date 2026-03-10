"use server"

import { Session } from "@/lib/types/session";
import { deleteImageExternalRegistry, getImage } from "../image";

export async function removeExternalRegistryAction(sess: Session, imageId: string, registryId: string): Promise<void> {
  const img = await getImage(imageId);
  if (!img) {
    throw new Error("Image not found");
  }

  await deleteImageExternalRegistry(registryId);
}