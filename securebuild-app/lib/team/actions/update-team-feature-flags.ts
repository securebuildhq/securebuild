"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { updateTeamFeatureFlags } from "../team";

export async function updateTeamFeatureFlagsAction(teamId: string, featureFlags: string[]): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await updateTeamFeatureFlags(teamId, featureFlags);
}