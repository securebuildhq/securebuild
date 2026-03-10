"use server"

import { CatalogItem } from "@/lib/types/catalog";
import { updateCatalogItem } from "../catalog";
import { Session } from "@/lib/types/session";
export async function updateCatalogItemAction(sess: Session, id: string, name: string, description: string, isActive: boolean, category: string, slug: string, imageUrl: string, isPartner: boolean, isAlternativeBuild: boolean, pricing: { monthly: number, yearly: number }, imageIds: string[]): Promise<CatalogItem> {
  const catalogItem = await updateCatalogItem(id, name, description, isActive, category, slug, imageUrl, isPartner, isAlternativeBuild, pricing, imageIds);
  return catalogItem;
}
