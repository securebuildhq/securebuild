"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Image } from "@/lib/types/image";
import { updateImageAPKOYaml } from "../image";

export async function updateImageApkoYamlAction(imageId: string, apkoId: string, yaml: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await updateImageAPKOYaml(imageId, apkoId, yaml);
}