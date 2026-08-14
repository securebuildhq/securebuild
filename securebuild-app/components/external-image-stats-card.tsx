"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Shield, Package, Database, CheckCircle, Clock, FileText, AlertTriangle } from "lucide-react"
import { getExternalImageStatsAction } from "@/lib/externalimage/actions/get-external-image-stats"
import { ExternalImageStats } from "@/lib/externalimage/externalimage"
import { useSession } from "@/app/hooks/use-session"

function formatTimeAgo(dateString: string): string {
  // Ensure we're treating the date string as UTC
  const now = Date.now()
  const scanTime = new Date(dateString).getTime()
  const diffMs = now - scanTime

  // Handle negative differences (future dates) gracefully
  if (diffMs < 0) {
    return 'Future'
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffDays > 0) {
    const remainingHours = diffHours % 24
    return `${diffDays}d${remainingHours}h ago`
  } else if (diffHours > 0) {
    const remainingMinutes = diffMinutes % 60
    return `${diffHours}h${remainingMinutes}m ago`
  } else {
    return `${diffMinutes}m ago`
  }
}

export function ExternalImageStatsCard() {
  const [stats, setStats] = useState<ExternalImageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { session, isSessionLoading } = useSession()
  const router = useRouter()

  useEffect(() => {
    const fetchStats = async () => {
      // Still loading session
      if (isSessionLoading) {
        return
      }
      
      // Session loaded but user is not authenticated - redirect to login
      if (!session) {
        router.replace("/")
        return
      }
      
      try {
        setLoading(true)
        const data = await getExternalImageStatsAction()
        setStats(data)
        setError(null)
      } catch (err) {
        console.error("Failed to fetch external image stats:", err)
        setError(err instanceof Error ? err.message : "Failed to load stats")
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [session, isSessionLoading])

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            External Image Security
          </CardTitle>
          <CardDescription>Security scanning statistics for tracked external images</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            External Image Security
          </CardTitle>
          <CardDescription>Security scanning statistics for tracked external images</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-red-600 text-sm">Error: {error}</div>
        </CardContent>
      </Card>
    )
  }

  if (!stats) {
    return null
  }

  const scanCoverage = stats.totalTags > 0 ? Math.round((stats.tagsWithScans / stats.totalTags) * 100) : 0
  const sbomCoverage = stats.totalTags > 0 ? Math.round((stats.tagsWithSboms / stats.totalTags) * 100) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          External Image Security
        </CardTitle>
        <CardDescription>Security scanning and SBOM generation statistics for tracked external images</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-medium">Images</span>
              </div>
              <span className="text-2xl font-bold">{stats.totalImages}</span>
            </div>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">Tags</span>
              </div>
              <span className="text-2xl font-bold">{stats.totalTags}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">Distinct Content SHAs of tags</span>
              </div>
              <span className="text-2xl font-bold">{stats.totalDigests}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">SBOMs</span>
              </div>
              <span className="text-2xl font-bold">{stats.sbomDigests}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-orange-500" />
                <span className="text-sm font-medium">Unscanned SBOMs</span>
              </div>
              <span className="text-2xl font-bold">{stats.unscannedSboms}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">Tags with Vulnerability Scans</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{stats.tagsWithScans}</div>
                <div className="text-xs text-muted-foreground">{scanCoverage}% coverage</div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">Tags with SBOMs</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">{stats.tagsWithSboms}</div>
                <div className="text-xs text-muted-foreground">{sbomCoverage}% coverage</div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-medium">Oldest Vulnerability Scan</span>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold">
                  {stats.oldestScanAt ? formatTimeAgo(stats.oldestScanAt) : 'Never'}
                </div>
                {stats.oldestScanAt && (
                  <div className="text-xs text-muted-foreground">
                    {new Date(stats.oldestScanAt).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-purple-500" />
                <span className="text-sm font-medium">Completed Vulnerability Scans</span>
              </div>
              <span className="text-2xl font-bold">{stats.scannedDigests}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
