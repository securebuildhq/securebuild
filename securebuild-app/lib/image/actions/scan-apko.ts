"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { enqueueWork } from "@/lib/utils/queue";
import { getImage, getImageAPKO } from "../image";

export async function scanImageApkoAction(imageId: string, apkoId: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
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
