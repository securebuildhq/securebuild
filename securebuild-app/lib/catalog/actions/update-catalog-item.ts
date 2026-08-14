"use server"

import { getServerSession } from "@/lib/auth/server-session";

import { CatalogItem } from "@/lib/types/catalog";
import { updateCatalogItem } from "../catalog";
export async function updateCatalogItemAction(id: string, name: string, description: string, isActive: boolean, category: string, slug: string, imageUrl: string, isPartner: boolean, isAlternativeBuild: boolean, pricing: { monthly: number, yearly: number }, imageIds: string[]): Promise<CatalogItem> {
  const session = await getServerSession();
  if (!session) {
    throw new Error("Unauthorized: Valid session required");
  }

  const catalogItem = await updateCatalogItem(id, name, description, isActive, category, slug, imageUrl, isPartner, isAlternativeBuild, pricing, imageIds);
  return catalogItem;
}
