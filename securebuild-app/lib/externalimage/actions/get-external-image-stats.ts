"use server";

import { getServerSession } from "@/lib/auth/server-session";

import { getExternalImageStats, ExternalImageStats } from "../externalimage";

export async function getExternalImageStatsAction(): Promise<ExternalImageStats> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }


  return await getExternalImageStats();
}