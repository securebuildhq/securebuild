"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

import { ExecutionsTable } from "@/components/executions-table"
import { useSession } from "@/app/hooks/use-session"
import { listExecutionsAction, SerializedExecution } from "@/lib/execution/actions/list-executions"
import { pauseExecutionsAction } from "@/lib/execution/actions/pause-executions"
import { resumeExecutionsAction } from "@/lib/execution/actions/resume-executions"
import { isExecutionPausedAction } from "@/lib/execution/actions/is-execution-paused"
import { executionsCountAction, ExecutionCounts } from "@/lib/execution/actions/executions-count"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Pause, Play, Loader2, AlertTriangle, Activity, CheckCircle, XCircle, Clock } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { getPageNumbers } from "@/lib/utils/pagination";

interface TableExecution {
  id: string; // Changed to string, this will be the actual database ID
  // dbId: string; // Removed, as id is now the string database ID
  packageId: string;
  packageName: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  version?: string;
  apkRelease?: number | null;
  cause?: string;
  causeId?: string;
  x86_64BuildStartedAt: string | null;
  x86_64BuildFinishedAt: string | null;
  aarch64BuildStartedAt: string | null;
  aarch64BuildFinishedAt: string | null;
}

type StatusFilter = "all" | "failed" | "success" | "queued" | "building" | "pending" | "publishing" | "timed_out" | "vm_deleted" | "waiting_for_vm";
type TimePeriod = "1hr" | "4h" | "1d";

const PAGE_SIZE = 50;

export default function ExecutionsPage() {
  const { session, isSessionLoading } = useSession();
  const router = useRouter();
  const user = session?.user;
  const [executions, setExecutions] = useState<TableExecution[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [isPaused, setIsPaused] = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)
  const [resumeLoading, setResumeLoading] = useState(false)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("1hr")
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
  const [countsLoading, setCountsLoading] = useState(true)
  const { toast } = useToast()

  // Filter executions based on selected status
  const filteredExecutions = executions.filter((execution) => {
    if (statusFilter === "all") return true;

    const status = execution.status.toLowerCase();

    // For backward compatibility, handle grouped filters
    if (statusFilter === "failed") {
      return status === "failed";
    }
    if (statusFilter === "success") {
      return status === "success";
    }
    if (statusFilter === "queued") {
      return status === "queued" || status === "pending";
    }
    if (statusFilter === "building") {
      return status === "building" || status === "testing" || status === "publishing";
    }

    // Handle individual status filters
    return status === statusFilter;
  });

  // Sort executions to show building/testing/publishing at the top
  const sortedExecutions = [...filteredExecutions].sort((a, b) => {
    const aIsBuilding = a.status.toLowerCase() === "building" || a.status.toLowerCase() === "testing" || a.status.toLowerCase() === "publishing";
    const bIsBuilding = b.status.toLowerCase() === "building" || b.status.toLowerCase() === "testing" || b.status.toLowerCase() === "publishing";

    // If one is building and the other isn't, building comes first
    if (aIsBuilding && !bIsBuilding) return -1;
    if (!aIsBuilding && bIsBuilding) return 1;

    // If both are building or both are not building, sort by creation date (newest first)
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Calculate pagination info
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const startItem = (currentPage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(currentPage * PAGE_SIZE, totalCount);

  useEffect(() => {
    if (session && user) {
      const fetchExecutions = async () => {
        setLoading(true);
        try {
          let filters = {};
          if (statusFilter !== "all") {
            // For grouped filters, we'll let the client-side filtering handle it
            // For individual status filters, pass them directly to the server
            if (["pending", "queued", "building", "testing", "publishing", "success", "failed", "timed_out", "vm_deleted"].includes(statusFilter)) {
              filters = { status: statusFilter };
            }
          }
          const pagination = { page: currentPage, limit: PAGE_SIZE };
          const result = await listExecutionsAction(filters, pagination);

          // Map exec.id (string from DB) directly to TableExecution.id
          const transformedResults: TableExecution[] = result.executions.map((exec) => ({
            id: exec.id, // Use the actual string ID from the database
            packageId: exec.packageId,
            packageName: exec.packageName,
            status: exec.status,
            createdAt: new Date(exec.createdAt).toISOString(),
            completedAt: null,
            version: exec.versionLabel,
            apkRelease: exec.apkRelease,
            cause: exec.cause,
            causeId: exec.causeId,
            x86_64BuildStartedAt: exec.x86_64BuildStartedAt,
            x86_64BuildFinishedAt: exec.x86_64BuildFinishedAt,
            aarch64BuildStartedAt: exec.aarch64BuildStartedAt,
            aarch64BuildFinishedAt: exec.aarch64BuildFinishedAt,
          }));
          setExecutions(transformedResults);
          setTotalCount(result.totalCount);
        } catch (error) {
          console.error("Failed to fetch executions:", error);
        } finally {
          setLoading(false);
        }
      };

      const fetchExecutionCounts = async () => {
        setCountsLoading(true);
        try {
          const counts = await executionsCountAction(timePeriod);
          setExecutionCounts(counts);
        } catch (error) {
          console.error("Failed to fetch execution counts:", error);
        } finally {
          setCountsLoading(false);
        }
      };

      fetchExecutions();
      fetchExecutionCounts();
    } else if (!isSessionLoading && !session) {
      setLoading(false);
      setCountsLoading(false);
    }
  }, [session, user, isSessionLoading, timePeriod, currentPage, statusFilter]);

  // Auto-refresh effect for executions and counts
  useEffect(() => {
    if (!session || !user) return;

    const fetchExecutions = async () => {
      try {
        let filters = {};
        if (statusFilter !== "all") {
          // For grouped filters, we'll let the client-side filtering handle it
          // For individual status filters, pass them directly to the server
          if (["pending", "queued", "building", "testing", "publishing", "success", "failed", "timed_out", "vm_deleted"].includes(statusFilter)) {
            filters = { status: statusFilter };
          }
        }
        const pagination = { page: currentPage, limit: PAGE_SIZE };
        const result = await listExecutionsAction(filters, pagination);
        const transformedResults: TableExecution[] = result.executions.map((exec) => ({
          id: exec.id,
          packageId: exec.packageId,
          packageName: exec.packageName,
          status: exec.status,
          createdAt: new Date(exec.createdAt).toISOString(),
          completedAt: null,
          version: exec.versionLabel,
          apkRelease: exec.apkRelease,
          cause: exec.cause,
          causeId: exec.causeId,
          x86_64BuildStartedAt: exec.x86_64BuildStartedAt,
          x86_64BuildFinishedAt: exec.x86_64BuildFinishedAt,
          aarch64BuildStartedAt: exec.aarch64BuildStartedAt,
          aarch64BuildFinishedAt: exec.aarch64BuildFinishedAt,
        }));
        setExecutions(transformedResults);
        setTotalCount(result.totalCount);
      } catch (error) {
        console.error('Auto-refresh failed:', error);
      }
    };

    const fetchExecutionCounts = async () => {
      try {
        const counts = await executionsCountAction(timePeriod);
        setExecutionCounts(counts);
      } catch (error) {
        console.error('Auto-refresh counts failed:', error);
      }
    };

    const checkPauseStatus = async () => {
      try {
        const paused = await isExecutionPausedAction();
        setIsPaused(paused);
      } catch (error) {
        console.error("Failed to check pause status:", error);
      }
    };

    const interval = setInterval(() => {
      fetchExecutions();
      fetchExecutionCounts();
      checkPauseStatus();
    }, 2000); // Refresh every 2 seconds

    return () => clearInterval(interval);
  }, [session, user, timePeriod, currentPage, statusFilter]);

  // Check pause status
  useEffect(() => {
    if (session && user) {
      const checkPauseStatus = async () => {
        try {
          const paused = await isExecutionPausedAction();
          setIsPaused(paused);
        } catch (error) {
          console.error("Failed to check pause status:", error);
        }
      };
      checkPauseStatus();
    }
  }, [session, user]);

  const handlePause = async () => {
    if (!session) return;

    setPauseLoading(true);
    try {
      await pauseExecutionsAction();
      setIsPaused(true);
      toast({
        title: "Executions Paused",
        description: "All new executions have been paused",
      });
    } catch (error) {
      console.error("Failed to pause executions:", error);
      toast({
        title: "Error",
        description: "Failed to pause executions",
        variant: "destructive",
      });
    } finally {
      setPauseLoading(false);
    }
  };

  const handleResume = async () => {
    if (!session) return;

    setResumeLoading(true);
    try {
      await resumeExecutionsAction();
      setIsPaused(false);
      toast({
        title: "Executions Resumed",
        description: "Executions have been resumed",
      });
    } catch (error) {
      console.error("Failed to resume executions:", error);
      toast({
        title: "Error",
        description: "Failed to resume executions",
        variant: "destructive",
      });
    } finally {
      setResumeLoading(false);
    }
  };

  const handleStatusFilterChange = (value: StatusFilter) => {
    if (value === "waiting_for_vm") {
      // Redirect to packages page since "waiting for VM" applies to packages, not executions
      router.push("/packages");
      return;
    }

    setStatusFilter(value);
    setCurrentPage(1); // Reset to first page when filter changes
  };

  // Session is handled by the layout
  if (!session || !user || isSessionLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading executions...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      {isPaused && (
        <div className="bg-red-600 text-white px-6 py-4 border-b border-red-700">
          <div className="flex items-center justify-center space-x-2">
            <AlertTriangle className="h-5 w-5" />
            <span className="text-lg font-semibold">
              ⚠️ EXECUTIONS ARE PAUSED - No new builds will start until resumed
            </span>
            <AlertTriangle className="h-5 w-5" />
          </div>
        </div>
      )}
      <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
                <div>Loading executions...</div>
              </div>
            </div>
          ) : (
            <>
          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
            <div>
              <h1 className="text-3xl font-bold">Executions</h1>
              <p className="text-muted-foreground">View all package build executions</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Label htmlFor="time-period">Time period:</Label>
                <Select value={timePeriod} onValueChange={(value: TimePeriod) => setTimePeriod(value)}>
                  <SelectTrigger id="time-period" className="w-[120px]">
                    <SelectValue placeholder="Select period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1hr">1 Hour</SelectItem>
                    <SelectItem value="4h">4 Hours</SelectItem>
                    <SelectItem value="1d">1 Day</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Metrics Cards */}
          <div className="grid gap-4 md:grid-cols-5 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                  <Activity className="h-4 w-4 mr-2" />
                  Running
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {countsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : executionCounts.running}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Currently executing</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Completed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {countsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : executionCounts.completed}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Total finished</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                  <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                  Success
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {countsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : executionCounts.success}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Successful builds</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                  <XCircle className="h-4 w-4 mr-2 text-red-600" />
                  Failed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600">
                  {countsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : executionCounts.failed}
                </div>
                <div className="text-xs text-muted-foreground mt-1 space-y-1">
                  <div>Total failed builds</div>
                  {!countsLoading && (
                    <div className="flex flex-col space-y-0.5 pt-1">
                      {executionCounts.failedBreakdown.failed > 0 && (
                        <div className="flex justify-between">
                          <span>Failed:</span>
                          <span className="font-medium">{executionCounts.failedBreakdown.failed}</span>
                        </div>
                      )}
                      {executionCounts.failedBreakdown.timedOut > 0 && (
                        <div className="flex justify-between">
                          <span>Timed Out:</span>
                          <span className="font-medium">{executionCounts.failedBreakdown.timedOut}</span>
                        </div>
                      )}
                      {executionCounts.failedBreakdown.stalled > 0 && (
                        <div className="flex justify-between">
                          <span>Stalled:</span>
                          <span className="font-medium">{executionCounts.failedBreakdown.stalled}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                  <Clock className="h-4 w-4 mr-2" />
                  Waiting for VMs
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {countsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : executionCounts.waitingForVMs}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Queued for resources</p>
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Label htmlFor="status-filter">Filter by status:</Label>
                <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                  <SelectTrigger id="status-filter" className="w-[180px]">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="queued">Queued</SelectItem>
                    <SelectItem value="building">Building</SelectItem>
                    <SelectItem value="testing">Testing</SelectItem>
                    <SelectItem value="publishing">Publishing</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="timed_out">Timed Out</SelectItem>
                    <SelectItem value="vm_deleted">VM Deleted</SelectItem>
                    <SelectItem value="waiting_for_vm">Waiting for VM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {isPaused ? (
                <Button
                  onClick={handleResume}
                  disabled={resumeLoading}
                  variant="default"
                  size="sm"
                >
                  {resumeLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Play className="h-4 w-4 mr-2" />
                  )}
                  Resume Executions
                </Button>
              ) : (
                <Button
                  onClick={handlePause}
                  disabled={pauseLoading}
                  variant="outline"
                  size="sm"
                >
                  {pauseLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Pause className="h-4 w-4 mr-2" />
                  )}
                  Pause Executions
                </Button>
              )}
            </div>
          </div>

          {/* Results info */}
          {!loading && (
            <div className="mb-4 text-sm text-muted-foreground">
              Showing {totalCount > 0 ? startItem : 0}-{endItem} of {totalCount} executions
            </div>
          )}

          <ExecutionsTable executions={sortedExecutions} />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (currentPage > 1) setCurrentPage(currentPage - 1);
                      }}
                      className={currentPage <= 1 ? "pointer-events-none opacity-50" : ""}
                    />
                  </PaginationItem>

                  {getPageNumbers(currentPage, totalPages).map((page, index) => (
                    <PaginationItem key={index}>
                      {page === 'ellipsis' ? (
                        <PaginationEllipsis />
                      ) : (
                        <PaginationLink
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setCurrentPage(page as number);
                          }}
                          isActive={currentPage === page}
                        >
                          {page}
                        </PaginationLink>
                      )}
                    </PaginationItem>
                  ))}

                  <PaginationItem>
                    <PaginationNext
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (currentPage < totalPages) setCurrentPage(currentPage + 1);
                      }}
                      className={currentPage >= totalPages ? "pointer-events-none opacity-50" : ""}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
            </>
          )}
      </div>
    </>
  )
}
