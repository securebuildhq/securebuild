"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { enqueueWork } from "@/lib/utils/queue";
import { getImage } from "../image";

export async function scanImageAction(id: string, option: "securebuild" | "canonical" | "both"): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await getImage(id);

  const payload = {
    imageId: id,
    includeSecureBuild: option === "securebuild" || option === "both",
    includeCanonical: option === "canonical" || option === "both",
  }
  await enqueueWork('scan_image', payload)
}