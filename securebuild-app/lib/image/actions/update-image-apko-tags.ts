"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { updateImageAPKOTags } from "../image"

export async function updateImageApkoTagsAction(imageId: string, apkoId: string, tags: string[]): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await updateImageAPKOTags(apkoId, tags)
}
