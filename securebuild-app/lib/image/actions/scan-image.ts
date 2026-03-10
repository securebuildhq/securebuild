"use server"

import { Session } from "@/lib/types/session";
import { enqueueWork } from "@/lib/utils/queue";
import { getImage } from "../image";

export async function scanImageAction(sess: Session, id: string, option: "securebuild" | "canonical" | "both"): Promise<void> {
  await getImage(id);

  const payload = {
    imageId: id,
    includeSecureBuild: option === "securebuild" || option === "both",
    includeCanonical: option === "canonical" || option === "both",
  }
  await enqueueWork('scan_image', payload)
}