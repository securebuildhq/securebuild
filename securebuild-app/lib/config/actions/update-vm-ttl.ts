"use server";

import { Session } from "@/lib/types/session";
import { setVMTTLDuration } from "../config";

export interface UpdateVMTTLResult {
  success: boolean;
  vmTTLDuration: string;
}

export async function updateVMTTLAction(
  session: Session,
  vmTTLDuration: string
): Promise<UpdateVMTTLResult> {
  await setVMTTLDuration(vmTTLDuration);

  return {
    success: true,
    vmTTLDuration
  };
}
