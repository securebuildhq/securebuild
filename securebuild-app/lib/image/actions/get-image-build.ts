"use server"

import { Session } from "@/lib/types/session";
import { getImageBuild } from "../image";
import { ImageBuild } from "@/lib/types/image";

export async function getImageBuildAction(sess: Session, buildId: string): Promise<ImageBuild | null> {
  try {
    const build = await getImageBuild(buildId);
    return build;
  } catch (error) {
    console.error("Error getting image build:", error);
    throw error;
  }
} 