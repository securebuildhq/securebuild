"use server"

import { Session } from "@/lib/types/session";
import { deletePackageFamily } from "../packagefamily";

export async function deletePackageFamilyAction(session: Session, id: string): Promise<boolean> {
  // TODO: Add session validation when implemented
  return await deletePackageFamily(id);
}