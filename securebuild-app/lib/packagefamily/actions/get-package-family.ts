"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { PackageFamilyWithPackages } from "@/lib/types/packagefamily";
import { getPackageFamilyWithPackages } from "../packagefamily";

export async function getPackageFamilyAction(id: string): Promise<PackageFamilyWithPackages | null> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // TODO: Add session validation when implemented
  return await getPackageFamilyWithPackages(id);
}