"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getImageAction } from "./get-image"
import { ImageAPKO } from "@/lib/types/image"
import { createGenerateApko, getImage } from "../image"

export async function addImageApkoAction(imageId: string, apkoId: string): Promise<ImageAPKO> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const image = await getImage(imageId)
  if (!image) {
    throw new Error("Image not found")
  }

  const apko = await createGenerateApko(image.id);
  return apko;
}