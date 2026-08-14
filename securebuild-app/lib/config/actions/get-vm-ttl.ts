"use server";

import { getServerSession } from "@/lib/auth/server-session";

import { getVMTTLDuration } from "../config";

export interface GetVMTTLResult {
  vmTTLDuration: string;
}

export async function getVMTTLAction(): Promise<GetVMTTLResult> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const vmTTLDuration = await getVMTTLDuration();
  return { vmTTLDuration };
}

