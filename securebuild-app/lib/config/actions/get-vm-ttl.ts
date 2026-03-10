"use server";

import { Session } from "@/lib/types/session";
import { getVMTTLDuration } from "../config";

export interface GetVMTTLResult {
  vmTTLDuration: string;
}

export async function getVMTTLAction(session: Session): Promise<GetVMTTLResult> {
  const vmTTLDuration = await getVMTTLDuration();
  return { vmTTLDuration };
}

