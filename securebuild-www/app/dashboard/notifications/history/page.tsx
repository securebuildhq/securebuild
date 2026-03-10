"use client"

import { useState, useEffect, useCallback } from "react"
import { CheckCircle, XCircle, Clock, AlertCircle, Mail, Webhook, Package, BarChart3, TrendingUp, AlertTriangle, RotateCcw, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useSession } from "@/app/hooks/use-session"
import { listNotificationEventsAction } from "@/lib/notification/actions/list-notification-events"
import { retryNotificationEventAction } from "@/lib/notification/actions/retry-notification-event"
import { getNotificationEventStatsAction } from "@/lib/notification/actions/get-notification-event-stats"
import { NotificationEventWithDetails, NotificationEvent } from "@/lib/types/notification"

const eventLabels: Record<NotificationEvent, string> = {
  tag_updated: 'Tag updated (repushed due to vuln fixed)',
  new_tag: 'New tag available',
  cve_found: 'CVE found in SecureBuild image'
};

export default function NotificationHistoryPage() {
  const { session } = useSession()
  const [selectedImage, setSelectedImage] = useState<string>("all")
  const [selectedStatus, setSelectedStatus] = useState<string>("all")
  const [selectedTimeRange, setSelectedTimeRange] = useState<string>("all")
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null)
  const [retryConfirmation, setRetryConfirmation] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)

  // State for events and stats
  const [events, setEvents] = useState<NotificationEventWithDetails[]>([])
  const [stats, setStats] = useState<{
    totalEvents: number;
    successfulEvents: number;
    failedEvents: number;
    pendingEvents: number;
    successRate: number;
  } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load events and stats function
  const loadData = useCallback(async (showLoading = true) => {
    if (!session?.selectedTeamId) return

    try {
      if (showLoading) {
        setIsLoading(true)
      }
      setError(null)

      const [eventsResult, statsResult] = await Promise.all([
        listNotificationEventsAction(session, {
          limit: 100,
          offset: 0
        }),
        getNotificationEventStatsAction(session)
      ])

      setEvents(eventsResult || [])
      setStats(statsResult)
    } catch {
      setError('Failed to load notification history')
    } finally {
      if (showLoading) {
        setIsLoading(false)
      }
    }
  }, [session])

  // Load data on mount
  useEffect(() => {
    loadData()
  }, [loadData])

  // Auto-refresh every 2 seconds
  useEffect(() => {
    if (!session?.selectedTeamId) return

    const interval = setInterval(() => {
      loadData(false) // Don't show loading spinner for auto-refresh
    }, 2000)

    return () => clearInterval(interval)
  }, [loadData, session?.selectedTeamId])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'delivered':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />;
      case 'pending':
        return <Clock className="h-4 w-4 text-gray-600" />;
      case 'processing':
        return <AlertCircle className="h-4 w-4 text-yellow-600" />;
      default:
        return <Clock className="h-4 w-4 text-gray-600" />;
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime(); // Positive for future, negative for past
    const absDiffMs = Math.abs(diffMs);
    const diffMinutes = Math.floor(absDiffMs / (1000 * 60));
    const diffHours = Math.floor(absDiffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(absDiffMs / (1000 * 60 * 60 * 24));

    const suffix = diffMs < 0 ? ' ago' : ' from now';

    if (diffMinutes < 1) {
      return diffMs < 0 ? "Just now" : "Right now";
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}${suffix}`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''}${suffix}`;
    } else if (diffDays < 30) {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''}${suffix}`;
    } else {
      const diffMonths = Math.floor(diffDays / 30);
      return `${diffMonths} month${diffMonths !== 1 ? 's' : ''}${suffix}`;
    }
  };


  const formatDetailDateTime = (date: Date) => {
    return date.toLocaleString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'long'
    });
  };

  const handleRetryNotification = async (eventId: string) => {
    if (!session) return

    setIsRetrying(true);
    try {
      await retryNotificationEventAction(session, eventId);

      // Close confirmation modal
      setRetryConfirmation(null);

      // Refresh the event history
      await loadData(false);
    } catch {
      setError('Failed to retry notification')
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notification History</h1>
          <p className="text-muted-foreground">
            Track delivery status and history for your notifications
          </p>
        </div>
      </div>

      {/* Event Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Events</p>
                <p className="text-2xl font-bold">{stats?.totalEvents || 0}</p>
              </div>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Success Rate</p>
                <p className="text-2xl font-bold text-green-600">
                  {Math.round(stats?.successRate || 0)}%
                </p>
              </div>
              <TrendingUp className="h-4 w-4 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Failed</p>
                <p className="text-2xl font-bold text-red-600">
                  {stats?.failedEvents || 0}
                </p>
              </div>
              <XCircle className="h-4 w-4 text-red-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pending/Processing</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {stats?.pendingEvents || 0}
                </p>
              </div>
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Events */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Recent Events
              </CardTitle>
              <CardDescription>
                Track delivery status and history for your notifications
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={selectedTimeRange} onValueChange={setSelectedTimeRange}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Time range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="1h">Last Hour</SelectItem>
                  <SelectItem value="24h">Last 24 Hours</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>
              <Select value={selectedImage} onValueChange={setSelectedImage}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Filter by image" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Images</SelectItem>
                  {Array.from(new Set(events.map(e => e.imageName))).map(imageName => (
                    <SelectItem key={imageName} value={imageName}>{imageName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2">Loading notification history...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center p-8 text-red-600">
              <AlertCircle className="h-5 w-5 mr-2" />
              {error}
            </div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Package className="h-5 w-5 mr-2" />
              No notification events found
            </div>
          ) : (
            <div className="space-y-2">
              {events
                .filter(event => selectedImage === "all" || event.imageName === selectedImage)
                .filter(event => selectedStatus === "all" || event.status === selectedStatus)
                .filter(event => {
                  if (selectedTimeRange === "all") return true;

                  const now = new Date();
                  const eventTime = event.createdAt;
                  const diffMs = now.getTime() - eventTime.getTime();

                  switch (selectedTimeRange) {
                    case "1h":
                      return diffMs <= 60 * 60 * 1000; // 1 hour
                    case "24h":
                      return diffMs <= 24 * 60 * 60 * 1000; // 24 hours
                    case "7d":
                      return diffMs <= 7 * 24 * 60 * 60 * 1000; // 7 days
                    case "30d":
                      return diffMs <= 30 * 24 * 60 * 60 * 1000; // 30 days
                    default:
                      return true;
                  }
                })
                .map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:border-gray-300 cursor-pointer transition-colors"
                    onClick={() => setSelectedEvent(event.id)}
                  >
                    <div className="flex items-center gap-3">
                      {getStatusIcon(event.status)}
                      {event.notification.notificationType === 'email' ? (
                        <Mail className="h-4 w-4 text-gray-600" />
                      ) : (
                        <Webhook className="h-4 w-4 text-gray-600" />
                      )}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">
                            {event.imageName}:{event.imageTag}
                          </p>
                          <Badge variant="outline" className="text-xs">
                            {eventLabels[event.eventType]}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {event.notification.notificationType === 'email' ? 'Email to' : 'Webhook to'} {event.notification.target}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={event.status === 'delivered' ? 'default' :
                                 event.status === 'failed' ? 'destructive' :
                                 'outline'}
                          className="text-xs"
                        >
                          {event.status}
                        </Badge>
                        {event.attempts > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {event.attempts} retr{event.attempts === 1 ? 'y' : 'ies'}
                          </span>
                        )}
                        {event.status === 'failed' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRetryConfirmation(event.id);
                            }}
                            className="h-6 w-6 p-0"
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {event.status === 'delivered' ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">Delivered {formatTime(event.updatedAt)}</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{getRelativeTime(event.updatedAt)}</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : event.status === 'failed' && event.nextRetryAt ? (
                          <span>
                            Failed - Next retry{' '}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help">{formatTime(event.nextRetryAt)}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{getRelativeTime(event.nextRetryAt)}</p>
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        ) : event.status === 'processing' && event.nextRetryAt ? (
                          <span>
                            Processing - Retry{' '}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help">{formatTime(event.nextRetryAt)}</span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{getRelativeTime(event.nextRetryAt)}</p>
                              </TooltipContent>
                            </Tooltip>
                          </span>
                        ) : (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help">Created {formatTime(event.createdAt)}</span>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{getRelativeTime(event.createdAt)}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Event Detail Modal */}
      <Dialog open={!!selectedEvent} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Event Details</DialogTitle>
          </DialogHeader>
              {(() => {
                const event = events.find(e => e.id === selectedEvent);
                if (!event) return null;

                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Image</Label>
                        <p className="text-sm">{event.imageName}:{event.imageTag}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Event Type</Label>
                        <p className="text-sm">{eventLabels[event.eventType]}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Type</Label>
                        <p className="text-sm capitalize">{event.notification.notificationType}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Status</Label>
                        <div className="mt-1">
                          <Badge variant={event.status === 'delivered' ? 'default' :
                                        event.status === 'failed' ? 'destructive' : 'outline'}>
                            {event.status}
                          </Badge>
                        </div>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Target</Label>
                        <p className="text-sm break-all">{event.notification.target}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Retries</Label>
                        <p className="text-sm">{event.attempts} / {event.maxAttempts - 1} max</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Created</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-sm cursor-help">{formatDetailDateTime(event.createdAt)}</p>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{getRelativeTime(event.createdAt)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Last Updated</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-sm cursor-help">{formatDetailDateTime(event.updatedAt)}</p>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{getRelativeTime(event.updatedAt)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    {event.lastError && (
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Error</Label>
                        <p className="text-sm text-red-600">{event.lastError}</p>
                      </div>
                    )}
                    {event.notification.notificationType === 'webhook' && event.responseCode && (
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Response Code</Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant={event.responseCode >= 200 && event.responseCode < 300 ? 'default' : 'destructive'}>
                            {event.responseCode}
                          </Badge>
                          <span className="text-sm text-muted-foreground">
                            {event.responseCode >= 200 && event.responseCode < 300 ? 'Success' : 'Error'}
                          </span>
                        </div>
                      </div>
                    )}
                    {event.notification.notificationType === 'webhook' && event.responseBody && (
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Response Body</Label>
                        <div className="mt-1 p-2 bg-gray-50 rounded text-xs font-mono max-h-32 overflow-y-auto">
                          {event.responseBody}
                        </div>
                      </div>
                    )}
                    {event.nextRetryAt && event.status !== 'delivered' && (
                      <div>
                        <Label className="text-sm font-medium text-muted-foreground">Next Retry Scheduled</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-sm cursor-help">{formatDetailDateTime(event.nextRetryAt)}</p>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{getRelativeTime(event.nextRetryAt)}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  </div>
                );
              })()}
        </DialogContent>
      </Dialog>

      {/* Retry Confirmation Modal */}
      <Dialog open={!!retryConfirmation} onOpenChange={(open) => !open && setRetryConfirmation(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Retry Notification</DialogTitle>
            <DialogDescription>
              Are you sure you want to retry this failed notification? This will reset the event to pending status and attempt delivery again immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetryConfirmation(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => retryConfirmation && handleRetryNotification(retryConfirmation)}
              disabled={isRetrying}
            >
              {isRetrying ? 'Retrying...' : 'Retry Now'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </TooltipProvider>
  )
}
