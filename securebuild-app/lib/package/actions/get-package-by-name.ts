"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { Package } from "@/lib/types/package";
import { getPackageByName as getPackageByNameDB } from "../package";
import { ValidationError } from "@/lib/errors/validation-error";

export async function getPackageByNameAction(
  name: string
): Promise<Package> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }


  // Get package by name
  return getPackageByNameDB(name);
}
