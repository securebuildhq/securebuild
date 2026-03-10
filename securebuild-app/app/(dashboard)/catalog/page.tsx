"use client"

import { useState, useEffect } from "react"

import { Button } from "@/components/ui/button"
import { Plus, Star } from "lucide-react"
import Link from "next/link"
import { CatalogTable } from "@/components/catalog-table"
import { useSession } from "@/app/hooks/use-session"
import { CatalogItem } from "@/lib/types/catalog"
import { listCatalogItemsAction } from "@/lib/catalog/actions/list-catalog-items"
import { FeaturedItemsModal } from "@/components/featured-items-modal"
import { setFeaturedCatalogItemsAction } from "@/lib/catalog/actions/set-featured-catalog-items"
import { listFeaturedCatalogItemsAction } from "@/lib/catalog/actions/list-featured-catalog-items"

export default function CatalogPage() {
  const { session, isSessionLoading } = useSession()
  const [loading, setLoading] = useState(true)
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [isFeaturedModalOpen, setIsFeaturedModalOpen] = useState(false)
  const [featuredItems, setFeaturedItems] = useState<CatalogItem[]>([])

  useEffect(() => {
    if (!session) {
      return;
    }

    const doListCatalogItems = async () => {
      setLoading(true)
      const fetchedFeaturedCatalogItems = await listFeaturedCatalogItemsAction(session)
      setFeaturedItems(fetchedFeaturedCatalogItems)
      const fetchedCatalogItems = await listCatalogItemsAction(session)
      setCatalogItems(fetchedCatalogItems)
      setLoading(false)
    }

    doListCatalogItems()
  }, [session]);

  const handleSaveFeaturedItems = async (featuredItemIds: string[]) => {
    if (!session) {
      console.error("No session available to save featured items.")
      return
    }
    try {
      await setFeaturedCatalogItemsAction(session, featuredItemIds)
      console.log("Featured items saved successfully!")
    } catch (error) {
      console.error("Failed to save featured items:", error)
    }
  }

  // Session is handled by the dashboard layout
  if (!session || !session?.user || isSessionLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading catalog...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
                <div>Loading catalog...</div>
              </div>
            </div>
          ) : (
            <>
          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
            <div>
              <h1 className="text-3xl font-bold">Catalog</h1>
              <p className="text-muted-foreground">View, create, and manage all packages in the catalog</p>
            </div>
            <div className="inline-flex items-center">
              <Button
                variant="outline"
                className="mr-2"
                onClick={() => setIsFeaturedModalOpen(true)}
              >
                <Star className="mr-2 h-4 w-4" />
                Manage Featured Items
              </Button>
              <Button asChild>
                <Link href="/catalog/new" className="flex items-center">
                  <Plus className="mr-2 h-4 w-4" />
                  New Catalog Item
                </Link>
              </Button>
            </div>
          </div>
          <CatalogTable catalogItems={catalogItems} />
            </>
          )}
      <FeaturedItemsModal
        isOpen={isFeaturedModalOpen}
        onOpenChange={setIsFeaturedModalOpen}
        catalogItems={catalogItems}
        currentFeaturedItems={featuredItems}
        onSave={handleSaveFeaturedItems}
      />
    </div>
  )
}
