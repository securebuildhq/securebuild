"use server"

import { Session } from "@/lib/types/session";
import { Image } from "@/lib/types/image";
import { listImages } from "../image";

export async function listImagesAction(sess: Session): Promise<Image[]> {
  const images = await listImages();
  return images;
}