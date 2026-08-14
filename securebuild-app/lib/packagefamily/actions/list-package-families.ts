"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { PackageFamily } from "@/lib/types/packagefamily";
import { listPackageFamilies } from "../packagefamily";

export async function listPackageFamiliesAction(): Promise<PackageFamily[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // TODO: Add session validation when implemented
  return await listPackageFamilies();
}