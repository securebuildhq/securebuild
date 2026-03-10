"use client"

import React from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CheckCircle, XCircle, Clock, AlertTriangle, Activity } from "lucide-react"

interface Execution {
  id: string
  packageId: string
  packageName: string
  status: string
  createdAt: string
  completedAt: string | null
  version?: string
  apkRelease?: number | null
  commit?: string
  cause?: string
  causeId?: string
  x86_64BuildStartedAt: string | null
  x86_64BuildFinishedAt: string | null
  aarch64BuildStartedAt: string | null
  aarch64BuildFinishedAt: string | null
  useRoot: boolean | null
  bootstrapEnabled: boolean | null
  bootstrapApkRepository: string | null
  bootstrapKeyringAppend: string | null
}

interface PackageStatusIndicatorProps {
  executions: Execution[]
  loading?: boolean
}

export function PackageStatusIndicator({ executions, loading }: PackageStatusIndicatorProps) {
  const router = useRouter()
  if (loading) {
    return (
      <Card className="mb-4 border-l-4 border-l-gray-300">
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            {/* Status Icon */}
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 flex-shrink-0">
              <Activity className="w-5 h-5 text-gray-500 animate-spin" />
            </div>
            
            {/* Status Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="font-semibold text-gray-600">Loading Status...</h3>
                <Badge variant="outline" className="text-xs px-2 py-0 border-gray-200">
                  Package Health
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                Fetching build information
              </p>
              
              {/* Build History Row */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground min-w-fit">Recent:</span>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="w-3 h-3 rounded-full bg-gray-200 animate-pulse" />
                  ))}
                </div>
                <span className="text-xs text-muted-foreground ml-auto">Checking...</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!executions || executions.length === 0) {
    return (
      <Card className="mb-4 border-l-4 border-l-gray-400">
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            {/* Status Icon */}
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-100 flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-gray-600" />
            </div>
            
            {/* Status Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="font-semibold text-gray-600">No Build History</h3>
                <Badge variant="outline" className="text-xs px-2 py-0 border-gray-200">
                  Package Health
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                This package hasn't been built yet
              </p>
              
              {/* Build History Row */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground min-w-fit">Recent:</span>
                <span className="text-xs text-muted-foreground italic">No builds yet</span>
                <Badge variant="secondary" className="text-xs ml-auto">
                  New Package
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Analyze recent execution history
  const recent = executions.slice(0, 5)
  const latest = executions[0]
  
  // Count status types in recent builds
  const statusCounts = recent.reduce((acc, exec) => {
    acc[exec.status] = (acc[exec.status] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Determine overall health status
  const getHealthStatus = () => {
    if (!latest || recent.length === 0) return { status: 'unknown', color: 'gray', icon: AlertTriangle }

    // Check for current active builds
    if (['building', 'testing', 'publishing'].includes(latest.status)) {
      return { status: 'building', color: 'blue', icon: Clock }
    }

    // Last build was successful
    if (latest.status === 'success') {
      const successCount = statusCounts.success || 0
      const totalRecent = recent.length
      const successRate = totalRecent > 0 ? successCount / totalRecent : 0

      if (successRate >= 0.8) {
        return { status: 'healthy', color: 'green', icon: CheckCircle }
      } else if (successRate >= 0.6) {
        return { status: 'mostly-stable', color: 'yellow', icon: CheckCircle }
      } else {
        return { status: 'unstable', color: 'orange', icon: AlertTriangle }
      }
    }

    // Last build failed
    const failureStatuses = ['failed', 'timed_out', 'stalled', 'vm_deleted']
    if (failureStatuses.includes(latest.status)) {
      const failureCount = failureStatuses.reduce((sum, status) => sum + (statusCounts[status] || 0), 0)
      const totalRecent = recent.length
      const failureRate = totalRecent > 0 ? failureCount / totalRecent : 0

      if (failureRate >= 0.8) {
        return { status: 'failing', color: 'red', icon: XCircle }
      } else if (failureRate >= 0.4) {
        return { status: 'unstable', color: 'orange', icon: AlertTriangle }
      } else {
        return { status: 'recovering', color: 'yellow', icon: AlertTriangle }
      }
    }

    return { status: 'unknown', color: 'gray', icon: AlertTriangle }
  }

  const health = getHealthStatus()

  // Safe date formatting with fallbacks
  const formatDate = (dateString: string | null | undefined): string => {
    if (!dateString) return 'Unknown'
    try {
      const date = new Date(dateString)
      return isNaN(date.getTime()) ? 'Unknown' : date.toLocaleDateString()
    } catch {
      return 'Unknown'
    }
  }

  const formatTime = (dateString: string | null | undefined): string => {
    if (!dateString) return 'Unknown'
    try {
      const date = new Date(dateString)
      return isNaN(date.getTime()) ? 'Unknown' : date.toLocaleTimeString()
    } catch {
      return 'Unknown'
    }
  }

  // Get status display text and description
  const getStatusInfo = () => {

    const latestDate = latest ? formatDate(latest.createdAt) : 'Unknown'
    
    switch (health.status) {
      case 'building':
        return {
          label: 'Currently Building',
          description: 'Build in progress',
          detail: `Started ${latest ? formatTime(latest.createdAt) : 'Unknown'}`
        }
      case 'healthy':
        return {
          label: 'Healthy',
          description: 'Consistently building successfully',
          detail: `Last success: ${latestDate}`
        }
      case 'mostly-stable':
        return {
          label: 'Mostly Stable',
          description: 'Generally successful with occasional issues',
          detail: `Last success: ${latestDate}`
        }
      case 'unstable':
        const successCount = statusCounts.success || 0
        const totalCount = recent.length
        return {
          label: 'Unstable',
          description: `${successCount}/${totalCount} recent builds successful`,
          detail: `Mixed results in recent builds`
        }
      case 'failing':
        return {
          label: 'Failing',
          description: 'Multiple recent build failures',
          detail: `Last attempt: ${latestDate}`
        }
      case 'recovering':
        return {
          label: 'Recovering',
          description: 'Recent failures but showing improvement',
          detail: `Last attempt: ${latestDate}`
        }
      default:
        return {
          label: 'Unknown Status',
          description: 'Unable to determine build health',
          detail: latest ? `Last build: ${latestDate}` : 'No recent builds'
        }
    }
  }

  const statusInfo = getStatusInfo()
  const Icon = health.icon

  // Get color classes for the status
  const getColorClasses = (baseColor: string) => {
    const colors = {
      green: { 
        dot: 'bg-green-500', 
        text: 'text-green-700', 
        badge: 'bg-green-100 text-green-800',
        border: 'border-l-green-500'
      },
      blue: { 
        dot: 'bg-blue-500', 
        text: 'text-blue-700', 
        badge: 'bg-blue-100 text-blue-800',
        border: 'border-l-blue-500'
      },
      yellow: { 
        dot: 'bg-yellow-500', 
        text: 'text-yellow-700', 
        badge: 'bg-yellow-100 text-yellow-800',
        border: 'border-l-yellow-500'
      },
      orange: { 
        dot: 'bg-orange-500', 
        text: 'text-orange-700', 
        badge: 'bg-orange-100 text-orange-800',
        border: 'border-l-orange-500'
      },
      red: { 
        dot: 'bg-red-500', 
        text: 'text-red-700', 
        badge: 'bg-red-100 text-red-800',
        border: 'border-l-red-500'
      },
      gray: { 
        dot: 'bg-gray-400', 
        text: 'text-gray-600', 
        badge: 'bg-gray-100 text-gray-800',
        border: 'border-l-gray-400'
      }
    }
    return colors[baseColor as keyof typeof colors] || colors.gray
  }

  const colors = getColorClasses(health.color)

  return (
    <Card className={`mb-4 border-l-4 ${colors.border}`}>
      <CardContent className="py-4">
        <div className="flex items-center gap-4">
          {/* Status Icon */}
          <div className={`flex items-center justify-center w-10 h-10 rounded-full ${colors.badge} flex-shrink-0`}>
            <Icon className={`w-5 h-5 ${colors.text} ${['building', 'testing', 'publishing'].includes(health.status) ? 'animate-spin' : ''}`} />
          </div>
          
          {/* Status Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <h3 className={`font-semibold ${colors.text}`}>{statusInfo.label}</h3>
              <Badge variant="outline" className="text-xs px-2 py-0 border-gray-200">
                Package Health
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {statusInfo.description}
            </p>
            
            {/* Build History Row */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-3 cursor-help">
                    <span className="text-xs font-medium text-muted-foreground min-w-fit">Recent:</span>
                    <div className="flex gap-1 flex-wrap">
                      {recent.slice(0, 10).map((exec, i) => (
                        <button
                          key={exec.id}
                          onClick={() => router.push(`/executions/${exec.id}`)}
                          className={`w-3 h-3 rounded-full border cursor-pointer transition-all duration-200 hover:scale-110 hover:shadow-sm ${
                            exec.status === 'success' ? 'bg-green-500 border-green-600 hover:bg-green-600' :
                            exec.status === 'failed' ? 'bg-red-500 border-red-600 hover:bg-red-600' :
                            exec.status === 'timed_out' ? 'bg-orange-500 border-orange-600 hover:bg-orange-600' :
                            exec.status === 'testing' ? 'bg-amber-500 border-amber-600 animate-pulse hover:bg-amber-600' :
                            ['building', 'publishing'].includes(exec.status) ? 'bg-blue-500 border-blue-600 animate-pulse hover:bg-blue-600' :
                            'bg-gray-400 border-gray-500 hover:bg-gray-500'
                          }`}
                          title={`Click to view execution details - ${exec.status.charAt(0).toUpperCase() + exec.status.slice(1)} - ${formatDate(exec.createdAt)} ${formatTime(exec.createdAt)}`}
                        />
                      ))}
                      {recent.length === 0 && (
                        <span className="text-xs text-muted-foreground italic">No builds yet</span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {recent.length > 0 && latest ? formatDate(latest.createdAt) : 'New'}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-md">
                  <div className="space-y-2">
                    <p className="font-medium">{statusInfo.detail}</p>
                    {recent.length > 0 && (
                      <>
                        <div className="border-t pt-2">
                          <p className="text-xs font-medium mb-2">Build History ({recent.length} most recent) - Click dots to view details:</p>
                          <div className="space-y-1 max-h-32 overflow-y-auto">
                            {recent.map((exec, i) => (
                              <div key={exec.id} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <div className={`w-2 h-2 rounded-full ${
                                    exec.status === 'success' ? 'bg-green-400' :
                                    exec.status === 'failed' ? 'bg-red-400' :
                                    exec.status === 'timed_out' ? 'bg-orange-400' :
                                    exec.status === 'testing' ? 'bg-amber-400' :
                                    ['building', 'publishing'].includes(exec.status) ? 'bg-blue-400' :
                                    'bg-gray-400'
                                  }`} />
                                  <span className="font-mono">{exec.status}</span>
                                </div>
                                <span className="text-muted-foreground">
                                  {formatDate(exec.createdAt)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}