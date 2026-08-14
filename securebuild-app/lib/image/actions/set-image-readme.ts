"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getImage, setImageReadme } from "../image";
import { Image } from "@/lib/types/image";

export async function setImageReadmeAction(id: string, readme: string): Promise<Image> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const image = await getImage(id);
  if (!image) {
    throw new Error("Image not found");
  }
  await setImageReadme(id, readme);
  return await getImage(id);
}