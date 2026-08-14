"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Image } from "@/lib/types/image";
import { listImages } from "../image";

export async function listImagesAction(): Promise<Image[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const images = await listImages();
  return images;
}