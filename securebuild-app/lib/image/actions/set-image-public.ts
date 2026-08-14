"use server";

import { getServerSession } from "@/lib/auth/server-session";

import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import { revalidatePath } from "next/cache";

export async function setImagePublic(imageId: string, isPublic: boolean) {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }


  const db = getDB(await getParam("DB_URI"));

  const query = `
    UPDATE image
    SET is_public = $2, updated_at = NOW()
    WHERE id = $1
  `;

  await db.query(query, [imageId, isPublic]);

  revalidatePath(`/images/${imageId}`);
}
