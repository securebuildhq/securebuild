'use server';

import { revalidatePath } from 'next/cache';
import { Session } from '@/lib/types/session';
import {
  getTeamCustomBuildImages,
  addTeamCustomBuildImage,
  removeTeamCustomBuildImage,
  getAllImages
} from '../custom-build-images';

/**
 * Server action to get team's custom build images
 */
export async function getTeamCustomBuildImagesAction(session: Session, teamId: string) {
  try {
    if (!session) {
      return { success: false, error: 'Not authenticated' };
    }

    const images = await getTeamCustomBuildImages(teamId);
    return { success: true, images };
  } catch (error) {
    console.error('Error in getTeamCustomBuildImagesAction:', error);
    return { success: false, error: 'Failed to fetch custom build images' };
  }
}

/**
 * Server action to add a custom build image for a team
 */
export async function addTeamCustomBuildImageAction(session: Session, teamId: string, imageName: string) {
  try {
    if (!session) {
      return { success: false, error: 'Not authenticated' };
    }

    await addTeamCustomBuildImage(teamId, imageName);
    revalidatePath(`/teams/${teamId}`);
    return { success: true };
  } catch (error) {
    console.error('Error in addTeamCustomBuildImageAction:', error);
    return { success: false, error: 'Failed to add custom build image' };
  }
}

/**
 * Server action to remove a custom build image for a team
 */
export async function removeTeamCustomBuildImageAction(session: Session, teamId: string, imageName: string) {
  try {
    if (!session) {
      return { success: false, error: 'Not authenticated' };
    }

    await removeTeamCustomBuildImage(teamId, imageName);
    revalidatePath(`/teams/${teamId}`);
    return { success: true };
  } catch (error) {
    console.error('Error in removeTeamCustomBuildImageAction:', error);
    return { success: false, error: 'Failed to remove custom build image' };
  }
}

/**
 * Server action to get all available images
 */
export async function getAllImagesAction(session: Session) {
  try {
    if (!session) {
      return { success: false, error: 'Not authenticated' };
    }

    const images = await getAllImages();
    return { success: true, images };
  } catch (error) {
    console.error('Error in getAllImagesAction:', error);
    return { success: false, error: 'Failed to fetch images' };
  }
}
