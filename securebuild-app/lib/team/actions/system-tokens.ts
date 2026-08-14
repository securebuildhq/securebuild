"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { SystemServiceAccount, SystemServiceAccountWithValue, createSystemAccount, listSystemAccounts } from "../service-account"

export async function createSystemTokenAction(name: string, expiresIn: string): Promise<SystemServiceAccountWithValue> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return createSystemAccount(name, expiresIn)
}

export async function listSystemTokensAction(): Promise<SystemServiceAccount[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  return listSystemAccounts()
}
