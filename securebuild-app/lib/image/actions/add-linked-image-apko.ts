"use server"

import { Image } from "@/lib/types/image";
import { Session } from "@/lib/types/session";
import { addLinkedImageApko } from "../image";

export async function addLinkedImageApkoAction(session: Session, imageId: string, gitTag: string): Promise<Image> {
  if (!session?.user) {
    throw new Error("Unauthorized: Valid session required");
  }

  if (!imageId?.trim()) {
    throw new Error("Image ID is required");
  }

  if (!gitTag?.trim()) {
    throw new Error("Git tag is required");
  }

  return await addLinkedImageApko(imageId, gitTag.trim());
}
