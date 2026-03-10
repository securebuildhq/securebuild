"use server"

import { Session } from "@/lib/types/session";
import { CatalogItem } from "@/lib/types/catalog";
import { getCatalogItem } from "../catalog";

export async function getCatalogItemAction(sess: Session, id: string): Promise<CatalogItem> {
  const catalogItem = await getCatalogItem(id);
  return catalogItem;
}
