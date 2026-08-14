"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getImageBuild } from "../image";
import { ImageBuild } from "@/lib/types/image";

export async function getImageBuildAction(buildId: string): Promise<ImageBuild | null> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  try {
    const build = await getImageBuild(buildId);
    return build;
  } catch (error) {
    console.error("Error getting image build:", error);
    throw error;
  }
} 