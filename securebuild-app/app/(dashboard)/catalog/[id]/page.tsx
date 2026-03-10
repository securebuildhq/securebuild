"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Edit, Package } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { useSession } from "@/app/hooks/use-session"
import { CatalogItem } from "@/lib/types/catalog"
import { getCatalogItemAction } from "@/lib/catalog/actions/get-catalog-item"

export default function CatalogItemPage() {
  const { session, isSessionLoading } = useSession()
  const user = session?.user
  const router = useRouter()
  const params = useParams()
  const id = params?.id as string

  const [item, setItem] = useState<CatalogItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isSessionLoading || !session || !id) {
      return
    }

    const fetchItem = async () => {
      setLoading(true)
      try {
        const fetchedItem = await getCatalogItemAction(session, id)
        if (fetchedItem) {
          setItem(fetchedItem)
        } else {
          setError("Catalog item not found")
        }
      } catch (error) {
        console.error("Failed to fetch catalog item:", error)
        setError("Failed to load catalog item")
      } finally {
        setLoading(false)
      }
    }

    fetchItem()
  }, [id, session, isSessionLoading])

  const formatDate = (dateInput: any) => {
    if (!dateInput) return "—"

    try {
      let date: Date;
      if (dateInput instanceof Date) {
        date = dateInput;
      } else {
        date = new Date(dateInput);
      }

      if (isNaN(date.getTime())) {
        return "Invalid";
      }

      return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (error) {
      return "Invalid";
    }
  }

  if (isSessionLoading || !session || !user) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/catalog" className="flex items-center">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to Catalog
              </Link>
            </Button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center h-[40vh] text-center space-y-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
              <div className="text-base font-medium">Loading catalog item…</div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-[40vh] text-center space-y-4">
              <Package className="h-16 w-16 text-muted-foreground" />
              <div>
                <h2 className="text-xl font-semibold mb-2">Error Loading Catalog Item</h2>
                <p className="text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : !item ? (
            <div className="flex flex-col items-center justify-center h-[40vh] text-center space-y-4">
              <Package className="h-16 w-16 text-muted-foreground" />
              <div>
                <h2 className="text-xl font-semibold mb-2">Catalog Item Not Found</h2>
                <p className="text-muted-foreground">The requested catalog item could not be found.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Catalog Item Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <Package className="h-8 w-8 text-blue-500" />
                  <div>
                    <h1 className="text-3xl font-bold">{item.name}</h1>
                    <p className="text-muted-foreground">Catalog Item</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild>
                    <Link href={`/catalog/${item.id}/edit`}>
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                </div>
              </div>

              {/* Main Content */}
              <Card>
                <CardHeader>
                  <CardTitle>Catalog Item Details</CardTitle>
                  <CardDescription>Information about this catalog item</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Column 1 */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Name</label>
                        <p className="text-sm">{item.name}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Description</label>
                        <p className="text-sm">{item.description || "No description"}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Status</label>
                        <div className="flex items-center gap-2">
                          <Badge variant={item.isActive ? "default" : "secondary"}>
                            {item.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Category</label>
                        <p className="text-sm">{item.category || "No category"}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Slug</label>
                        <p className="text-sm font-mono">{item.slug || "No slug"}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Images</label>
                        {item.images && item.images.length > 0 ? (
                          <div className="space-y-1">
                            {item.images.map((image) => (
                              <Link
                                key={image.imageId}
                                href={`/images/${image.imageId}`}
                                className="block text-sm text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                {image.name}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm">No images</p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Partner</label>
                        <div className="flex items-center gap-2">
                          <Badge variant={item.isPartner ? "default" : "secondary"}>
                            {item.isPartner ? "Yes" : "No"}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    {/* Column 2 */}
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Alternative Build</label>
                        <div className="flex items-center gap-2">
                          <Badge variant={item.isAlternativeBuild ? "default" : "secondary"}>
                            {item.isAlternativeBuild ? "Yes" : "No"}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Stripe Product ID</label>
                        <p className="text-sm font-mono">{item.stripeProductId || "No product ID"}</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Created At</label>
                        <p className="text-sm">{formatDate(item.createdAt)}</p>
                      </div>
                      {item.pricing && (
                        <>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Monthly Price</label>
                            <p className="text-sm">${item.pricing.monthly || 0}</p>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-muted-foreground">Yearly Price</label>
                            <p className="text-sm">${item.pricing.yearly || 0}</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Image Section */}
                  {item.imageUrl && (
                    <div className="mt-6 pt-6 border-t">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-muted-foreground">Image</label>
                        <div className="mt-2">
                          <img
                            src={item.imageUrl}
                            alt={item.name}
                            className="rounded-md border border-gray-300 object-contain max-h-40"
                            onError={(e) => {
                              console.warn("Image failed to load:", item.imageUrl)
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
    </div>
  )
}
