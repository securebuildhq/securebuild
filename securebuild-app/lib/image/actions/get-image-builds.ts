"use server"

import { Session } from "@/lib/types/session";
import { getImageBuildsByImageId } from "../image";
import { ImageBuild } from "@/lib/types/image";

export async function getImageBuildsAction(sess: Session, imageId: string): Promise<ImageBuild[]> {
  try {
    const builds = await getImageBuildsByImageId(imageId);
    return builds;
  } catch (error) {
    console.error("Error getting image builds:", error);
    throw error;
  }
} 