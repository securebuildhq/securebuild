"use server"

import { Package } from "@/lib/types/package";
import { Session } from "@/lib/types/session";
import { listPackages, countPackages, PackageFilters, PaginationOptions } from "../package";
import { traceServerAction } from "@/lib/observability/tracing";

export interface PackageListResult {
  packages: Package[];
  totalCount: number;
}

async function listPackagesActionImpl(sess: Session, filters: PackageFilters, pagination: PaginationOptions): Promise<PackageListResult> {
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
