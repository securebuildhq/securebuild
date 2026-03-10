"use server"

import { CatalogItem } from "@/lib/types/catalog";
import { Session } from "@/lib/types/session";
import { listCatalogItems } from "../catalog";

export async function listCatalogItemsAction(sess: Session): Promise<CatalogItem[]> {
  const catalogItems = await listCatalogItems();
  return catalogItems;
}