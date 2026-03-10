"use server"

import { CatalogItem } from "@/lib/types/catalog";
import { Session } from "@/lib/types/session";
import { listFeaturedCatalogItems } from "../catalog";

export async function listFeaturedCatalogItemsAction(sess: Session): Promise<CatalogItem[]> {
  const catalogItems = await listFeaturedCatalogItems();
  return catalogItems;
}