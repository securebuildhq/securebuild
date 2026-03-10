"use server"

import { Session } from "@/lib/types/session";
import { createGodModeNonce } from "../god";

export async function createGodModeNonceAction(sess: Session, teamId: string): Promise<string> {
  return await createGodModeNonce(teamId, sess.user.id);
}