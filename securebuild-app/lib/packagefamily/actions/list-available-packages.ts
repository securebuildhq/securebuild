"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { listPackagesAction } from "@/lib/package/actions/list-packages";

export interface AvailablePackage {
  id: string;
  name: string;
  lastVersion: string;
  createdAt: Date;
}

export async function listAvailablePackagesAction(): Promise<AvailablePackage[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  // Get all packages and filter out ones already in families
  const filters = {
    search: "",
    type: "",
    status: "",
    source: "",
    fips: "",
    arch: ""
  };
  const allPackages = await listPackagesAction(filters, { page: 1, limit: 1000 });
  
  // For now, return all packages. In the future, we could filter out packages already in families
  return allPackages.packages.map(pkg => ({
    id: pkg.id,
    name: pkg.name,
    lastVersion: pkg.lastVersion,
    createdAt: pkg.createdAt,
  }));
}
