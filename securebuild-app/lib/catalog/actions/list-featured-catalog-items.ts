"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { CatalogItem } from "@/lib/types/catalog";
import { listFeaturedCatalogItems } from "../catalog";

export async function listFeaturedCatalogItemsAction(): Promise<CatalogItem[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const catalogItems = await listFeaturedCatalogItems();
  return catalogItems;
}