"use client"

import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { ChevronRight } from "lucide-react"
import { useEffect, useState } from "react"
import { listCatalogItemsAction } from "@/lib/catalog/actions/list-catalog-items"
import { CatalogItem } from "@/lib/types/catalog"
import { Subscription } from "@/lib/types/subscription"
import { CatalogItemCard } from "../components/CatalogItemCard"
import { CatalogItemCardSkeleton } from "../components/CatalogItemCardSkeleton"
import { useSession } from "../hooks/use-session"
import { listTeamSubscriptionsAction } from "@/lib/team/actions/list-subscriptions"
import Navbar from "@/components/navbar"

export default function ImagesPage() {
  const { session } = useSession();

  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        let finalCatalogItems: CatalogItem[] = []

        if (session) {
          const [allItems, userSubscriptions] = await Promise.all([
            listCatalogItemsAction(session),
            listTeamSubscriptionsAction(session)
          ])

          setSubscriptions(userSubscriptions)
          finalCatalogItems = allItems
        } else {
          finalCatalogItems = await listCatalogItemsAction(undefined)
        }

        // Sort items so partners appear first
        const sortedItems = finalCatalogItems.sort((a, b) => {
          // Partners first (true sorts before false)
          if (a.isPartner && !b.isPartner) return -1
          if (!a.isPartner && b.isPartner) return 1
          // If both are partners or both are not, maintain original order
          return 0
        })
        setCatalogItems(sortedItems)
      } catch {
        // Consider how to handle errors, e.g., show an error message
        // For now, it will just stop loading and show an empty state if items is empty
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [session])

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <Navbar />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="w-full pt-12 bg-linear-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="flex flex-col items-center justify-center space-y-4 text-center">
              <div className="space-y-2">
                <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">SecureBuild Catalog</h1>
                <p className="max-w-[700px] text-muted-foreground md:text-xl">
                  Browse our catalog of secure, vulnerability-free builds for popular open source projects.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Projects Grid */}
        <section className="w-full py-12 md:py-24">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {loading
                ? Array.from({ length: 12 }).map((_, index) => (
                    <CatalogItemCardSkeleton key={`skeleton-${index}`} />
                  ))
                : catalogItems.map((catalogItem) => (
                    <CatalogItemCard key={catalogItem.id} project={catalogItem} />
                  ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="w-full py-12 md:py-24 bg-teal-600 text-white">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="flex flex-col items-center justify-center space-y-4 text-center">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Don&apos;t see your project?</h2>
                <p className="max-w-[600px] md:text-xl">
                  We&apos;re constantly adding new projects to our secure builds catalog. Contact us to request a 
                  SecureBuild for your project.
                </p>
              </div>
              <div className="flex flex-col gap-2 min-[400px]:flex-row">
                <Link href="/partner">
                  <Button className="bg-white text-black hover:bg-gray-100">
                    Partner With Us
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/enterprise">
                  <Button className="bg-black text-white hover:bg-gray-800">
                    Contact Sales
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full py-6 md:py-12 bg-gray-100 dark:bg-gray-800">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
          <div className="flex flex-col items-center justify-center space-y-4 text-center">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
              <span className="text-xl font-bold">SecureBuild</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} SecureBuild. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
