"use server"

import { Image } from "@/lib/types/image";
import { Session } from "@/lib/types/session";
import { updateAlternateImage } from "../image";

export async function setImageAlternateImageAction(sess: Session, imageId: string, alternateImage: string): Promise<Image> {
  const img = await updateAlternateImage(imageId, alternateImage);
  return img;
}