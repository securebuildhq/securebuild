"use server"

import { Session } from "@/lib/types/session"
import { deleteSystemAccount } from "../service-account"

export async function deleteSystemTokenAction(sess: Session, id: string): Promise<void> {
  return deleteSystemAccount(id)
}
