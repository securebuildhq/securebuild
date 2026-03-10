"use server"

import { Session } from "@/lib/types/session";
import { deleteImage } from "../image";

export async function deleteImageAction(sess: Session, id: string): Promise<void> {
  await deleteImage(id);
  return;
}