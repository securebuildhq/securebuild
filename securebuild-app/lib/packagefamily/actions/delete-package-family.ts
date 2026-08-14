"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { deletePackageFamily } from "../packagefamily";

export async function deletePackageFamilyAction(id: string): Promise<boolean> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // TODO: Add session validation when implemented
  return await deletePackageFamily(id);
}