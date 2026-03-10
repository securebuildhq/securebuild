"use server"

import { Session } from "@/lib/types/session"
import { getImageAction } from "./get-image"
import { ImageAPKO } from "@/lib/types/image"
import { createGenerateApko, getImage } from "../image"

export async function addImageApkoAction(session: Session, imageId: string, apkoId: string): Promise<ImageAPKO> {
  const image = await getImage(imageId)
  if (!image) {
    throw new Error("Image not found")
  }

  const apko = await createGenerateApko(image.id);
  return apko;
}