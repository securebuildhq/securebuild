"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getImageBuildsByImageId } from "../image";
import { ImageBuild } from "@/lib/types/image";

export async function getImageBuildsAction(imageId: string): Promise<ImageBuild[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  try {
    const builds = await getImageBuildsByImageId(imageId);
    return builds;
  } catch (error) {
    console.error("Error getting image builds:", error);
    throw error;
  }
} 