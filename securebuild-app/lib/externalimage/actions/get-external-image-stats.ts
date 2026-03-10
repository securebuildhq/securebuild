"use server";

import { Session } from "@/lib/types/session";
import { getExternalImageStats, ExternalImageStats } from "../externalimage";

export async function getExternalImageStatsAction(sess: Session): Promise<ExternalImageStats> {
  // Validate session
  if (!sess?.user) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await getExternalImageStats();
}