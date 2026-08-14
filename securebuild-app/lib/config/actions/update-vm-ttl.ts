"use server";

import { getServerSession } from "@/lib/auth/server-session";

import { setVMTTLDuration } from "../config";

export interface UpdateVMTTLResult {
  success: boolean;
  vmTTLDuration: string;
}

export async function updateVMTTLAction(
  vmTTLDuration: string
): Promise<UpdateVMTTLResult> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  await setVMTTLDuration(vmTTLDuration);

  return {
    success: true,
    vmTTLDuration
  };
}
