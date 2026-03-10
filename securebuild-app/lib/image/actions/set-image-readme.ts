"use server"

import { Session } from "@/lib/types/session";
import { getImage, setImageReadme } from "../image";
import { Image } from "@/lib/types/image";

export async function setImageReadmeAction(sess: Session, id: string, readme: string): Promise<Image> {
  const image = await getImage(id);
  if (!image) {
    throw new Error("Image not found");
  }
  await setImageReadme(id, readme);
  return await getImage(id);
}