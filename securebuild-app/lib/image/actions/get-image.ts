"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getImage } from "../image";
import { Image } from "@/lib/types/image";

export async function getImageAction(id: string): Promise<Image> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const image = await getImage(id);
  return image;
}
