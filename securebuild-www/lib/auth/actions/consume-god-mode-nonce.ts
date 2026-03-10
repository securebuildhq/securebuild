"use server"

import { Session } from "@/lib/types/session";
import { consumeGodModeNonce } from "../god";
import { addGodModeTeamToSession, sessionToken } from "@/lib/user/session";
import { traceServerAction } from "@/lib/observability/tracing";

async function consumeGodModeNonceActionImpl(sess: Session, nonce: string): Promise<string> {
  const team = await consumeGodModeNonce(nonce);

  const updatedSession = await addGodModeTeamToSession(sess.id, team.id);
  return sessionToken(updatedSession);
}

export const consumeGodModeNonceAction = traceServerAction('consumeGodModeNonceAction', consumeGodModeNonceActionImpl);