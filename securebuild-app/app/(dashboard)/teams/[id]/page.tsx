"use client"

import { useState, useEffect } from "react"
import { useSession } from "@/app/hooks/use-session"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"

import { listTeamsAction } from "@/lib/team/actions/list-teams"
import { Team, TeamSubscription } from "@/lib/types/team"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { createGodModeNonceAction } from "@/lib/team/actions/create-god-mode-nonce"
import { listTeamPricingAction } from "@/lib/team/actions/list-team-pricing"
import { listTeamSubscriptionsAction } from "@/lib/team/actions/list-team-subscriptions"
import { createFreeSubscriptionAction } from "@/lib/team/actions/create-free-subscription"
import { cancelSubscriptionAction } from "@/lib/team/actions/cancel-subscription"
import { listCatalogItemsAction } from "@/lib/catalog/actions/list-catalog-items"
import { setTeamPricingAction } from "@/lib/team/actions/set-team-pricing"
import { removeTeamPricingAction } from "@/lib/team/actions/remove-team-pricing"
import { Input } from "@/components/ui/input"
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Plus } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { getTeamAction } from "@/lib/team/actions/get-team"
import { updateTeamFeatureFlagsAction } from "@/lib/team/actions/update-team-feature-flags"
import { AVAILABLE_FEATURE_FLAGS } from "@/lib/constants/feature-flags"

const formatPrice = (price: number) => `$${price.toFixed(2)}`;

const formatPriceFromCents = (priceInCents: number) => `$${(priceInCents / 100).toFixed(2)}`;

const formatDate = (date: Date | null | undefined) => {
  if (!date) {
    return 'N/A';
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(date));
};

const formatBillingInterval = (interval: string | null, count: number | null) => {
  if (!interval || count === null) {
    return 'No billing cycle';
  }
  if (count === 1) {
    return interval === 'month' ? 'Monthly' : interval === 'year' ? 'Yearly' : interval;
  }
  return `Every ${count} ${interval}${count > 1 ? 's' : ''}`;
};

export default function TeamDetailsPage() {
  const { session, isSessionLoading } = useSession()
  const user = session?.user
  const router = useRouter()
  const params = useParams()
  const teamId = params.id as string

  const [team, setTeam] = useState<Team | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isGodModeModalOpen, setIsGodModeModalOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [pricingModalOpen, setPricingModalOpen] = useState(false)
  const [selectedCatalogItemId, setSelectedCatalogItemId] = useState<string | undefined>(undefined)
  const [monthlyPrice, setMonthlyPrice] = useState("")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [catalogItems, setCatalogItems] = useState<{ id: string; name: string }[]>([])
  const [teamPricing, setTeamPricing] = useState<{
    id: string;
    catalogItemId: string;
    catalogItemName: string;
    priceMonthly: number;
    catalogItemImageUrl: string;
    createdAt: string;
  }[]>([])
  const [pricingLoading, setPricingLoading] = useState(true)
  const [pricingError, setPricingError] = useState<string | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingPricing, setEditingPricing] = useState<any | null>(null)
  const [editPrice, setEditPrice] = useState("")
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false)
  const [removingPricing, setRemovingPricing] = useState<any | null>(null)
  
  // Subscription state
  const [teamSubscriptions, setTeamSubscriptions] = useState<TeamSubscription[]>([])
  const [subscriptionsLoading, setSubscriptionsLoading] = useState(true)
  const [subscriptionsError, setSubscriptionsError] = useState<string | null>(null)
  
  // Subscription creation state
  const [creatingSubscription, setCreatingSubscription] = useState<string | null>(null) // catalogItemId being processed
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null)
  
  // Subscription cancellation state
  const [cancelSubscriptionDialogOpen, setCancelSubscriptionDialogOpen] = useState(false)
  const [subscriptionToCancel, setSubscriptionToCancel] = useState<TeamSubscription | null>(null)
  const [cancelingSubscription, setCancelingSubscription] = useState(false)
  const [cancelSubscriptionError, setCancelSubscriptionError] = useState<string | null>(null)
  
  // Feature flags state
  const [featureFlagsUpdating, setFeatureFlagsUpdating] = useState(false)
  const [featureFlagsUpdateError, setFeatureFlagsUpdateError] = useState<string | null>(null)
  const [pendingFeatureFlags, setPendingFeatureFlags] = useState<string[]>([])

  useEffect(() => {
    if (!session || !teamId) return

    const fetchTeam = async () => {
      try {
        setLoading(true)
        const currentTeam = await getTeamAction(teamId)
        setTeam(currentTeam)
        setPendingFeatureFlags(currentTeam.featureFlags || [])
      } catch (err) {
        console.error("Failed to fetch team:", err)
        setError("Failed to load team details")
      } finally {
        setLoading(false)
      }
    }

    fetchTeam()
  }, [session, teamId])

  const handleGodMode = async () => {
    if (!session || !team) return

    setIsSubmitting(true)
    try {
      const nonce = await createGodModeNonceAction(team.id)
      window.open(`${process.env.NEXT_PUBLIC_GODMODE_REDIRECT}#${nonce}`, "_blank")
    } catch (err) {
      console.error("Failed to enter God Mode:", err)
      // TODO: Show an error to the user in the modal
    } finally {
      setIsSubmitting(false)
      setIsGodModeModalOpen(false)
    }
  }

  const handleAddPricing = async () => {
    if (!session || !team || !selectedCatalogItemId || !monthlyPrice) return

    setIsSubmitting(true)
    setSubmitError(null)
    try {
      await setTeamPricingAction(team.id, selectedCatalogItemId, parseFloat(monthlyPrice))
      setTeamPricing([
        ...teamPricing,
        {
          id: Math.random().toString(), // Temporary ID for UI
          catalogItemId: selectedCatalogItemId,
          catalogItemName: catalogItems.find(i => i.id === selectedCatalogItemId)?.name || '',
          priceMonthly: parseFloat(monthlyPrice),
          catalogItemImageUrl: '', // You may want to fetch this if needed
          createdAt: new Date().toISOString(),
        },
      ])
      setSelectedCatalogItemId(undefined)
      setMonthlyPrice("")
    } catch (err) {
      console.error("Failed to add pricing:", err)
      setSubmitError("Failed to add pricing")
    } finally {
      setIsSubmitting(false)
      setPricingModalOpen(false)
    }
  }

  const handleCreateSubscription = async (catalogItemId: string) => {
    if (!session || !team) return

    setCreatingSubscription(catalogItemId)
    setSubscriptionError(null)
    try {
      await createFreeSubscriptionAction(team.id, catalogItemId)
      
      // Refresh subscriptions to show the new one
      const subscriptions = await listTeamSubscriptionsAction(team.id)
      setTeamSubscriptions(subscriptions)
    } catch (err) {
      console.error("Failed to create subscription:", err)
      // Show specific error message if available, otherwise use generic message
      const errorMessage = err instanceof Error ? err.message : "Failed to create subscription"
      setSubscriptionError(errorMessage)
    } finally {
      setCreatingSubscription(null)
    }
  }

  const handleCancelSubscription = async () => {
    if (!session || !team || !subscriptionToCancel) return

    setCancelingSubscription(true)
    setCancelSubscriptionError(null)
    try {
      await cancelSubscriptionAction(team.id, subscriptionToCancel.subscriptionId)
      
      // Refresh subscriptions to remove the canceled one
      const subscriptions = await listTeamSubscriptionsAction(team.id)
      setTeamSubscriptions(subscriptions)
      
      // Close the dialog
      setCancelSubscriptionDialogOpen(false)
      setSubscriptionToCancel(null)
    } catch (err) {
      console.error("Failed to cancel subscription:", err)
      const errorMessage = err instanceof Error ? err.message : "Failed to cancel subscription"
      setCancelSubscriptionError(errorMessage)
    } finally {
      setCancelingSubscription(false)
    }
  }

  const openCancelDialog = (subscription: TeamSubscription) => {
    setSubscriptionToCancel(subscription)
    setCancelSubscriptionError(null)
    setCancelSubscriptionDialogOpen(true)
  }
  
  const handleFeatureFlagToggle = (flagKey: string, checked: boolean) => {
    if (checked) {
      setPendingFeatureFlags(prev => [...prev.filter(f => f !== flagKey), flagKey])
    } else {
      setPendingFeatureFlags(prev => prev.filter(f => f !== flagKey))
    }
  }
  
  const handleFeatureFlagsUpdate = async () => {
    if (!session || !teamId) return
    
    setFeatureFlagsUpdating(true)
    setFeatureFlagsUpdateError(null)
    
    try {
      await updateTeamFeatureFlagsAction(teamId, pendingFeatureFlags)
      
      // Update the team state to reflect the new feature flags
      if (team) {
        setTeam({ ...team, featureFlags: pendingFeatureFlags })
      }
    } catch (err) {
      console.error('Failed to update feature flags:', err)
      setFeatureFlagsUpdateError(err instanceof Error ? err.message : 'Failed to update feature flags')
    } finally {
      setFeatureFlagsUpdating(false)
    }
  }

  useEffect(() => {
    if (!session || !teamId) return

    const fetchCatalogItems = async () => {
      try {
        setCatalogLoading(true)
        const items = await listCatalogItemsAction()
        if (items) {
          setCatalogItems(items)
        } else {
          setCatalogError("No catalog items found")
        }
      } catch (err) {
        console.error("Failed to fetch catalog items:", err)
        setCatalogError("Failed to load catalog items")
      } finally {
        setCatalogLoading(false)
      }
    }

    fetchCatalogItems()
  }, [session, teamId])

  useEffect(() => {
    if (!session || !teamId) return

    const fetchTeamPricing = async () => {
      try {
        setPricingLoading(true)
        const pricing = await listTeamPricingAction(teamId)
        if (pricing) {
          setTeamPricing(pricing.map(p => ({
            ...p,
            createdAt: typeof p.createdAt === 'string' ? p.createdAt : p.createdAt.toISOString(),
            catalogItemId: p.catalogItemId
          })))
        } else {
          setPricingError("No pricing found")
        }
      } catch (err) {
        console.error("Failed to fetch team pricing:", err)
        setPricingError("Failed to load team pricing")
      } finally {
        setPricingLoading(false)
      }
    }

    fetchTeamPricing()
  }, [session, teamId])

  useEffect(() => {
    if (!session || !teamId) return

    const fetchTeamSubscriptions = async () => {
      try {
        setSubscriptionsLoading(true)
        const subscriptions = await listTeamSubscriptionsAction(teamId)
        setTeamSubscriptions(subscriptions)
      } catch (err) {
        console.error("Failed to fetch team subscriptions:", err)
        setSubscriptionsError("Failed to load team subscriptions")
      } finally {
        setSubscriptionsLoading(false)
      }
    }

    fetchTeamSubscriptions()
  }, [session, teamId])


  if (isSessionLoading || !session || !user) {
    return <div>Loading...</div>
  }

  return (
    <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <Button variant="outline" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-2xl font-bold">Team Details</h1>
            <div />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{loading ? "Loading..." : team?.name}</CardTitle>
                <CardDescription>
                  Manage and view team details
                </CardDescription>
              </div>
              <Dialog open={isGodModeModalOpen} onOpenChange={setIsGodModeModalOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">God Mode</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Enter God Mode?</DialogTitle>
                    <DialogDescription>
                      You are about to view the site as the team "{team?.name}". Be
                      careful, as any changes you make will be saved.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setIsGodModeModalOpen(false)}
                      disabled={isSubmitting}
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleGodMode} disabled={isSubmitting}>
                      {isSubmitting ? "Entering..." : "Accept and Continue"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">
                  <p className="text-slate-600 dark:text-slate-400">Loading team details...</p>
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <p className="text-red-600 dark:text-red-400">{error}</p>
                </div>
              ) : team ? (
                <div className="grid gap-4">
                  <div>
                    <h3 className="font-semibold">Team Name</h3>
                    <p>{team.name}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold">Team ID</h3>
                    <p className="font-mono text-sm text-slate-600 dark:text-slate-400">{team.id}</p>
                  </div>
                  <div>
                    <h3 className="font-semibold">Created At</h3>
                    <p>
                      {new Date(team.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                </div>
              ) : (
                 <div className="text-center py-8">
                  <p className="text-slate-600 dark:text-slate-400">No team details available.</p>
                </div>
              )}
              
              {/* Feature Flags Section */}
              {team && (
                <div className="mt-8">
                  <Card>
                    <CardHeader>
                      <div>
                        <CardTitle>Feature Flags</CardTitle>
                        <CardDescription>
                          Control which features this team can access
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-6">
                          {/* Feature Flag Controls */}
                          <div className="space-y-4">
                            {AVAILABLE_FEATURE_FLAGS.map(flag => {
                              const isEnabled = pendingFeatureFlags.includes(flag.key)
                              return (
                                <div key={flag.key} className="flex items-start space-x-3">
                                  <Checkbox
                                    id={flag.key}
                                    checked={isEnabled}
                                    onCheckedChange={(checked) => handleFeatureFlagToggle(flag.key, checked === true)}
                                    disabled={featureFlagsUpdating}
                                  />
                                  <div className="grid gap-1.5 leading-none">
                                    <label
                                      htmlFor={flag.key}
                                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                                    >
                                      {flag.name}
                                    </label>
                                    <p className="text-xs text-muted-foreground">
                                      {flag.description}
                                    </p>
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          {/* Error Messages */}
                          {featureFlagsUpdateError && (
                            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
                              {featureFlagsUpdateError}
                            </div>
                          )}

                          {/* Save Button */}
                          <div>
                            <Button
                              onClick={handleFeatureFlagsUpdate}
                              disabled={featureFlagsUpdating}
                            >
                              {featureFlagsUpdating ? "Saving..." : "Save Feature Flags"}
                            </Button>
                          </div>
                        </div>
                    </CardContent>
                  </Card>
                </div>
              )}
              
              {team && (
                <div className="mt-8">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle>Special Pricing</CardTitle>
                        <CardDescription>
                          Set custom pricing for catalog items for this team
                        </CardDescription>
                      </div>
                      <Dialog open={pricingModalOpen} onOpenChange={setPricingModalOpen}>
                        <DialogTrigger asChild>
                          <Button>
                            <Plus className="h-4 w-4 mr-2" />
                            Add Special Pricing
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Add Special Pricing</DialogTitle>
                            <DialogDescription>
                              Set custom pricing for a catalog item for this team
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4">
                            {submitError && (
                              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
                                {submitError}
                              </div>
                            )}
                            <div>
                              <Label htmlFor="catalog-item">Catalog Item</Label>
                              <Select
                                value={selectedCatalogItemId}
                                onValueChange={setSelectedCatalogItemId}
                                disabled={catalogLoading}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={catalogLoading ? "Loading..." : "Select a catalog item"} />
                                </SelectTrigger>
                                <SelectContent>
                                  {catalogItems.map((item, index) => (
                                    <SelectItem key={item.id || `item-${index}`} value={item.id}>
                                      {item.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {catalogError && (
                                <p className="text-sm text-red-600 mt-1">{catalogError}</p>
                              )}
                            </div>
                            <div>
                              <Label htmlFor="monthly-price">Monthly Price ($)</Label>
                              <Input
                                id="monthly-price"
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={monthlyPrice}
                                onChange={(e) => setMonthlyPrice(e.target.value)}
                                disabled={isSubmitting}
                              />
                            </div>
                          </div>
                          <DialogFooter>
                            <Button
                              variant="outline"
                              onClick={() => setPricingModalOpen(false)}
                              disabled={isSubmitting}
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={handleAddPricing}
                              disabled={isSubmitting || !selectedCatalogItemId || !monthlyPrice}
                            >
                              {isSubmitting ? "Adding..." : "Add Pricing"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </CardHeader>
                    <CardContent>
                      {subscriptionError && (
                        <div className="mb-4 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
                          {subscriptionError}
                        </div>
                      )}
                      {pricingLoading ? (
                        <div className="text-center py-8">
                          <p className="text-slate-600 dark:text-slate-400">Loading special pricing...</p>
                        </div>
                      ) : pricingError ? (
                        <div className="text-center py-8">
                          <p className="text-red-600 dark:text-red-400">{pricingError}</p>
                        </div>
                      ) : teamPricing.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-slate-600 dark:text-slate-400">
                            No special pricing configured yet. Click "Add Special Pricing" to get started.
                          </p>
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Catalog Item</TableHead>
                              <TableHead>Monthly Price</TableHead>
                              <TableHead>Created</TableHead>
                              <TableHead>Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {teamPricing.map((pricing, index) => (
                              <TableRow key={pricing.id || `pricing-${index}`}>
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <img
                                      src={pricing.catalogItemImageUrl}
                                      alt={pricing.catalogItemName}
                                      className="h-8 w-8 rounded object-cover"
                                    />
                                    <div className="font-medium">{pricing.catalogItemName}</div>
                                  </div>
                                </TableCell>
                                <TableCell className="font-semibold text-green-600 dark:text-green-400">
                                  {formatPrice(pricing.priceMonthly)}
                                </TableCell>
                                <TableCell>
                                  {pricing.createdAt}
                                </TableCell>
                                <TableCell>
                                  {pricing.priceMonthly === 0 && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="mr-2"
                                      onClick={() => handleCreateSubscription(pricing.catalogItemId)}
                                      disabled={creatingSubscription === pricing.catalogItemId}
                                    >
                                      {creatingSubscription === pricing.catalogItemId ? "Creating..." : "Add Subscription"}
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setEditingPricing(pricing)
                                      setEditPrice(pricing.priceMonthly.toString())
                                      setEditDialogOpen(true)
                                    }}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="ml-2"
                                    onClick={() => {
                                      setRemovingPricing(pricing)
                                      setRemoveDialogOpen(true)
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
              
              {/* Subscriptions Section */}
              {team && (
                <div className="mt-8">
                  <Card>
                    <CardHeader>
                      <div>
                        <CardTitle>Subscriptions</CardTitle>
                        <CardDescription>
                          Current active subscriptions for this team
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {subscriptionsLoading ? (
                        <div className="text-center py-8">
                          <p className="text-slate-600 dark:text-slate-400">Loading subscriptions...</p>
                        </div>
                      ) : subscriptionsError ? (
                        <div className="text-center py-8">
                          <p className="text-red-600 dark:text-red-400">{subscriptionsError}</p>
                        </div>
                      ) : teamSubscriptions.length === 0 ? (
                        <div className="text-center py-8">
                          <p className="text-slate-600 dark:text-slate-400">
                            No active subscriptions found for this team.
                          </p>
                        </div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Catalog Item</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Price</TableHead>
                              <TableHead>Billing</TableHead>
                              <TableHead>Current Period</TableHead>
                              <TableHead>Created</TableHead>
                              <TableHead>Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {teamSubscriptions.map((subscription, index) => (
                              <TableRow key={subscription.id || `subscription-${index}`}>
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    {subscription.catalogItemImageUrl && (
                                      <img
                                        src={subscription.catalogItemImageUrl}
                                        alt={subscription.catalogItemName}
                                        className="h-8 w-8 rounded object-cover"
                                      />
                                    )}
                                    <Link 
                                      href={`/catalog/${subscription.catalogItemId}`}
                                      className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                                    >
                                      {subscription.catalogItemName}
                                    </Link>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                                    subscription.status === 'active' 
                                      ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                                      : subscription.isCanceled 
                                      ? 'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400'
                                      : 'bg-gray-100 text-gray-800 dark:bg-gray-900/20 dark:text-gray-400'
                                  }`}>
                                    {subscription.isCanceled ? 'Canceled' : subscription.status}
                                  </span>
                                </TableCell>
                                <TableCell className="font-semibold text-green-600 dark:text-green-400">
                                  {formatPriceFromCents(subscription.price)}
                                </TableCell>
                                <TableCell>
                                  <span className={subscription.recurringInterval && subscription.recurringIntervalCount ? "" : "text-gray-500 dark:text-gray-400"}>
                                    {formatBillingInterval(subscription.recurringInterval, subscription.recurringIntervalCount)}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm">
                                    {subscription.currentPeriodStart && subscription.currentPeriodEnd ? (
                                      <>
                                        <div>{formatDate(subscription.currentPeriodStart)} -</div>
                                        <div>{formatDate(subscription.currentPeriodEnd)}</div>
                                      </>
                                    ) : (
                                      <div className="text-gray-500 dark:text-gray-400">No billing period</div>
                                    )}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {formatDate(subscription.createdAt)}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() => openCancelDialog(subscription)}
                                    disabled={subscription.isCanceled}
                                  >
                                    Cancel
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </CardContent>
          </Card>

      {/* Edit Pricing Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Special Pricing</DialogTitle>
            <DialogDescription>
              Update the monthly price for this catalog item.
            </DialogDescription>
          </DialogHeader>
          {editError && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
              {editError}
            </div>
          )}
          <div>
            <Label htmlFor="edit-monthly-price">Monthly Price ($)</Label>
            <Input
              id="edit-monthly-price"
              type="number"
              step="0.01"
              placeholder="0.00"
              value={editPrice}
              onChange={e => setEditPrice(e.target.value)}
              disabled={editSubmitting}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={editSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!session || !team || !editingPricing) return
                setEditSubmitting(true)
                setEditError(null)
                try {
                  await setTeamPricingAction(team.id, editingPricing.catalogItemId, parseFloat(editPrice))
                  setTeamPricing(teamPricing.map(p =>
                    p.catalogItemId === editingPricing.catalogItemId
                      ? { ...p, priceMonthly: parseFloat(editPrice) }
                      : p
                  ))
                  setEditDialogOpen(false)
                } catch (err) {
                  setEditError("Failed to update pricing")
                } finally {
                  setEditSubmitting(false)
                }
              }}
              disabled={editSubmitting || !editPrice}
            >
              {editSubmitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Remove Pricing Confirmation Dialog */}
      <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Special Pricing</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove special pricing for <b>{removingPricing?.catalogItemName}</b>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveDialogOpen(false)}
              disabled={editSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!session || !team || !removingPricing) return
                setEditSubmitting(true)
                try {
                  await removeTeamPricingAction(team.id, removingPricing.catalogItemId)
                  setTeamPricing(teamPricing.filter(p => p.catalogItemId !== removingPricing.catalogItemId))
                  setRemoveDialogOpen(false)
                } catch (err) {
                  // Optionally show error
                } finally {
                  setEditSubmitting(false)
                }
              }}
              disabled={editSubmitting}
            >
              {editSubmitting ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Cancel Subscription Confirmation Dialog */}
      <Dialog open={cancelSubscriptionDialogOpen} onOpenChange={setCancelSubscriptionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Subscription</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel the subscription for <b>{subscriptionToCancel?.catalogItemName}</b>? 
              This action cannot be undone and the subscription will be canceled immediately.
            </DialogDescription>
          </DialogHeader>
          {cancelSubscriptionError && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-3 rounded-md">
              {cancelSubscriptionError}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCancelSubscriptionDialogOpen(false)}
              disabled={cancelingSubscription}
            >
              Keep Subscription
            </Button>
            <Button
              variant="destructive"
              onClick={handleCancelSubscription}
              disabled={cancelingSubscription}
            >
              {cancelingSubscription ? "Canceling..." : "Cancel Subscription"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
