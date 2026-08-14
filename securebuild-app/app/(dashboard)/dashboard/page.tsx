"use client"

import { SetStateAction, useState, useEffect } from "react"
import { useRouter } from "next/navigation"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Rocket, Github, Package, Activity, CheckCircle, XCircle, Clock, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { TriggerPackageModal } from "@/components/trigger-package-modal"
import { AutoTriggerModal } from "@/components/auto-trigger-modal"
import { useSession } from "@/app/hooks/use-session"
import { executionsCountAction, ExecutionCounts } from "@/lib/execution/actions/executions-count"
import { isExecutionPausedAction } from "@/lib/execution/actions/is-execution-paused"
import { getDashboardStatsAction, getFailingPackagesAction, DashboardStats, FailingPackagesResult } from "@/lib/package/actions/get-dashboard-stats"
import { Package as PackageType } from "@/lib/types/package"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExternalImageStatsCard } from "@/components/external-image-stats-card"

export default function DashboardPage() {
  const { session, isSessionLoading } = useSession()
  const user = session?.user
  const router = useRouter()
  const [executionCounts, setExecutionCounts] = useState<ExecutionCounts>({
    running: 0,
    completed: 0,
    success: 0,
    failed: 0,
    failedBreakdown: {
      failed: 0,
      timedOut: 0,
      stalled: 0,
    },
    waitingForVMs: 0,
  })
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    totalPackages: 0,
    successfulPackages: 0,
    successRate: 0,
    packagesWithBuilds: 0,
    failedPackages: 0,
    packagesWithExternalDependencies: 0,
    failedBreakdown: {
      failed: 0,
      timedOut: 0,
      stalled: 0,
      vmDeleted: 0,
    }
  })
  const [failingPackagesData, setFailingPackagesData] = useState<FailingPackagesResult>({
    packages: [],
    totalCount: 0,
    totalPages: 0
  })
  const [loading, setLoading] = useState(false)
  const [isExecutionsPaused, setIsExecutionsPaused] = useState(false)

  // Failing packages pagination
  const [failingPackagesPage, setFailingPackagesPage] = useState(1)
  const FAILING_PACKAGES_PER_PAGE = 10

  // Modal states
  const [triggerModalOpen, setTriggerModalOpen] = useState(false)
  const [autoTriggerModalOpen, setAutoTriggerModalOpen] = useState(false)
  const [selectedPackage, setSelectedPackage] = useState<PackageType | null>(null)
  const [selectedTriggerType, setSelectedTriggerType] = useState<string | null>(null)

  // Fetch dashboard data
  useEffect(() => {
    if (!session) return;

    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        // Fetch dashboard stats and failing packages
        const [stats, failingPackages, counts, paused] = await Promise.all([
          getDashboardStatsAction(),
          getFailingPackagesAction(failingPackagesPage, FAILING_PACKAGES_PER_PAGE),
          executionsCountAction("1d"),
          isExecutionPausedAction()
        ]);

        setDashboardStats(stats);
        setFailingPackagesData(failingPackages);
        setExecutionCounts(counts);
        setIsExecutionsPaused(paused);

      } catch (error) {
        console.error("Failed to fetch dashboard data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [session, failingPackagesPage]);

  // Auto-refresh for live data
  useEffect(() => {
    if (!session) return;

    const interval = setInterval(async () => {
      try {
        // Refresh all data
        const [stats, failingPackages, counts, paused] = await Promise.all([
          getDashboardStatsAction(),
          getFailingPackagesAction(failingPackagesPage, FAILING_PACKAGES_PER_PAGE),
          executionsCountAction("1d"),
          isExecutionPausedAction()
        ]);

        setDashboardStats(stats);
        setFailingPackagesData(failingPackages);
        setExecutionCounts(counts);
        setIsExecutionsPaused(paused);
      } catch (error) {
        console.error("Failed to refresh dashboard data:", error);
      }
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [session, failingPackagesPage]);

  const handleTriggerPackage = (pkg: PackageType) => {
    setSelectedPackage(pkg)
    setTriggerModalOpen(true)
  }

  const handleAutoTrigger = (pkg: PackageType, triggerType: string) => {
    setSelectedPackage(pkg)
    setSelectedTriggerType(triggerType)
    setAutoTriggerModalOpen(true)
  }

  const handleExecuteTrigger = (opts: {
    refType: "tag" | "release" | "commit"
    refValue: string
    versionLabel: string
    archs: string[]
    publish: boolean
  }) => {
    console.log(
      "Triggering package:",
      selectedPackage?.name,
      "with refType:",
      opts.refType,
      "refValue:",
      opts.refValue,
      "versionLabel:",
      opts.versionLabel,
      "archs:",
      opts.archs,
      "publish:",
      opts.publish,
    )
    // In a real app, we would call an API to trigger the package build
  }

  const getStatusIcon = (status: string) => {
    const normalizedStatus = status.toLowerCase();
    switch (normalizedStatus) {
      case 'success':
        return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'failed':
      case 'timed_out':
      case 'stalled':
        return <XCircle className="h-3 w-3 text-red-500" />;
      case 'building':
      case 'publishing':
        return <Activity className="h-3 w-3 text-blue-500" />;
      case 'queued':
      case 'pending':
        return <Clock className="h-3 w-3 text-yellow-500" />;
      default:
        return <AlertTriangle className="h-3 w-3 text-gray-500" />;
    }
  };

  const formatStatus = (status: string) => {
    return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Session is handled by the dashboard layout
  if (!session || !user || isSessionLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading dashboard data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
                <div>Loading dashboard data...</div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-3xl font-bold">Dashboard</h1>
                {isExecutionsPaused && (
                  <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-3 py-2 rounded">
                    ⚠️ Executions are currently paused
                  </div>
                )}
              </div>

              <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-4 mb-8">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Total Packages</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{dashboardStats.totalPackages}</div>
                    <p className="text-xs text-muted-foreground mt-1">Connected packages</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Successful Packages</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {dashboardStats.successRate}%
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {dashboardStats.successfulPackages}/{dashboardStats.packagesWithBuilds} packages successful
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Failed Packages</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{dashboardStats.failedPackages}</div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Failed: {dashboardStats.failedBreakdown.failed},
                      Timed out: {dashboardStats.failedBreakdown.timedOut},
                      Stalled: {dashboardStats.failedBreakdown.stalled},
                      VM deleted: {dashboardStats.failedBreakdown.vmDeleted}
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Packages with External Dependencies</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className={`text-3xl font-bold ${(() => {
                      const cve0OnlyPercentage = dashboardStats.totalPackages > 0 
                        ? Math.round(((dashboardStats.totalPackages - dashboardStats.packagesWithExternalDependencies) / dashboardStats.totalPackages) * 100)
                        : 100;
                      
                      // Gradient from red (0%) to green (100%)
                      if (cve0OnlyPercentage >= 90) return 'text-green-600';
                      if (cve0OnlyPercentage >= 75) return 'text-green-500';
                      if (cve0OnlyPercentage >= 60) return 'text-yellow-500';
                      if (cve0OnlyPercentage >= 40) return 'text-orange-500';
                      if (cve0OnlyPercentage >= 20) return 'text-orange-600';
                      return 'text-red-600';
                    })()}`}>
                      {dashboardStats.packagesWithExternalDependencies}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {dashboardStats.totalPackages > 0 
                        ? Math.round(((dashboardStats.totalPackages - dashboardStats.packagesWithExternalDependencies) / dashboardStats.totalPackages) * 100)
                        : 100}% CVE0 only
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Failing Packages</CardTitle>
                  <CardDescription>
                    Packages that need attention ({failingPackagesData.totalCount} total)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {failingPackagesData.packages.length > 0 ? (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Package Name</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last Build</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {failingPackagesData.packages.map((pkg) => (
                        <TableRow key={pkg.id}>
                          <TableCell className="font-medium">
                            <Link href={`/packages/${pkg.id}`} className="hover:underline">{pkg.name}</Link>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getStatusIcon(pkg.lastBuildStatus || '')}
                              <span>{formatStatus(pkg.lastBuildStatus || '')}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {pkg.lastBuildTime ? new Date(pkg.lastBuildTime).toLocaleDateString() : '-'}
                          </TableCell>
                          <TableCell>
                            {pkg.lastVersion ? `${pkg.lastVersion}-r${pkg.lastAPKRelease}` : '-'}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Link href={`/packages/${pkg.id}`}>
                                <Button variant="ghost" size="sm">View</Button>
                              </Link>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleTriggerPackage(pkg)}
                              >
                                Retry
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  {failingPackagesData.totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <div className="text-sm text-muted-foreground">
                        Showing {((failingPackagesPage - 1) * FAILING_PACKAGES_PER_PAGE) + 1} to{' '}
                        {Math.min(failingPackagesPage * FAILING_PACKAGES_PER_PAGE, failingPackagesData.totalCount)} of{' '}
                        {failingPackagesData.totalCount} failing packages
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setFailingPackagesPage(prev => Math.max(1, prev - 1))}
                          disabled={failingPackagesPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setFailingPackagesPage(prev => Math.min(failingPackagesData.totalPages, prev + 1))}
                          disabled={failingPackagesPage === failingPackagesData.totalPages}
                        >
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
                  ) : (
                    <div className="text-center py-8">
                      <CheckCircle className="mx-auto h-12 w-12 text-green-500 mb-4" />
                      <h3 className="text-lg font-semibold mb-2">All packages are healthy!</h3>
                      <p className="text-muted-foreground">No packages are currently in a failed state.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="mt-8">
                <ExternalImageStatsCard />
              </div>

              {/* Modals */}
              {selectedPackage && (
                <>
                  <TriggerPackageModal
                    isOpen={triggerModalOpen}
                    onClose={() => setTriggerModalOpen(false)}
                    packageName={selectedPackage?.name}
                    onTrigger={handleExecuteTrigger}
                  />

                  {selectedTriggerType && (
                    <AutoTriggerModal
                      isOpen={autoTriggerModalOpen}
                      onClose={() => setAutoTriggerModalOpen(false)}
                      triggerType={selectedTriggerType}
                      packageName={selectedPackage?.name}
                    />
                  )}
                </>
              )}
            </>
          )}
    </div>
  )
}
