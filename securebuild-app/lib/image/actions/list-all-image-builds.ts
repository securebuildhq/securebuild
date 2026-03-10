"use server"

import { Session } from "@/lib/types/session";
import { listAllImageBuilds } from "../image";
import { ImageBuild } from "@/lib/types/image";

export async function listAllImageBuildsAction(sess: Session): Promise<ImageBuild[]> {
  try {
    const builds = await listAllImageBuilds();
    return builds;
  } catch (error) {
    console.error("Error listing all image builds:", error);
    throw error;
  }
} 