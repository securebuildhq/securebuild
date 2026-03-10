"use server"

import { Session } from "@/lib/types/session";
import { updateTeamFeatureFlags } from "../team";

export async function updateTeamFeatureFlagsAction(sess: Session, teamId: string, featureFlags: string[]): Promise<void> {
  await updateTeamFeatureFlags(teamId, featureFlags);
}