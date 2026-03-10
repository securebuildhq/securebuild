"use server"

import { Session } from "@/lib/types/session";
import { deleteBuilder } from "../builder";

export async function deleteBuilderAction(sess: Session, id: string): Promise<void> {
  await deleteBuilder(id)
}
