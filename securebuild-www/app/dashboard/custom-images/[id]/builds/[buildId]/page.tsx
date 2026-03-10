"use client"

import React, { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Container, ArrowLeft, CheckCircle2, Clock, Loader2, XCircle, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { getCustomImageDetail, getCustomImageBuilds, CustomImageDetail } from "@/lib/custom-apko/actions"
import { CustomImageBuild, CustomImageBuildStatusType } from "@/lib/custom-apko/custom-apko"
import { formatDistanceToNow } from "date-fns"
import { checkCustomImagesEnabled } from "@/lib/common/feature-flag-actions"
import { FeatureDisabled } from "@/components/feature-disabled"

interface CustomImageBuildDetailPageProps {
  params: Promise<{
    id: string
    buildId: string
  }>
}

export default function CustomImageBuildDetailPage({ params }: CustomImageBuildDetailPageProps) {
  const router = useRouter()
  const [customImageId, setCustomImageId] = useState<string | null>(null)
  const [buildId, setBuildId] = useState<string | null>(null)
  const [image, setImage] = useState<CustomImageDetail | null>(null)
  const [build, setBuild] = useState<CustomImageBuild | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    const resolveParams = async () => {
      const resolvedParams = await params
      setCustomImageId(resolvedParams.id)
      setBuildId(resolvedParams.buildId)
    }
    resolveParams()
  }, [params])

  const checkFeatureAndLoadData = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Check if feature is enabled
      const enabled = await checkCustomImagesEnabled()
      setFeatureEnabled(enabled)

      if (enabled) {
        await loadBuildData()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load build data')
      console.error('Error loading build data:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (customImageId && buildId) {
      checkFeatureAndLoadData()
    }
  }, [customImageId, buildId, checkFeatureAndLoadData])

  const loadBuildData = async () => {
    if (!customImageId || !buildId) return

    // Load image details
    const imageData = await getCustomImageDetail(customImageId)
    if (!imageData) {
      throw new Error('Custom image not found')
    }
    setImage(imageData)

    // Load builds to find the specific build
    const buildsResponse = await getCustomImageBuilds(customImageId, 1, 100) // Get more builds to find the one
    const buildData = buildsResponse.builds.find(b => b.id === buildId)
    if (!buildData) {
      throw new Error('Build not found')
    }
    setBuild(buildData)
  }

  const getBuildStatusBadge = (status: CustomImageBuildStatusType) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="default" className="bg-green-100 text-green-800 border-green-200">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Success
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case 'building':
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800 border-blue-200">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            In Progress
          </Badge>
        );
      case 'queued':
        return (
          <Badge variant="secondary">
            <Clock className="h-3 w-3 mr-1" />
            Queued
          </Badge>
        );
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  }

  if (loading) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push(`/dashboard/custom-images/${customImageId}/builds`)}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Build History
          </Button>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading build details...</span>
          </div>
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

  if (error || !image || !build) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            onClick={() => router.push(`/dashboard/custom-images/${customImageId}/builds`)}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Build History
          </Button>
        </div>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error || 'Build not found'}</AlertDescription>
        </Alert>
        <Button onClick={loadBuildData}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => router.push(`/dashboard/custom-images/${customImageId}/builds`)}
          className="flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Build History
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Container className="h-8 w-8" />
            {image.name}
          </h1>
          <p className="text-muted-foreground mt-2">
            Build Details • Started {formatDistanceToNow(build.created_at, { addSuffix: true })}
          </p>
        </div>
      </div>

      {/* Build Information */}
      <Card>
        <CardHeader>
          <CardTitle>Build Information</CardTitle>
          <CardDescription>Details about this build execution</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Build ID</label>
              <p className="font-mono text-sm">{build.id}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Status</label>
              <div className="mt-1">
                {getBuildStatusBadge(build.status)}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Started</label>
              <p className="text-sm">{formatDistanceToNow(build.created_at, { addSuffix: true })}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">Finished</label>
              <p className="text-sm">
                {build.build_finished_at 
                  ? formatDistanceToNow(build.build_finished_at, { addSuffix: true })
                  : 'Not finished'
                }
              </p>
            </div>
            {build.builder_id && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Builder</label>
                <p className="font-mono text-sm">{build.builder_id}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Build Logs */}
      <div className="space-y-6">
        {build.worker_error && (
          <Card>
            <CardHeader>
              <CardTitle className="text-red-600">Worker Error</CardTitle>
              <CardDescription>Error that occurred during the build process</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-black text-green-400 p-4 rounded text-sm font-mono max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{build.worker_error}</pre>
              </div>
            </CardContent>
          </Card>
        )}

        {build.apko_stdout && (
          <Card>
            <CardHeader>
              <CardTitle>APKO Output</CardTitle>
              <CardDescription>Standard output from the APKO build process</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-black text-green-400 p-4 rounded text-sm font-mono max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{build.apko_stdout}</pre>
              </div>
            </CardContent>
          </Card>
        )}

        {build.apko_stderr && (
          <Card>
            <CardHeader>
              <CardTitle>APKO Messages</CardTitle>
              <CardDescription>Messages and warnings from APKO</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-black text-green-400 p-4 rounded text-sm font-mono max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{build.apko_stderr}</pre>
              </div>
            </CardContent>
          </Card>
        )}

        {build.grype_aarch64_stderr && (
          <Card>
            <CardHeader>
              <CardTitle>Grype aarch64 Output</CardTitle>
              <CardDescription>Security scan results for aarch64 architecture</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-black text-green-400 p-4 rounded text-sm font-mono max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{build.grype_aarch64_stderr}</pre>
              </div>
            </CardContent>
          </Card>
        )}

        {build.grype_x86_64_stderr && (
          <Card>
            <CardHeader>
              <CardTitle>Grype x86_64 Output</CardTitle>
              <CardDescription>Security scan results for x86_64 architecture</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="bg-black text-green-400 p-4 rounded text-sm font-mono max-h-96 overflow-y-auto">
                <pre className="whitespace-pre-wrap">{build.grype_x86_64_stderr}</pre>
              </div>
            </CardContent>
          </Card>
        )}

        {!build.worker_error && !build.apko_stdout && !build.apko_stderr && !build.grype_aarch64_stderr && !build.grype_x86_64_stderr && (
          <Card>
            <CardContent className="p-12">
              <div className="text-center space-y-4">
                <AlertTriangle className="h-12 w-12 mx-auto text-muted-foreground" />
                <div>
                  <h3 className="text-lg font-semibold">No Build Logs Available</h3>
                  <p className="text-muted-foreground">
                    Build logs are not available for this execution.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}