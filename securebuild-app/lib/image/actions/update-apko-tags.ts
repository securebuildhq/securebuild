"use server"

import { Session } from "@/lib/types/session";
import { updateImageAPKOTags } from "../image";

export async function updateImageApkoTagsAction(sess: Session, apkoId: string, tags: string[]): Promise<void> {
  await updateImageAPKOTags(apkoId, tags);
}
