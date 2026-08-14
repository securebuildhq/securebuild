"use server"

import { Package } from "@/lib/types/package";
import { getServerSession } from "@/lib/auth/server-session";
import { listPackages, countPackages, PackageFilters, PaginationOptions } from "../package";
import { traceServerAction } from "@/lib/observability/tracing";

export interface PackageListResult {
  packages: Package[];
  totalCount: number;
}

async function listPackagesActionImpl(filters: PackageFilters, pagination: PaginationOptions): Promise<PackageListResult> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const [packages, totalCount] = await Promise.all([
    listPackages(filters, pagination),
    countPackages(filters)
  ]);

  return {
    packages,
    totalCount
  };
}

export const listPackagesAction = traceServerAction('listPackagesAction', listPackagesActionImpl);
