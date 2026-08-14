"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { deleteImageApko } from "../image"

export async function removeImageApkoAction(apkoId: string): Promise<void> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // TODO: check if user in session is allowed to delete this
  await deleteImageApko(apkoId);
}
