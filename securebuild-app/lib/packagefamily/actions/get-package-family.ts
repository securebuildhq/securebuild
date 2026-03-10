"use server"

import { Session } from "@/lib/types/session";
import { PackageFamilyWithPackages } from "@/lib/types/packagefamily";
import { getPackageFamilyWithPackages } from "../packagefamily";

export async function getPackageFamilyAction(session: Session, id: string): Promise<PackageFamilyWithPackages | null> {
  // TODO: Add session validation when implemented
  return await getPackageFamilyWithPackages(id);
}