"use client"

import { useState, useEffect } from "react"
import { Bell, Mail, Plus, X, Webhook, AlertTriangle, Trash2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useSession } from "@/app/hooks/use-session"
import { listNotificationsAction } from "@/lib/notification/actions/list-notifications"
import { updateNotificationEnabledAction } from "@/lib/notification/actions/update-notification-enabled"
import { deleteNotificationAction } from "@/lib/notification/actions/delete-notification"
import { NotificationWithImage } from "@/lib/types/notification"
import { useRouter } from "next/navigation"

export default function NotificationsPage() {
  const { session } = useSession()
  const router = useRouter()
  const [notifications, setNotifications] = useState<NotificationWithImage[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteConfirmation, setDeleteConfirmation] = useState<NotificationWithImage | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    if (!session) return

    const fetchData = async () => {
      setLoading(true)
      try {
        const notifs = await listNotificationsAction(session)
        setNotifications(notifs)
      } catch (error) {
        console.error("Failed to fetch data:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [session])

  // Refresh data when the page gains focus (user returns from add page)
  useEffect(() => {
    const handleFocus = () => {
      if (session) {
        const fetchData = async () => {
          try {
            const notifs = await listNotificationsAction(session)
            setNotifications(notifs)
          } catch (error) {
            console.error("Failed to refresh notifications:", error)
          }
        }
        fetchData()
      }
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [session])

  const handleToggleNotification = async (notificationId: string, enabled: boolean) => {
    if (!session) return

    try {
      await updateNotificationEnabledAction(session, notificationId, enabled)
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, enabled } : n)
      )
    } catch (error) {
      console.error("Failed to update notification:", error)
    }
  }

  const handleDeleteNotification = async (notification: NotificationWithImage) => {
    if (!session) return

    setIsDeleting(true)
    try {
      await deleteNotificationAction(session, notification.id)
      setNotifications(prev => prev.filter(n => n.id !== notification.id))
      setDeleteConfirmation(null)
    } catch (error) {
      console.error("Failed to delete notification:", error)
    } finally {
      setIsDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p>Loading...</p>
      </div>
    )
  }



    return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground">
            Configure notifications for your subscribed images. Get notified when tags are updated, new tags are available, or CVEs are found.
          </p>
        </div>
        <Button onClick={() => router.push('/dashboard/notifications/add')}>
          <Plus className="h-4 w-4 mr-2" />
          Add Notification
        </Button>
      </div>

      {/* Notifications List */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            {notifications.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No notifications configured</p>
                <p className="text-sm">Create your first notification to get started</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div key={notification.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                  <div
                    className="flex items-center gap-3 flex-1 cursor-pointer"
                    onClick={() => router.push(`/dashboard/notifications/${notification.id}/edit`)}
                  >
                    {notification.notificationType === 'email' ? (
                      <Mail className="h-5 w-5 text-blue-600" />
                    ) : (
                      <Webhook className="h-5 w-5 text-purple-600" />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">
                          {notification.notificationType === 'email' ? 'Email to' : 'Webhook to'}
                        </span>
                        <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">
                          {notification.target}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>for</span>
                        <div className="flex gap-1">
                          <Badge variant="secondary" className="text-xs">
                            {notification.image.name}
                          </Badge>
                        </div>
                        <span>on</span>
                        <div className="flex gap-1">
                          {notification.events.map((event) => (
                            <Badge key={event} variant="outline" className="text-xs">
                              {event === 'tag_updated' ? 'Tag Updated' :
                               event === 'new_tag' ? 'New Tag' :
                               'CVE Found'}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={notification.enabled}
                      onCheckedChange={(checked) => handleToggleNotification(notification.id, checked)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmation(notification);
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!deleteConfirmation} onOpenChange={(open) => !open && setDeleteConfirmation(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Delete Notification
            </DialogTitle>
                                    <DialogDescription>
              Are you sure you want to delete this notification? This action is <strong>irreversible</strong>.
            </DialogDescription>
          </DialogHeader>

          {deleteConfirmation && (
            <div className="bg-gray-50 p-3 rounded-lg border mx-6">
              <div className="flex items-center gap-2 mb-2">
                {deleteConfirmation.notificationType === 'email' ? (
                  <Mail className="h-4 w-4 text-blue-600" />
                ) : (
                  <Webhook className="h-4 w-4 text-purple-600" />
                )}
                <span className="text-sm font-medium">
                  {deleteConfirmation.notificationType === 'email' ? 'Email' : 'Webhook'} notification
                </span>
              </div>
              <div className="text-sm text-gray-600 space-y-1">
                <div><strong>Target:</strong> {deleteConfirmation.target}</div>
                <div><strong>Image:</strong> {deleteConfirmation.image.name}</div>
                <div>
                  <strong>Events:</strong> {deleteConfirmation.events.map(event =>
                    event === 'tag_updated' ? 'Tag Updated' :
                    event === 'new_tag' ? 'New Tag' : 'CVE Found'
                  ).join(', ')}
                </div>
              </div>
            </div>
          )}

          <div className="px-6 text-sm text-gray-500">
            You will no longer receive notifications for the configured events.
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmation(null)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmation && handleDeleteNotification(deleteConfirmation)}
              disabled={isDeleting}
              className="gap-2"
            >
              {isDeleting ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete Notification
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
