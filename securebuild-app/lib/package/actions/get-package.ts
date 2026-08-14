"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getPackage } from "../package";
import { Package } from "@/lib/types/package";

export async function getPackageAction(id: string): Promise<Package> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const pkg = await getPackage(id);
  return pkg;
}