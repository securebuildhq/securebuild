"use server"

import { Session } from "@/lib/types/session"
import { SystemServiceAccount, SystemServiceAccountWithValue, createSystemAccount, listSystemAccounts } from "../service-account"

export async function createSystemTokenAction(sess: Session, name: string, expiresIn: string): Promise<SystemServiceAccountWithValue> {
  return createSystemAccount(name, expiresIn)
}

export async function listSystemTokensAction(sess: Session): Promise<SystemServiceAccount[]> {
  return listSystemAccounts()
}
