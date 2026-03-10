"use server"

import { CatalogItem } from "@/lib/types/catalog";
import { listFeaturedCatalogItems } from "../catalog";
import { traceServerAction } from "@/lib/observability/tracing";

async function listFeaturedCatalogItemsActionImpl(): Promise<CatalogItem[]> {
  const featuredItems = await listFeaturedCatalogItems();
  return featuredItems;
}

export const listFeaturedCatalogItemsAction = traceServerAction('listFeaturedCatalogItemsAction', listFeaturedCatalogItemsActionImpl);