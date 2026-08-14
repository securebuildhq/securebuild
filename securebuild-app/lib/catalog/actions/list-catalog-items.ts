"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { CatalogItem } from "@/lib/types/catalog";
import { listCatalogItems } from "../catalog";

export async function listCatalogItemsAction(): Promise<CatalogItem[]> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const catalogItems = await listCatalogItems();
  return catalogItems;
}