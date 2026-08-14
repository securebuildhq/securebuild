"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Image } from "@/lib/types/image";
import { addLinkedImageApko } from "../image";

export async function addLinkedImageApkoAction(imageId: string, gitTag: string): Promise<Image> {
  const session = await getServerSession();
  if (!session) {
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
