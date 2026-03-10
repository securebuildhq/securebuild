"use client"

import { useEffect, useState } from "react"
import {
  Check,
  X,
  Loader2
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { listTeamSubscriptionsAction } from "@/lib/team/actions/list-subscriptions"
import { refreshTeamSubscriptionsAction } from "@/lib/team/actions/refresh-team-subscriptions"
import { cancelSubscriptionAction } from "@/lib/team/actions/cancel-subscription"
import { useSession } from "@/app/hooks/use-session"

export default function BillingPage() {
  const [activeSubscriptions, setActiveSubscriptions] = useState<Array<{
    id: string;
    catalogItem: { name: string; imageUrl?: string };
    price: number;
    startedAt: Date;
    currentPeriodEnd: Date;
    isCanceled: boolean;
    status: string;
  }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [subscriptionToCancel, setSubscriptionToCancel] = useState<{
    id: string;
    catalogItem: { name: string };
    currentPeriodEnd: Date;
    isCanceled: boolean;
  } | null>(null)
  const { session } = useSession();

  useEffect(() => {
    if (!session) {
      return;
    }
    const fetchActiveSubscriptions = async () => {
      setIsLoading(true)
      await refreshTeamSubscriptionsAction(session);
      const subscriptions = await listTeamSubscriptionsAction(session);
      // Filter out subscriptions without catalogItem and cast to expected type
      const validSubscriptions = subscriptions
        .filter((sub): sub is typeof sub & { catalogItem: NonNullable<typeof sub.catalogItem> } => 
          sub.catalogItem !== undefined
        );
      setActiveSubscriptions(validSubscriptions);
      setIsLoading(false)
    }
    fetchActiveSubscriptions();
  }, [session]);

  const handleCancelClick = (subscription: {
    id: string;
    catalogItem: { name: string };
    currentPeriodEnd: Date;
    isCanceled: boolean;
  }) => {
    setSubscriptionToCancel(subscription)
    setShowCancelModal(true)
  }

  const handleCancelConfirm = async () => {
    if (!session || !subscriptionToCancel) return

    // Don't allow canceling already canceled subscriptions
    if (subscriptionToCancel.isCanceled) {
      setShowCancelModal(false)
      setSubscriptionToCancel(null)
      return
    }

    try {
      setIsLoading(true)
      await cancelSubscriptionAction(session, subscriptionToCancel.id)
      const subscriptions = await listTeamSubscriptionsAction(session)
      // Filter out subscriptions without catalogItem and cast to expected type
      const validSubscriptions = subscriptions
        .filter((sub): sub is typeof sub & { catalogItem: NonNullable<typeof sub.catalogItem> } => 
          sub.catalogItem !== undefined
        );
      setActiveSubscriptions(validSubscriptions)
    } catch (error) {
      console.error('Failed to cancel subscription:', error)
    } finally {
      setIsLoading(false)
      setShowCancelModal(false)
      setSubscriptionToCancel(null)
    }
  }

  const handleCancelModalClose = () => {
    setShowCancelModal(false)
    setSubscriptionToCancel(null)
  }

  return (
    <div className="grid gap-6">

      {/* Active Subscriptions */}
      <Card>
        <CardHeader>
          <CardTitle>Subscriptions</CardTitle>
          <CardDescription>Your current and canceled image subscriptions</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-muted-foreground">Loading subscriptions...</span>
            </div>
          ) : activeSubscriptions.length === 0 ? (
            <p className="text-muted-foreground">No subscriptions found</p>
          ) : (
            <div className="space-y-4">
              {activeSubscriptions.map((activeSubscription) => (
                <div key={activeSubscription.id} className={`flex items-center justify-between p-4 border rounded-md ${activeSubscription.isCanceled ? 'opacity-60 bg-gray-50' : ''}`}>
                  <div className="flex items-center gap-4">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={activeSubscription.catalogItem.imageUrl || "/placeholder.svg"} alt={activeSubscription.catalogItem.name} />
                      <AvatarFallback>{activeSubscription.catalogItem.name[0].toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">
                        {activeSubscription.catalogItem.name} SecureBuild
                        {activeSubscription.isCanceled && (
                          <span className="ml-2 text-sm text-red-600 font-normal">(Canceled)</span>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">${activeSubscription.price/100} / month</p>
                    </div>
                  </div>
                  <div className="hidden md:flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-sm font-medium">Start Date</p>
                      <p className="text-sm text-muted-foreground">{activeSubscription.startedAt.toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {activeSubscription.isCanceled ? "Ends On" : "Next Billing"}
                      </p>
                      <p className="text-sm text-muted-foreground">{activeSubscription.currentPeriodEnd.toLocaleDateString()}</p>
                    </div>
                    {activeSubscription.isCanceled ? (
                      <Badge variant="outline" className="bg-red-50 text-red-700 hover:bg-red-50">
                        <X className="mr-1 h-3 w-3" />
                        Canceled
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-green-50 text-green-700 hover:bg-green-50">
                        <Check className="mr-1 h-3 w-3" />
                        {activeSubscription.status}
                      </Badge>
                    )}
                    {!activeSubscription.isCanceled && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleCancelClick(activeSubscription)}
                      >
                        <X className="mr-1 h-3 w-3" />
                        Cancel
                      </Button>
                    )}
                  </div>
                  <div className="md:hidden space-y-2">
                    {activeSubscription.isCanceled ? (
                      <Badge variant="outline" className="bg-red-50 text-red-700 hover:bg-red-50">
                        <X className="mr-1 h-3 w-3" />
                        Canceled
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-green-50 text-green-700 hover:bg-green-50">
                        <Check className="mr-1 h-3 w-3" />
                        {activeSubscription.status}
                      </Badge>
                    )}
                    {!activeSubscription.isCanceled && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full"
                        onClick={() => handleCancelClick(activeSubscription)}
                      >
                        <X className="mr-1 h-3 w-3" />
                        Cancel Subscription
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        <CardFooter>

        </CardFooter>
      </Card>


      {/* Cancel Subscription Confirmation Modal */}
      <Dialog open={showCancelModal} onOpenChange={handleCancelModalClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Subscription</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel your subscription to{" "}
              <strong>{subscriptionToCancel?.catalogItem?.name} SecureBuild</strong>?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              You&apos;ll continue to have access to this subscription through the end of your current billing period on{" "}
              <strong>
                {subscriptionToCancel?.currentPeriodEnd?.toLocaleDateString()}
              </strong>
              . After that date, your access will be removed and you won&apos;t be charged again.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelModalClose}>
              Keep Subscription
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelConfirm}
              className="bg-red-600 hover:bg-red-700"
            >
              Yes, Cancel Subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
