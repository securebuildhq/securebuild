"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Image } from "@/lib/types/image";
import { updateAlternateImage } from "../image";

export async function setImageAlternateImageAction(imageId: string, alternateImage: string): Promise<Image> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const img = await updateAlternateImage(imageId, alternateImage);
  return img;
}