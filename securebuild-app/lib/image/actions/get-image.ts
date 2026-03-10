"use server"

import { Session } from "@/lib/types/session";
import { getImage } from "../image";
import { Image } from "@/lib/types/image";

export async function getImageAction(sess: Session, id: string): Promise<Image> {
  const image = await getImage(id);
  return image;
}
