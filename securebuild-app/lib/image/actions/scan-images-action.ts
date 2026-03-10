"use server"

import { Session } from "@/lib/types/session";
import { listImages } from "../image";
import { enqueueWork } from "@/lib/utils/queue";

export async function scanImagesAction(sess: Session): Promise<void> {
  const images = await listImages();
  for (const image of images) {
    const payload = {
      imageId: image.id,
      includeSecureBuild: true,
      includeCanonical: true,
    }
    await enqueueWork('scan_image', payload)
  }
}