"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { deleteImage } from "../image";

export async function deleteImageAction(id: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await deleteImage(id);
  return;
}