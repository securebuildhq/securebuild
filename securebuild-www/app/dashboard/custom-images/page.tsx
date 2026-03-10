"use client"

import React, { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Container, Plus, CheckCircle2, XCircle, Clock, Loader2, Eye, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { listCustomImages, CustomImage } from "@/lib/custom-apko/actions"
import { checkCustomImagesEnabled } from "@/lib/common/feature-flag-actions"
import { FeatureDisabled } from "@/components/feature-disabled"

export default function CustomImagesPage() {
  const router = useRouter()
  const [images, setImages] = useState<CustomImage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null)
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  })
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)

  const loadImages = async (page: number = 1) => {
    const result = await listCustomImages(page, 10)
    setImages(result.images)
    setPagination({
      page: result.page,
      limit: result.limit,
      total: result.total,
      totalPages: result.totalPages
    })
  }

  useEffect(() => {
    checkFeatureAndLoadImages()
  }, [])

  const checkFeatureAndLoadImages = async () => {
    try {
      setLoading(true)
      setError(null)

      // Check if feature is enabled
      const enabled = await checkCustomImagesEnabled()
      setFeatureEnabled(enabled)

      if (enabled) {
        await loadImages()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load custom images')
      console.error('Error loading custom images:', err)
    } finally {
      setLoading(false)
    }
  }

  // Set up polling for build status updates
  useEffect(() => {
    const hasActiveBuilds = images.some(
      image => image.latest_build_status === 'queued' || image.latest_build_status === 'building'
    )

    if (hasActiveBuilds && !pollingInterval) {
      const interval = setInterval(() => {
        loadImages(pagination.page)
      }, 10000) // Poll every 10 seconds
      setPollingInterval(interval)
    } else if (!hasActiveBuilds && pollingInterval) {
      clearInterval(pollingInterval)
      setPollingInterval(null)
    }

    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval)
      }
    }
  }, [images, pollingInterval, pagination.page])

  const getBuildStatusBadge = (status?: string) => {
    switch (status) {
      case 'completed':
        return (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      case 'building':
        return (
          <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            Building
          </Badge>
        );
      case 'queued':
        return (
          <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
            <Clock className="w-3 h-3 mr-1" />
            Queued
          </Badge>
        );
      default:
        return <Badge variant="outline">No builds</Badge>;
    }
  }

  const handlePageChange = (newPage: number) => {
    loadImages(newPage)
  }

  if (loading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Container className="h-8 w-8" />
            Custom Images
          </h1>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    )
  }

  // Check if feature is disabled
  if (featureEnabled === false) {
    return (
      <FeatureDisabled 
        featureName="Custom Images"
        description="Build and manage your custom container images"
      />
    )
  }

  if (error) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Container className="h-8 w-8" />
            Custom Images
          </h1>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-red-600">
              <XCircle className="h-12 w-12 mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">Error Loading Custom Images</p>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button onClick={() => loadImages()} className="mt-4">
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Container className="h-8 w-8" />
          Custom Images
        </h1>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Custom Image
        </Button>
      </div>

      {images.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <Container className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium mb-2">No custom images found</p>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first custom image to get started with APKO configurations.
              </p>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Custom Image
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Custom Images</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/3">Image</TableHead>
                    <TableHead className="w-24">Default Tag</TableHead>
                    <TableHead className="w-16">Configs</TableHead>
                    <TableHead className="w-32 whitespace-nowrap">Last Build</TableHead>
                    <TableHead className="w-20 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {images.map((image) => (
                    <TableRow 
                      key={image.id}
                      className="cursor-pointer hover:bg-muted/50 border-b"
                      onClick={() => router.push(`/dashboard/custom-images/${image.id}`)}
                    >
                      <TableCell className="py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-md bg-linear-to-br from-purple-100 to-blue-100 dark:from-purple-900/50 dark:to-blue-900/50 flex items-center justify-center">
                            <Container className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-gray-900 dark:text-gray-100">{image.name}</div>
                            {image.readme && (
                              <div className="text-sm text-muted-foreground truncate max-w-xs mt-1">
                                {image.readme}
                              </div>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-4">
                        <Badge variant="secondary" className="font-mono text-xs font-medium">
                          {image.default_tag}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-4">
                        <div className="flex items-center justify-center">
                          <div className="bg-gray-100 dark:bg-gray-800 rounded-full h-8 w-8 flex items-center justify-center">
                            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{image.apko_count}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-4">
                        <div className="space-y-2">
                          {getBuildStatusBadge(image.latest_build_status)}
                          {image.latest_build_at && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3 shrink-0" />
                              <span>
                                {new Date(image.latest_build_at).toLocaleString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right py-4">
                        <div className="flex justify-end gap-1" data-prevent-row-click="true">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              // TODO: Add build action
                              console.log('Build image:', image.id)
                            }}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-green-600 hover:bg-green-50 dark:hover:bg-green-950/20 transition-colors"
                            title="Build Image"
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(`/dashboard/custom-images/${image.id}`)
                            }}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-colors"
                            title="View Details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to{" "}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
                {pagination.total} custom images
              </p>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page === 1}
                  onClick={() => handlePageChange(pagination.page - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pagination.page === pagination.totalPages}
                  onClick={() => handlePageChange(pagination.page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}