"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { CatalogItem } from "@/lib/types/catalog";
import { getCatalogItem } from "../catalog";

export async function getCatalogItemAction(id: string): Promise<CatalogItem> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const catalogItem = await getCatalogItem(id);
  return catalogItem;
}
