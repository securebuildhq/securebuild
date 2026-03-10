"use client"
import { useState } from "react"
import React from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { Clock, FlaskConical, UploadCloud, CheckCircle, XCircle, AlertCircle, Loader2, X, Eye, RotateCcw } from "lucide-react"
import { cancelExecutionAction } from "@/lib/package/actions/cancel-execution"
import { retryExecutionAction } from "@/lib/execution/actions/retry-execution"
import { useSession } from "@/app/hooks/use-session"
import { useToast } from "@/hooks/use-toast"

interface Execution {
  id: string
  packageId: string
  packageName: string
  status: string
  createdAt: string
  completedAt: string | null
  version?: string
  apkRelease?: number | null
  cause?: string
  causeId?: string
  x86_64BuildStartedAt: string | null
  x86_64BuildFinishedAt: string | null
  aarch64BuildStartedAt: string | null
  aarch64BuildFinishedAt: string | null
}

interface ExecutionsTableProps {
  executions: Execution[]
  showRetryButton?: boolean
}

type ExecutionStatus = "pending" | "queued" | "building" | "testing" | "publishing" | "success" | "failed" | "vm_deleted";

interface StatusConfig {
  variant: "default" | "destructive" | "success" | "secondary" | "outline" | "warning";
  icon: React.ElementType;
  label: string;
}

const statusConfig: Record<ExecutionStatus, StatusConfig> = {
  pending: { variant: "secondary", icon: Clock, label: "Pending" },
  queued: { variant: "secondary", icon: Clock, label: "Queued" },
  building: { variant: "default", icon: Loader2, label: "Building" },
  testing: { variant: "warning", icon: FlaskConical, label: "Testing" },
  publishing: { variant: "default", icon: UploadCloud, label: "Publishing" },
  success: { variant: "success", icon: CheckCircle, label: "Success" },
  failed: { variant: "destructive", icon: XCircle, label: "Failed" },
  vm_deleted: { variant: "destructive", icon: XCircle, label: "VM Deleted" },
};

const defaultStatusConfig: StatusConfig = {
  variant: "outline",
  icon: AlertCircle,
  label: "Unknown",
};

export function ExecutionsTable({ executions, showRetryButton = true }: ExecutionsTableProps) {
  const { session } = useSession();
  const { toast } = useToast();
  const [cancellingIds, setCancellingIds] = useState<Set<string>>(new Set());
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  const handleCancel = async (executionId: string) => {
    if (!session) {
      toast({
        title: "Error",
        description: "You must be logged in to cancel executions",
        variant: "destructive",
      });
      return;
    }

    setCancellingIds(prev => new Set(prev).add(executionId));

    try {
      await cancelExecutionAction(session, executionId);
      toast({
        title: "Execution cancelled",
        description: "The execution has been cancelled successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to cancel execution",
        variant: "destructive",
      });
    } finally {
      setCancellingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(executionId);
        return newSet;
      });
    }
  };

  const handleRetry = async (executionId: string) => {
    if (!session) {
      toast({
        title: "Error",
        description: "You must be logged in to retry executions",
        variant: "destructive",
      });
      return;
    }

    setRetryingIds(prev => new Set(prev).add(executionId));

    try {
      const success = await retryExecutionAction(session, executionId);
      if (success) {
        toast({
          title: "Execution retried",
          description: "The execution has been queued for retry",
        });
      } else {
        toast({
          title: "Error",
          description: "Cannot retry execution in current state",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to retry execution",
        variant: "destructive",
      });
    } finally {
      setRetryingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(executionId);
        return newSet;
      });
    }
  };

  // Helper function to check if an execution is building
  const isBuilding = (execution: Execution) => {
    const status = execution.status.toLowerCase();
    return status === "building" || status === "testing" || status === "publishing";
  };

  // Helper function to check if an execution is in a failed state
  const isFailed = (execution: Execution) => {
    const status = execution.status.toLowerCase();
    return status === "failed" || status === "vm_deleted" || status === "stalled";
  };

  // Find the index where building executions end
  const buildingEndIndex = executions.findIndex((execution, index) => {
    if (index === 0) return false;
    return !isBuilding(execution) && isBuilding(executions[index - 1]);
  });

  const shouldShowSeparator = buildingEndIndex > 0;

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Package</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Triggered By</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {executions.map((execution, index) => {
            const startDate = new Date(execution.createdAt)

            // Determine the end time based on status and finish times
            let endDate: Date;
            let durationFormatted: string;

            if (execution.status === 'success' || execution.status === 'failed' || execution.status === 'stalled') {
              // For completed executions, use the latest finish time
              const finishTimes = [
                execution.x86_64BuildFinishedAt ? new Date(execution.x86_64BuildFinishedAt) : null,
                execution.aarch64BuildFinishedAt ? new Date(execution.aarch64BuildFinishedAt) : null,
              ].filter(Boolean) as Date[];

              if (finishTimes.length > 0) {
                // Use the latest finish time
                endDate = finishTimes.reduce((latest, current) =>
                  current > latest ? current : latest
                );
                const durationMs = endDate.getTime() - startDate.getTime()
                const durationMinutes = Math.floor(durationMs / 60000)
                const durationSeconds = Math.floor((durationMs % 60000) / 1000)
                durationFormatted = `${durationMinutes}m ${durationSeconds}s`
              } else {
                // No finish times available, show as unknown
                durationFormatted = "-"
              }
            } else if (execution.status === 'building' || execution.status === 'testing' || execution.status === 'publishing') {
              // For ongoing executions, calculate from start to now
              endDate = new Date()
              const durationMs = endDate.getTime() - startDate.getTime()
              const durationMinutes = Math.floor(durationMs / 60000)
              const durationSeconds = Math.floor((durationMs % 60000) / 1000)
              durationFormatted = `${durationMinutes}m ${durationSeconds}s (ongoing)`
            } else {
              // For pending or other statuses
              durationFormatted = "-"
            }

            const currentStatus = execution.status.toLowerCase() as ExecutionStatus;
            const { variant, icon: Icon, label } = statusConfig[currentStatus] || defaultStatusConfig;

            return (
              <React.Fragment key={execution.id}>
                {/* Show separator before the first non-building execution */}
                {shouldShowSeparator && index === buildingEndIndex && (
                  <TableRow key={`separator-${index}`} className="border-t-2 border-muted">
                    <TableCell colSpan={7} className="py-3 text-center text-sm text-muted-foreground bg-muted/30">
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-px bg-border flex-1" />
                        <span className="px-3 font-medium">Previous Executions</span>
                        <div className="h-px bg-border flex-1" />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell className="font-medium">
                    <Link href={`/packages/${execution.packageId}`}>
                      {execution.packageName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant={variant} className="whitespace-nowrap">
                        <Icon className={`mr-1 h-4 w-4 ${Icon === Loader2 ? "animate-spin" : ""}`} />
                        {label}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>{new Date(execution.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{durationFormatted}</TableCell>
                  <TableCell>
                    {execution.version
                      ? `${execution.version}${execution.apkRelease != null ? `-r${execution.apkRelease}` : ''}`
                      : "-"}
                  </TableCell>
                  <TableCell>{execution.cause || "manual"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {(execution.status === 'building' || execution.status === 'testing' || execution.status === 'publishing') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancel(execution.id)}
                          disabled={cancellingIds.has(execution.id)}
                        >
                          {cancellingIds.has(execution.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <X className="h-4 w-4" />
                          )}
                          <span className="ml-1">Cancel</span>
                        </Button>
                      )}
                      {showRetryButton && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Retry"
                          onClick={() => handleRetry(execution.id)}
                          disabled={retryingIds.has(execution.id)}
                        >
                          {retryingIds.has(execution.id) ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                      <Link href={`/executions/${execution.id}`}>
                        <Button variant="ghost" size="sm" title="View Details">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
