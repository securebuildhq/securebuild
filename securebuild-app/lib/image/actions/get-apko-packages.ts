"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { getAPKOPackages } from "../image";

export interface APKOPackage {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getAPKOPackagesAction(apkoId: string): Promise<APKOPackage[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const packages = await getAPKOPackages(apkoId);
  return packages;
}