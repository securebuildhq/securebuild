"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Container, ArrowLeft, Calendar, Package, FileText, Copy, CheckCircle2, Plus, Clock, Loader2, XCircle, History, Eye } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getCustomImageDetail, getCustomImageBuilds, CustomImageDetail } from "@/lib/custom-apko/actions"
import { CustomImageBuild, CustomImageBuildStatusType } from "@/lib/custom-apko/custom-apko"
import { formatDistanceToNow } from "date-fns"
import { toast } from "@/components/ui/use-toast"
import { checkCustomImagesEnabled } from "@/lib/common/feature-flag-actions"
import { FeatureDisabled } from "@/components/feature-disabled"

interface CustomImageDetailPageProps {
  params: Promise<{
    id: string
    tab?: string[]
  }>
}

export default function CustomImageDetailPage({ params }: CustomImageDetailPageProps) {
  const router = useRouter()
  const [customImageId, setCustomImageId] = useState<string | null>(null)
  const [tabParam, setTabParam] = useState<string[] | undefined>(undefined)
  const [image, setImage] = useState<CustomImageDetail | null>(null)
  const [builds, setBuilds] = useState<CustomImageBuild[]>([])
  const [buildsLoading, setBuildsLoading] = useState(false)
  const [buildsError, setBuildsError] = useState<string | null>(null)
  const [buildsPagination, setBuildsPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [copiedYaml, setCopiedYaml] = useState<string | null>(null)
  // Determine current tab from URL route parameters
  const getCurrentTab = useCallback(() => {
    // tabParam will be undefined for /dashboard/custom-images/[id] (configs default)
    // tabParam will be ['configurations'] for /dashboard/custom-images/[id]/configurations
    // tabParam will be ['builds'] for /dashboard/custom-images/[id]/builds
    const tab = tabParam?.[0]
    if (tab && ['configurations', 'builds'].includes(tab)) {
      return tab === 'configurations' ? 'configs' : tab
    }
    return 'configs' // default
  }, [tabParam])

  const [currentTab, setCurrentTab] = useState(getCurrentTab())
  const [isClientNavigation, setIsClientNavigation] = useState(false)
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null)

  const itemsPerPage = 10
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedConfigs = image?.apko_configs.slice(startIndex, endIndex) || []
  const totalPages = Math.ceil((image?.apko_configs.length || 0) / itemsPerPage)

  // Extract params on mount
  useEffect(() => {
    params.then(({ id, tab }) => {
      setCustomImageId(id)
      setTabParam(tab)
    })
  }, [params])

  const loadImageDetail = useCallback(async () => {
    if (!customImageId) return
    
    try {
      setLoading(true)
      setError(null)
      
      const result = await getCustomImageDetail(customImageId)
      if (!result) {
        setError('Custom image not found')
        return
      }
      setImage(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load custom image details')
    } finally {
      setLoading(false)
    }
  }, [customImageId])

  const loadBuilds = useCallback(async (page: number = 1) => {
    if (!customImageId) return
    
    try {
      setBuildsLoading(true)
      setBuildsError(null)
      const result = await getCustomImageBuilds(customImageId, page, 10)
      setBuilds(result.builds)
      setBuildsPagination({
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit)
      })
    } catch {
      setBuildsError('Failed to load builds')
    } finally {
      setBuildsLoading(false)
    }
  }, [customImageId])

  const checkFeatureAndLoadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Check if feature is enabled
      const enabled = await checkCustomImagesEnabled()
      setFeatureEnabled(enabled)

      if (enabled) {
        await loadImageDetail()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load custom image data')
      console.error('Error loading custom image data:', err)
    } finally {
      setLoading(false)
    }
  }, [loadImageDetail])

  useEffect(() => {
    if (customImageId) {
      checkFeatureAndLoadData()
    }
  }, [customImageId, checkFeatureAndLoadData])

  useEffect(() => {
    if (currentTab === 'builds') {
      loadBuilds()
    }
  }, [currentTab, buildsPagination.page, loadBuilds])

  // Set up polling for active builds
  useEffect(() => {
    const hasActiveBuilds = builds.some(
      build => build.status === 'queued' || build.status === 'building'
    ) || (image?.apko_configs || []).some(
      config => config.latest_build_status === 'queued' || config.latest_build_status === 'building'
    )

    if (hasActiveBuilds && !pollingInterval) {
      const interval = setInterval(() => {
        if (currentTab === 'builds') {
          loadBuilds(buildsPagination.page)
        }
        loadImageDetail()
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
  }, [builds, image, currentTab, buildsPagination.page, pollingInterval, loadBuilds, loadImageDetail])

  const copyYamlToClipboard = async (yaml: string, apkoId: string) => {
    try {
      await navigator.clipboard.writeText(yaml)
      setCopiedYaml(apkoId)
      toast({
        title: "YAML copied to clipboard",
        description: "The APKO configuration has been copied to your clipboard.",
      })
      setTimeout(() => setCopiedYaml(null), 2000)
    } catch {
      toast({
        title: "Failed to copy",
        description: "Could not copy YAML to clipboard.",
        variant: "destructive",
      })
    }
  }

  const getBuildStatusBadge = (status: CustomImageBuildStatusType) => {
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
        return <Badge variant="outline">Unknown</Badge>;
    }
  }


  const handleBuildsPageChange = (newPage: number) => {
    setBuildsPagination(prev => ({ ...prev, page: newPage }))
  }

  // Handle tab changes
  const handleTabChange = (value: string) => {
    setIsClientNavigation(true) // Mark as client-side navigation
    setCurrentTab(value)
    const basePath = `/dashboard/custom-images/${customImageId}`
    // Map internal tab names to URL paths
    const urlPath = value === 'configs' ? 'configurations' : value
    const newPath = `${basePath}/${urlPath}`

    // Update URL without page reload using browser History API
    window.history.pushState(null, '', newPath)
  }

  // Update current tab when route params change (only for initial load or page refresh)
  useEffect(() => {
    if (!isClientNavigation) {
      setCurrentTab(getCurrentTab())
    }
  }, [tabParam, isClientNavigation, getCurrentTab])

  // Set initial tab state on component mount
  useEffect(() => {
    setCurrentTab(getCurrentTab())
    setIsClientNavigation(false) // Ensure we start with route-based navigation
  }, [getCurrentTab]) // Only run on mount

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setIsClientNavigation(false) // Reset client navigation flag
      // Extract tab from current URL path
      const currentPath = window.location.pathname
      const pathSegments = currentPath.split('/')
      const lastSegment = pathSegments[pathSegments.length - 1]

      if (lastSegment === 'configurations') {
        setCurrentTab('configs')
      } else if (lastSegment === 'builds') {
        setCurrentTab('builds')
      } else {
        setCurrentTab('configs')
      }
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  if (loading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push('/dashboard/custom-images')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Custom Images
          </Button>
        </div>
        <div className="flex items-center justify-center py-8">
          <Package className="h-8 w-8 animate-pulse text-muted-foreground" />
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

  if (error || !image) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push('/dashboard/custom-images')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Custom Images
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-red-600">
              <Package className="h-12 w-12 mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">Custom Image Not Found</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => router.push('/dashboard/custom-images')}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Custom Images
        </Button>
      </div>

      {/* Image Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Container className="h-8 w-8" />
            {image.name}
          </h1>
          <div className="flex items-center gap-4 mt-2">
            <Badge variant="outline" className="font-mono">
              {image.default_tag}
            </Badge>
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Created {formatDistanceToNow(image.created_at, { addSuffix: true })}
            </span>
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Package className="h-3 w-3" />
              {image.apko_configs.length} APKO config{image.apko_configs.length !== 1 ? 's' : ''}
            </span>
          </div>
          {image.readme && (
            <p className="text-muted-foreground mt-2">{image.readme}</p>
          )}
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add APKO Config
        </Button>
      </div>

      <Separator />

      {/* Tabs for APKO Configurations and Build History */}
      <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="configs">APKO Configurations</TabsTrigger>
          <TabsTrigger value="builds">Build History</TabsTrigger>
        </TabsList>

        <TabsContent value="configs" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">APKO Configurations</h2>
            {totalPages > 1 && (
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>

          {paginatedConfigs.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium mb-2">No APKO configurations</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Add an APKO configuration to define how this image should be built.
                  </p>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Add APKO Configuration
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {paginatedConfigs.map((apko) => (
                <Card key={apko.id}>
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-lg">{apko.name}</CardTitle>
                        <div className="flex items-center gap-2 mt-1">
                          {apko.tags.map((tag) => (
                            <Badge key={tag} variant="outline" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                          {apko.latest_build_status && (
                            <div className="flex items-center gap-2">
                              {getBuildStatusBadge(apko.latest_build_status)}
                              {apko.latest_build_at && (
                                <span className="text-xs text-muted-foreground">
                                  {formatDistanceToNow(apko.latest_build_at, { addSuffix: true })}
                                </span>
                              )}
                            </div>
                          )}
                          <span className="text-xs text-muted-foreground">
                            Updated {formatDistanceToNow(apko.updated_at, { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          copyYamlToClipboard(apko.latest_yaml, apko.id)
                        }}
                      >
                        {copiedYaml === apko.id ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                        {copiedYaml === apko.id ? 'Copied!' : 'Copy YAML'}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="text-sm text-muted-foreground">
                        APKO Configuration (YAML):
                      </div>
                      <Textarea
                        value={apko.latest_yaml}
                        readOnly
                        className="font-mono text-xs min-h-[200px] bg-muted"
                      />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Showing {startIndex + 1} to {Math.min(endIndex, image.apko_configs.length)} of{" "}
                {image.apko_configs.length} APKO configurations
              </p>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(currentPage - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(currentPage + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="builds" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <History className="h-5 w-5" />
              Build History
            </h2>
            {buildsPagination.totalPages > 1 && (
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={buildsPagination.page === 1}
                  onClick={() => handleBuildsPageChange(buildsPagination.page - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {buildsPagination.page} of {buildsPagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={buildsPagination.page === buildsPagination.totalPages}
                  onClick={() => handleBuildsPageChange(buildsPagination.page + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>

          {buildsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : buildsError ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center text-red-600">
                  <XCircle className="h-12 w-12 mx-auto mb-4" />
                  <p className="text-lg font-medium mb-2">Error Loading Build History</p>
                  <p className="text-sm text-muted-foreground">{buildsError}</p>
                  <Button onClick={() => loadBuilds(buildsPagination.page)} className="mt-4">
                    Try Again
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : builds.length === 0 ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center">
                  <History className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium mb-2">No builds found</p>
                  <p className="text-sm text-muted-foreground">
                    Build history will appear here once you create and build APKO configurations.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Finished</TableHead>
                      <TableHead>Builder</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {builds.map((build) => (
                      <TableRow key={build.id}>
                        <TableCell>{getBuildStatusBadge(build.status)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDistanceToNow(build.created_at, { addSuffix: true })}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {build.build_finished_at 
                            ? formatDistanceToNow(build.build_finished_at, { addSuffix: true })
                            : '-'
                          }
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {build.builder_id || '-'}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" title="View Build Details" asChild>
                            <Link href={`/dashboard/custom-images/${customImageId}/builds/${build.id}`}>
                              <Eye className="h-4 w-4" />
                              View Details
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {buildsPagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Showing {((buildsPagination.page - 1) * buildsPagination.limit) + 1} to{" "}
                {Math.min(buildsPagination.page * buildsPagination.limit, buildsPagination.total)} of{" "}
                {buildsPagination.total} builds
              </p>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={buildsPagination.page === 1}
                  onClick={() => handleBuildsPageChange(buildsPagination.page - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {buildsPagination.page} of {buildsPagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={buildsPagination.page === buildsPagination.totalPages}
                  onClick={() => handleBuildsPageChange(buildsPagination.page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}