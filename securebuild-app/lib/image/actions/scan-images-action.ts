"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { listImages } from "../image";
import { enqueueWork } from "@/lib/utils/queue";

export async function scanImagesAction(): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

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