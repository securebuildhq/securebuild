"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Package } from "@/lib/types/package";
import { tryGetPackageByName as tryGetPackageByNameDB } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function tryGetPackageByNameAction(
  name: string
): Promise<Package | null> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }


  // Try to get package by name
  return tryGetPackageByNameDB(name);
}
