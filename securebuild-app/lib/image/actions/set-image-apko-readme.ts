"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { ImageAPKO } from "@/lib/types/image";
import { setImageApkoReadme } from "../image";

export async function setImageApkoReadmeAction(apkoId: string, readme: string): Promise<ImageAPKO> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return await setImageApkoReadme(apkoId, readme);
}