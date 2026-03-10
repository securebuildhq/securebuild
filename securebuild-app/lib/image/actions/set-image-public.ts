"use server";

import { getDB } from "@/lib/data/db";
import { getParam } from "@/lib/data/param";
import { Session } from "@/lib/types/session";
import { revalidatePath } from "next/cache";

export async function setImagePublic(sess: Session, imageId: string, isPublic: boolean) {
  // Validate session
  if (!sess?.user) {
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
