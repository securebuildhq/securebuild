"use server"

import { CatalogItem } from "@/lib/types/catalog";
import { Session } from "@/lib/types/session";
import { createCatalogItem } from "../catalog";

export async function createCatalogItemAction(sess: Session, name: string, description: string, isActive: boolean, category: string, slug: string, imageUrl: string, isPartner: boolean, isAlternativeBuild: boolean, pricing: { monthly: number, yearly: number }, imageIds: string[]): Promise<CatalogItem> {
  const catalogItem = await createCatalogItem(name, description, isActive, category, slug, imageUrl, isPartner, isAlternativeBuild, pricing, imageIds);
  return catalogItem;
}
