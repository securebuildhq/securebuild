
"use server"

import { getSession } from "../auth/session";
import { checkTeamFeatureFlag, FEATURE_FLAGS } from "../auth/feature-flags";

/**
 * Check if the current team has access to custom packages feature
 */
export async function hasCustomPackages(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.selectedTeamId) {
      return false;
    }

    // Check if the team has the custom-melange-upload feature flag enabled
    return await checkTeamFeatureFlag(session.selectedTeamId, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);
  } catch (error) {
    console.error('Error checking custom packages feature flag:', error);
    return false;
  }
}