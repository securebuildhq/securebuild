"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { enqueueWork } from "@/lib/utils/queue";
import { getImage, getImageAPKO } from "../image";

export async function buildImageApkoAction(imageId: string, apkoId: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // Verify the image exists
  const image = await getImage(imageId);
  if (!image) {
    throw new Error("Image not found");
  }

  // Verify the APKO exists and belongs to this image
  const apko = await getImageAPKO(apkoId);
  if (!apko) {
    throw new Error("APKO configuration not found");
  }

  // Verify the APKO belongs to this image
  const imageApkos = image.apkos || [];
  const apkoBelongsToImage = imageApkos.some(a => a.id === apkoId);
  if (!apkoBelongsToImage) {
    throw new Error("APKO configuration does not belong to this image");
  }

  await enqueueWork('build_apko', {
    imageId: imageId,
    apkoId: apkoId
  })
}
