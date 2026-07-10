"use server"

import { Session } from "@/lib/types/session"
import { deleteSystemAccount } from "../service-account"

export async function deleteSystemTokenAction(sess: Session, id: string): Promise<void> {
  if (!sess?.user) {
    throw new Error("Unauthorized: Valid session required")
  }
  return deleteSystemAccount(id)
}
