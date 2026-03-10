"use client"

import type React from "react"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import {
  Tag,
  Clock,
  AlertTriangle,
  ImageIcon,
  ExternalLink,
  Users,
  Bell,
  Eye,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useRouter } from "next/navigation"
import { useSession } from "@/app/hooks/use-session"
import { Image as SBImage } from "@/lib/types/image"
import { listOrgImagesAction } from "@/lib/image/actions/list-org-images"


export default function ImagesPage() {
  const router = useRouter()
  const { session } = useSession();
  const [images, setImages] = useState<SBImage[]>([]);
  const [loading, setLoading] = useState(true);

  // Mock notification count data - in real implementation this would come from an API
  const mockNotificationCounts: { [imageId: string]: number } = {
    "1": 3, // 2 emails + 1 webhook
    "2": 2, // 1 email + 1 slack
    // Add more as needed
  }

  useEffect(() => {
    if (!session) {
      return;
    }

    const fetchCatalogItems = async () => {
      setLoading(true)
      try {
        const items = await listOrgImagesAction(session)
        setImages(items)
      } catch {
        // Consider how to handle errors, e.g., show an error message
        // For now, it will just stop loading and show an empty state if items is empty
      } finally {
        setLoading(false)
      }
    }

    fetchCatalogItems()
  }, [session])

  // Handle row click
  const handleRowClick = (e: React.MouseEvent, imageName: string) => {
    // Only navigate if the click wasn't on a button, link, or other interactive element
    const target = e.target as HTMLElement
    const isInteractive =
      target.closest("button") ||
      target.closest("a") ||
      target.closest('[role="button"]') ||
      target.closest('[data-prevent-row-click="true"]')

    if (!isInteractive) {
      router.push(`/dashboard/images/${imageName}`)
    }
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Organization Images</h1>
            <p className="text-muted-foreground">Manage and explore your organization&apos;s container images</p>
          </div>
        </div>

        <Card>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <p>Loading...</p>
              </div>
            ) : images.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/3">Image</TableHead>
                    <TableHead className="w-16">Tags</TableHead>
                    <TableHead className="w-24">Advisories</TableHead>
                    <TableHead className="w-32 whitespace-nowrap">Last Built</TableHead>
                    <TableHead className="w-32 whitespace-nowrap">Last Scanned</TableHead>
                    <TableHead className="w-20">Notifications</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {images.map((image) => (
                    <TableRow
                      key={image.id}
                      className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors`}
                      onClick={(e) => handleRowClick(e, image.name)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-md bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                            <Image
                              src={image.catalogItem?.imageUrl || "/placeholder.svg"}
                              width={32}
                              height={32}
                              alt={`${image.name} logo`}
                              className="rounded-sm"
                            />
                          </div>
                          <div>
                            <div className="font-medium">{image.name}</div>
                            <div
                              className="text-xs text-muted-foreground truncate max-w-xs"
                              title={image.description || ""}
                            >
                              {image.description}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Tag className="h-4 w-4 text-muted-foreground" />
                          <span>{image.tags.length}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                          <div className="flex gap-1" data-prevent-row-click="true">
                            <span>{image.catalogItem?.cvesFixedCount} fixed</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-1 text-sm">
                          <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate">
                            {image.lastBuiltAt
                              ? new Date(image.lastBuiltAt).toLocaleString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "N/A"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-1 text-sm">
                          <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="truncate">
                            {image.lastScannedAt
                              ? new Date(image.lastScannedAt).toLocaleString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "N/A"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {mockNotificationCounts[image.id] ? (
                            <div className="flex items-center gap-1 text-sm">
                              <Bell className="h-4 w-4 text-teal-600" />
                              <span className="text-teal-600 font-medium">
                                {mockNotificationCounts[image.id]}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Bell className="h-4 w-4" />
                              <span>0</span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2" data-prevent-row-click="true">
                          <Button variant="outline" size="sm" asChild title="View Details">
                            <Link href={`/dashboard/images/${image.name}`}>
                              <Eye className="h-4 w-4" />
                            </Link>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <ImageIcon className="h-16 w-16 text-muted-foreground" />
                <h2 className="mt-6 text-xl font-semibold">No Organization Images</h2>
                <p className="mt-2 text-muted-foreground">
                  Get started by subscribing to an image from the catalog.
                </p>
                <Button className="mt-6" asChild>
                  <Link href="/dashboard/catalog">Browse Catalog</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-linear-to-r from-blue-50 to-teal-50 dark:from-blue-900/30 dark:to-teal-900/30 border-blue-100 dark:border-blue-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Need More Images?
            </CardTitle>
            <CardDescription>
              Contact us for custom catalog management, bulk pricing, adding new images, and enterprise support
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                  <ImageIcon className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-medium">Add New Images</h3>
                  <p className="text-sm text-muted-foreground">Request specific images to be added to our secure catalog</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300">
                  <Tag className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-medium">Bulk Pricing</h3>
                  <p className="text-sm text-muted-foreground">Volume discounts for large-scale deployments</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-medium">Enterprise Support</h3>
                  <p className="text-sm text-muted-foreground">Custom catalog management and SLA guarantees</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center justify-between pt-4 border-t border-blue-200 dark:border-blue-800">
              <div className="text-center sm:text-left">
                <p className="font-medium">Ready to expand your secure image catalog?</p>
                <p className="text-sm text-muted-foreground">Fill out our enterprise form and our team will reach out within 24 hours</p>
              </div>
              <Button asChild className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
                <Link href="https://securebuild.com/enterprise" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Contact Enterprise Team
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
