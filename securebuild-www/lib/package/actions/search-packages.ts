"use server"

import { searchPackages, PackageSearchResult } from "../package";
import { logger } from "@/lib/utils/logger";
import { traceServerAction } from "@/lib/observability/tracing";

export interface SearchPackagesRequest {
  search?: string;
  page?: number;
  pageSize?: number;
  sortField?: 'name' | 'version' | 'updated';
  sortOrder?: 'asc' | 'desc';
}

async function searchPackagesActionImpl(
  request: SearchPackagesRequest
): Promise<PackageSearchResult> {
  try {
    logger.info("Searching packages", { request });

    const result = await searchPackages({
      search: request.search,
      page: request.page || 1,
      pageSize: request.pageSize || 10,
      sortField: request.sortField || 'name',
      sortOrder: request.sortOrder || 'asc'
    });

    return result;
  } catch (error) {
    logger.error("Error in searchPackagesAction", error, { request });
    throw error;
  }
}

export const searchPackagesAction = traceServerAction('searchPackagesAction', searchPackagesActionImpl);
