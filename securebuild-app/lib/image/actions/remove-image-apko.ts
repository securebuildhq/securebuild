"use server"

import { Session } from "@/lib/types/session"
import { deleteImageApko } from "../image"

export async function removeImageApkoAction(session: Session, apkoId: string): Promise<void> {
  // TODO: check if user in session is allowed to delete this
  await deleteImageApko(apkoId);
}
