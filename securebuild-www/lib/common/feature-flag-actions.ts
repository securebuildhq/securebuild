"use server"

import { getSession } from "../auth/session";
import { checkTeamFeatureFlag, FEATURE_FLAGS } from "../auth/feature-flags";

/**
 * Check if custom packages feature is enabled for the current team
 */
export async function checkCustomPackagesEnabled(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.selectedTeamId) {
      return false;
    }

    return await checkTeamFeatureFlag(session.selectedTeamId, FEATURE_FLAGS.CUSTOM_MELANGE_UPLOAD);
  } catch (error) {
    console.error('Error checking custom packages feature flag:', error);
    return false;
  }
}

/**
 * Check if custom images feature is enabled for the current team
 */
export async function checkCustomImagesEnabled(): Promise<boolean> {
  try {
    const session = await getSession();
    if (!session?.selectedTeamId) {
      return false;
    }

    return await checkTeamFeatureFlag(session.selectedTeamId, FEATURE_FLAGS.CUSTOM_APKO_UPLOAD);
  } catch (error) {
    console.error('Error checking custom images feature flag:', error);
    return false;
  }
}