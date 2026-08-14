"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { listAllImageBuilds } from "../image";
import { ImageBuild } from "@/lib/types/image";

export async function listAllImageBuildsAction(): Promise<ImageBuild[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  try {
    const builds = await listAllImageBuilds();
    return builds;
  } catch (error) {
    console.error("Error listing all image builds:", error);
    throw error;
  }
} 