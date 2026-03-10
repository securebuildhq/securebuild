"use server"

import { Session } from "@/lib/types/session";
import { enqueueWork } from "@/lib/utils/queue";
import { getImage, getImageAPKO } from "../image";

export async function buildImageApkoAction(sess: Session, imageId: string, apkoId: string): Promise<void> {
  if (!sess || !sess.id) {
    throw new Error("Unauthorized: Invalid session");
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