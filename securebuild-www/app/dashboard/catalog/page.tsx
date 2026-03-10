"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { Shield, CheckCircle2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

import { listCatalogItemsAction } from "@/lib/catalog/actions/list-catalog-items"
import { CatalogItem } from "@/lib/types/catalog"
import { Subscription } from "@/lib/types/subscription"
import { useSession } from "@/app/hooks/use-session"
import { listTeamSubscriptionsAction } from "@/lib/team/actions/list-subscriptions"


export default function CatalogPage() {
  const { session } = useSession();
  const [allCatalogItems, setAllCatalogItems] = useState<CatalogItem[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [catalogItemsLoading, setCatalogItemsLoading] = useState(true)
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(true)

  useEffect(() => {
    const fetchCatalogItems = async () => {
      setCatalogItemsLoading(true)
      try {
        if (session) {
          const allItems = await listCatalogItemsAction(session)
          setAllCatalogItems(allItems)
        } else {
          const allItems = await listCatalogItemsAction(undefined)
          setAllCatalogItems(allItems)
        }
      } catch (error) {
        console.error("Failed to fetch catalog items:", error)
      } finally {
        setCatalogItemsLoading(false)
      }
    }

    const fetchSubscriptions = async () => {
      setSubscriptionsLoading(true)
      try {
        if (session) {
          const subs = await listTeamSubscriptionsAction(session)
          setSubscriptions(subs)
        } else {
          setSubscriptions([]) // No subscriptions for non-authenticated users
        }
      } catch (error) {
        console.error("Failed to fetch subscriptions:", error)
      } finally {
        setSubscriptionsLoading(false);
      }
    }

    fetchCatalogItems()
    fetchSubscriptions()
  }, [session])

  // Subscribed images
  const orgImages = allCatalogItems.filter((item) =>
    subscriptions.some((sub) => sub.catalogItem?.id === item.id)
  )

  // Available images: all items excluding already subscribed ones
  const remainingCatalogItems = allCatalogItems.filter((item) =>
    !subscriptions.some((sub) => sub.catalogItem?.id === item.id)
  )

  const isLoading = catalogItemsLoading || subscriptionsLoading;

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">SecureBuild Catalog</h1>
          <p className="text-muted-foreground mt-1">Browse and subscribe to SecureBuild images</p>
        </div>

        <div>
          {isLoading && (
            <div className="flex items-center mb-4">
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          )}

          {!isLoading && (
            <>
              <div className="flex items-center mb-4">
                <span className="text-sm text-muted-foreground">Showing {orgImages.length + remainingCatalogItems.length} images</span>
              </div>

              {/* Organization Images Section */}
              {orgImages.length > 0 && (
                <div className="mb-8">
                  <div className="mb-4">
                    <h2 className="text-xl font-semibold">Your Organization Images</h2>
                    <p className="text-sm text-muted-foreground">Images your organization is currently subscribed to</p>
                  </div>
                  <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-w-6xl">
                    {orgImages.map((item) => {
                      return (
                        <Card key={item.id} className="flex flex-col hover:shadow-md transition-shadow border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
                          <Link href={`/dashboard/images/${item.slug}`} className="flex flex-col grow">
                            <CardHeader className="pb-2">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex items-start gap-3">
                                  {/* GitHub Avatar */}
                                  {item.imageUrl ? (
                                    <div className="h-10 w-10 rounded-md overflow-hidden shrink-0">
                                      <Image
                                        src={item.imageUrl || "/placeholder.svg"}
                                        alt={`${item.name} logo`}
                                        width={40}
                                        height={40}
                                        className="object-cover"
                                      />
                                    </div>
                                  ) : (
                                    <div className="h-10 w-10 rounded-md bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-500 shrink-0">
                                      {item.name.charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <div>
                                    <CardTitle className="text-base">{item.name}</CardTitle>
                                    <Badge variant="outline" className="mt-1">
                                      {item.category}
                                    </Badge>
                                  </div>
                                </div>
                                <Badge
                                  className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-1 shrink-0"
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Subscribed
                                </Badge>
                              </div>
                            </CardHeader>
                            <CardContent className="py-2 grow">
                              <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                              <div className="grid grid-cols-2 gap-2 mt-3">
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Price</span>
                                  <span className="text-sm font-medium">${item.pricing.monthly}/mo</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Fixed CVEs</span>
                                  <span className="text-sm font-medium">{item.cvesFixedCount}</span>
                                </div>
                              </div>
                            </CardContent>
                          </Link>
                          <CardFooter className="pt-2 border-t">
                            <Button variant="outline" size="sm" className="w-full" asChild>
                              <Link href={`/dashboard/images/${item.slug}`}>
                                <Shield className="mr-1 h-4 w-4" />
                                View Details
                              </Link>
                            </Button>
                          </CardFooter>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Available Images Section */}
              {remainingCatalogItems.length > 0 && (
                <div>
                  <div className="mb-4">
                    <h2 className="text-xl font-semibold">Available Images</h2>
                    <p className="text-sm text-muted-foreground">Browse and subscribe to additional secure images</p>
                  </div>
                  <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 max-w-6xl">
                    {remainingCatalogItems.map((item) => {
                      return (
                        <Card key={item.id} className="flex flex-col hover:shadow-md transition-shadow">
                          <Link href={`/dashboard/images/${item.slug}`} className="flex flex-col grow">
                            <CardHeader className="pb-2">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex items-start gap-3">
                                  {/* GitHub Avatar */}
                                  {item.imageUrl ? (
                                    <div className="h-10 w-10 rounded-md overflow-hidden shrink-0">
                                      <Image
                                        src={item.imageUrl || "/placeholder.svg"}
                                        alt={`${item.name} logo`}
                                        width={40}
                                        height={40}
                                        className="object-cover"
                                      />
                                    </div>
                                  ) : (
                                    <div className="h-10 w-10 rounded-md bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-500 shrink-0">
                                      {item.name.charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <div>
                                    <CardTitle className="text-base">{item.name}</CardTitle>
                                    <Badge variant="outline" className="mt-1">
                                      {item.category}
                                    </Badge>
                                  </div>
                                </div>
                                {item.isPartner && (
                                  <Badge
                                    className="bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300 font-semibold flex items-center gap-1 shrink-0"
                                  >
                                    ✓ Partner
                                  </Badge>
                                )}
                              </div>
                            </CardHeader>
                            <CardContent className="py-2 grow">
                              <p className="text-sm text-muted-foreground line-clamp-2">{item.description}</p>
                              <div className="grid grid-cols-2 gap-2 mt-3">
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Price</span>
                                  <span className="text-sm font-medium">${item.pricing.monthly}/mo</span>
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs text-muted-foreground">Fixed CVEs</span>
                                  <span className="text-sm font-medium">{item.cvesFixedCount}</span>
                                </div>
                              </div>
                            </CardContent>
                          </Link>
                          <CardFooter className="pt-2 border-t">
                            <Button variant="default" size="sm" className="w-full bg-blue-600 hover:bg-blue-700" asChild>
                              <Link href={`/checkout/${item.slug}`}>
                                <Plus className="mr-1 h-4 w-4" />
                                Subscribe
                              </Link>
                            </Button>
                          </CardFooter>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
