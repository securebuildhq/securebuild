"use server"

import { Session } from "@/lib/types/session";
import { enqueueWork } from "@/lib/utils/queue";
import { getImage, getImageAPKO } from "../image";

export async function scanImageApkoAction(sess: Session, imageId: string, apkoId: string): Promise<void> {
  if (!sess || !sess.id) {
    throw new Error("Unauthorized: Invalid session");
  }

  const image = await getImage(imageId);
  if (!image) throw new Error("Image not found");

  const apko = await getImageAPKO(apkoId);
  if (!apko) throw new Error("APKO configuration not found");

  const imageApkos = image.apkos || [];
  const apkoBelongsToImage = imageApkos.some(a => a.id === apkoId);
  if (!apkoBelongsToImage) throw new Error("APKO configuration does not belong to this image");

  // Get the first tag from the APKO configuration
  const imageTag = apko.tags && apko.tags.length > 0 ? apko.tags[0] : undefined;

  const payload = {
    imageId: imageId,
    scanType: "build",
    includeSecurebuild: true,
    includeCanonical: false,
    imageTag: imageTag,
  };

  await enqueueWork('scan_image', payload);
}
