"use client";
import React, { useState, useEffect, useMemo } from "react";
import { Trash, ChevronUp, ChevronDown, ChevronsUpDown, History, Activity, Bug } from "lucide-react";
import { useSession } from "@/app/hooks/use-session";
import { listBuildersAction } from "@/lib/builder/actions/list-builders";
import { listBuilderHistoryAction, BuilderHistory } from "@/lib/builder/actions/list-builder-history";
import "@xterm/xterm/css/xterm.css";
import { deleteBuilderAction } from "@/lib/builder/actions/delete-builder";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAtom } from "jotai";
import { buildersAtom, Builder } from "@/app/state/builders-atom";
import Link from "next/link";
import { getVMTTLAction } from "@/lib/config/actions/get-vm-ttl";
import { updateVMTTLAction } from "@/lib/config/actions/update-vm-ttl";
import { useToast } from "@/hooks/use-toast";

function isDate(val: unknown): val is Date {
  return Object.prototype.toString.call(val) === '[object Date]';
}

const formatDateTime = (dateTime: Date | string): string => {
  try {
    let date: Date;

    if (dateTime instanceof Date) {
      // The database stores UTC, but JS parsed it as local time
      // We need to adjust by the timezone offset
      const localDate = dateTime;
      const timezoneOffsetMs = localDate.getTimezoneOffset() * 60 * 1000;
      date = new Date(localDate.getTime() - timezoneOffsetMs);
    } else {
      // If it's a string from database, assume it's UTC
      const timeString = String(dateTime);
      if (!timeString.includes('Z') && !timeString.includes('+') && !timeString.includes('-', 10)) {
        date = new Date(timeString + 'Z'); // Add Z to treat as UTC
      } else {
        date = new Date(timeString);
      }
    }

    // Verify the date is valid
    if (isNaN(date.getTime())) {
      return "Invalid date";
    }

    // Format in local timezone with 24-hour format
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short'
    });
  } catch (error) {
    console.error('Error parsing date:', error, dateTime);
    return "Invalid date";
  }
};

type SortField = 'id' | 'architecture' | 'ipAddress' | 'createdAt' | 'expiresAt' | 'status' | 'assignedTask' | 'deletedAt' | 'terminationReason';
type SortDirection = 'asc' | 'desc';
type ViewMode = 'active' | 'history';

// Helper function to render task with clickable ID
const renderTaskLink = (assignedTask: string) => {
  if (!assignedTask) return null;

  // Parse the task format: "Build Package: taskId", "Build Image: taskId", etc.
  const match = assignedTask.match(/^(Build Package|Build Image|Publish Package): (.+)$/);
  if (!match) {
    return (
      <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-48" title={assignedTask}>
        {assignedTask}
      </div>
    );
  }

  const [, taskType, taskId] = match;
  let linkPath: string;

  switch (taskType) {
    case "Build Package":
    case "Publish Package":
      linkPath = `/executions/${taskId}`;
      break;
    case "Build Image":
      linkPath = `/builds/${taskId}`;
      break;
    default:
      // Fallback for unknown task types
      return (
        <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-48" title={assignedTask}>
          {assignedTask}
        </div>
      );
  }

  return (
    <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-48" title={assignedTask}>
      {taskType}: <Link href={linkPath} className="text-blue-600 hover:text-blue-800 underline">{taskId}</Link>
    </div>
  );
};

export default function BuildersPage() {
  const { session, isSessionLoading } = useSession();
  const { toast } = useToast();
  const [builders, setBuilders] = useAtom(buildersAtom);
  const [onDemandBuilders, setOnDemandBuilders] = useState<Builder[]>([]);
  const [builderHistory, setBuilderHistory] = useState<BuilderHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('active');
  const [terminalBuilder, setTerminalBuilder] = useState<Builder | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Builder | null>(null);
  const [debugBuilder, setDebugBuilder] = useState<BuilderHistory | null>(null);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // VM TTL configuration state
  const [vmTTL, setVmTTL] = useState<string>("24h");
  const [isSavingVMTTL, setIsSavingVMTTL] = useState(false);

  const fetchActiveBuilders = async () => {
    if (!session) return;
    try {
      // Fetch pool builders (is_on_demand = false)
      const poolData = await listBuildersAction(false);
      setBuilders(
        poolData.map((b: any) => ({
          id: b.id,
          ipAddress: b.ipAddress,
          createdAt: b.createdAt || b.created_at || "-",
          expiresAt: b.expiresAt,
          status: b.status,
          assignedTask: b.assignedTask,
          assignedTasks: b.assignedTasks,
          architecture: b.architecture,
          lastUptime: b.lastUptime,
          lastUptimeUpdatedAt: b.lastUptimeUpdatedAt,
          executionStatus: b.executionStatus,
        }))
      );

      // Fetch on-demand builders (is_on_demand = true)
      const onDemandData = await listBuildersAction(true);
      setOnDemandBuilders(
        onDemandData.map((b: any) => ({
          id: b.id,
          ipAddress: b.ipAddress,
          createdAt: b.createdAt || b.created_at || "-",
          expiresAt: b.expiresAt,
          status: b.status,
          assignedTask: b.assignedTask,
          assignedTasks: b.assignedTasks,
          architecture: b.architecture,
          lastUptime: b.lastUptime,
          lastUptimeUpdatedAt: b.lastUptimeUpdatedAt,
          executionStatus: b.executionStatus,
        }))
      );
    } catch (e) {
      setBuilders([]);
      setOnDemandBuilders([]);
    }
  };

  const fetchBuilderHistory = async () => {
    if (!session) return;
    try {
      const data = await listBuilderHistoryAction();
      setBuilderHistory(data);
    } catch (e) {
      setBuilderHistory([]);
    }
  };

  useEffect(() => {
    if (!session) return;
    setLoading(true);

    const fetchData = async () => {
      if (viewMode === 'active') {
        await fetchActiveBuilders();
      } else {
        await fetchBuilderHistory();
      }
      setLoading(false);
    };

    fetchData();
  }, [session, viewMode]);

  // Auto-refresh effect for active builders
  useEffect(() => {
    if (!session || viewMode !== 'active') return;

    const interval = setInterval(async () => {
      // Refresh data without showing loading state
      try {
        await fetchActiveBuilders();
      } catch (error) {
        console.error('Auto-refresh failed:', error);
      }
    }, 2000); // Refresh every 2 seconds

    return () => clearInterval(interval);
  }, [session, viewMode]);

  // Fetch VM TTL configuration on mount
  useEffect(() => {
    if (!session) return;

    const fetchVMTTL = async () => {
      try {
        const result = await getVMTTLAction();
        setVmTTL(result.vmTTLDuration);
      } catch (error) {
        console.error('Failed to fetch VM TTL:', error);
      }
    };

    fetchVMTTL();
  }, [session]);

  const handleSaveVMTTL = async () => {
    if (!session) return;

    // Validate duration format using parse-duration
    const parse = (await import('parse-duration')).default;
    try {
      const d = parse(vmTTL);
      if (!d || d <= 0) {
        throw new Error("Invalid duration");
      }
    } catch {
      toast({
        title: "Invalid input",
        description: "VM TTL must be in Go duration format (e.g., '24h', '2h30m', '45m')",
        variant: "destructive",
      });
      return;
    }

    setIsSavingVMTTL(true);
    try {
      await updateVMTTLAction(vmTTL);
      toast({
        title: "Success",
        description: `VM TTL updated to ${vmTTL}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update VM TTL",
        variant: "destructive",
      });
    } finally {
      setIsSavingVMTTL(false);
    }
  };

  async function handleDelete(builder: Builder) {
    setConfirmDelete(builder);
  }

  async function confirmDeleteBuilder() {
    if (!session || !confirmDelete) return;
    setDeletingId(confirmDelete.id);
    try {
      await deleteBuilderAction(confirmDelete.id);
      setBuilders((prev) => prev.filter((b) => b.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (e) {
      alert("Failed to delete builder.");
    } finally {
      setDeletingId(null);
    }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedBuilders = useMemo(() => {
    if (!sortField) return builders;

    return [...builders].sort((a, b) => {
      let aVal: any = a[sortField as keyof Builder];
      let bVal: any = b[sortField as keyof Builder];

      // Handle undefined/null values
      if (aVal === undefined || aVal === null) aVal = '';
      if (bVal === undefined || bVal === null) bVal = '';

      // Convert dates to timestamps for comparison
      if (sortField === 'createdAt' || sortField === 'expiresAt') {
        aVal = aVal ? (typeof aVal === 'string' ? new Date(aVal).getTime() : aVal) : 0;
        bVal = bVal ? (typeof bVal === 'string' ? new Date(bVal).getTime() : bVal) : 0;
      }

      // Compare values
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [builders, sortField, sortDirection]);

  const sortedOnDemandBuilders = useMemo(() => {
    if (!sortField) return onDemandBuilders;

    return [...onDemandBuilders].sort((a, b) => {
      let aVal: any = a[sortField as keyof Builder];
      let bVal: any = b[sortField as keyof Builder];

      // Handle undefined/null values
      if (aVal === undefined || aVal === null) aVal = '';
      if (bVal === undefined || bVal === null) bVal = '';

      // Convert dates to timestamps for comparison
      if (sortField === 'createdAt' || sortField === 'expiresAt') {
        aVal = aVal ? (typeof aVal === 'string' ? new Date(aVal).getTime() : aVal) : 0;
        bVal = bVal ? (typeof bVal === 'string' ? new Date(bVal).getTime() : bVal) : 0;
      }

      // Compare values
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [onDemandBuilders, sortField, sortDirection]);

  const sortedBuilderHistory = useMemo(() => {
    if (!sortField) return builderHistory;

    return [...builderHistory].sort((a, b) => {
      let aVal: any = a[sortField as keyof BuilderHistory];
      let bVal: any = b[sortField as keyof BuilderHistory];

      // Handle undefined/null values
      if (aVal === undefined || aVal === null) aVal = '';
      if (bVal === undefined || bVal === null) bVal = '';

      // Convert dates to timestamps for comparison
      if (sortField === 'createdAt' || sortField === 'expiresAt' || sortField === 'deletedAt') {
        aVal = aVal ? (typeof aVal === 'string' ? new Date(aVal).getTime() : aVal) : 0;
        bVal = bVal ? (typeof bVal === 'string' ? new Date(bVal).getTime() : bVal) : 0;
      }

      // Compare values
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [builderHistory, sortField, sortDirection]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ChevronsUpDown className="h-4 w-4 text-gray-400" />;
    }
    return sortDirection === 'asc' ?
      <ChevronUp className="h-4 w-4" /> :
      <ChevronDown className="h-4 w-4" />;
  };

  const getTerminationReasonColor = (reason: string) => {
    switch (reason) {
      case 'task_completed':
        return 'bg-green-100 text-green-800';
      case 'excess':
        return 'bg-blue-100 text-blue-800';
      case 'expired':
        return 'bg-yellow-100 text-yellow-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      case 'build_env_failed':
        return 'bg-orange-100 text-orange-800';
      case 'task_failed':
        return 'bg-red-100 text-red-800';
      case 'manual_deletion':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (isSessionLoading || loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Builders</h1>
        <div className="flex gap-2">
          <Button
            variant={viewMode === 'active' ? 'default' : 'outline'}
            onClick={() => setViewMode('active')}
            className="flex items-center gap-2"
          >
            <Activity className="h-4 w-4" />
            Active Builders
          </Button>
          <Button
            variant={viewMode === 'history' ? 'default' : 'outline'}
            onClick={() => setViewMode('history')}
            className="flex items-center gap-2"
          >
            <History className="h-4 w-4" />
            History (6h)
          </Button>
        </div>
      </div>

      {viewMode === 'active' && (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>VM Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="vm-ttl">VM TTL (duration)</Label>
                  <Input
                    id="vm-ttl"
                    type="text"
                    value={vmTTL}
                    onChange={(e) => setVmTTL(e.target.value)}
                    placeholder="24h"
                    className="max-w-xs"
                  />
                  <p className="text-sm text-muted-foreground mt-1">
                    VM TTL (Time-To-Live) controls how long VMs remain active when assigned to a build. Pool VMs start with a 4-hour TTL and are extended to this value when assigned. On-demand VMs use this value from creation. Use Go duration format (e.g., "24h", "2h30m", "45m"). Default: 24h.
                  </p>
                </div>
                <Button onClick={handleSaveVMTTL} disabled={isSavingVMTTL}>
                  {isSavingVMTTL ? "Saving..." : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <h2 className="text-xl font-bold mb-4">Pool Builders</h2>
        </>
      )}

      <table className="min-w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-slate-100 dark:bg-slate-800">
            <th
              className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              onClick={() => handleSort('id')}
            >
              <div className="flex items-center gap-1">
                ID
                <SortIcon field="id" />
              </div>
            </th>
            <th
              className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              onClick={() => handleSort('architecture')}
            >
              <div className="flex items-center gap-1">
                Architecture
                <SortIcon field="architecture" />
              </div>
            </th>
            <th
              className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              onClick={() => handleSort('ipAddress')}
            >
              <div className="flex items-center gap-1">
                IP Address
                <SortIcon field="ipAddress" />
              </div>
            </th>
            <th
              className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              onClick={() => handleSort('createdAt')}
            >
              <div className="flex items-center gap-1">
                Created At
                <SortIcon field="createdAt" />
              </div>
            </th>
            {viewMode === 'history' ? (
              <th
                className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                onClick={() => handleSort('deletedAt')}
              >
                <div className="flex items-center gap-1">
                  Deleted At
                  <SortIcon field="deletedAt" />
                </div>
              </th>
            ) : (
              <th
                className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                onClick={() => handleSort('expiresAt')}
              >
                <div className="flex items-center gap-1">
                  Expires At
                  <SortIcon field="expiresAt" />
                </div>
              </th>
            )}
            <th
              className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              onClick={() => handleSort('status')}
            >
              <div className="flex items-center gap-1">
                Status
                <SortIcon field="status" />
              </div>
            </th>
            {viewMode === 'active' && (
              <th className="px-4 py-2 text-left">
                CPU Usage
              </th>
            )}
            {viewMode === 'history' && (
              <th
                className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                onClick={() => handleSort('terminationReason')}
              >
                <div className="flex items-center gap-1">
                  Termination Reason
                  <SortIcon field="terminationReason" />
                </div>
              </th>
            )}
            {viewMode === 'history' && <th className="px-4 py-2 text-left">Debug</th>}
            {viewMode === 'active' && <th className="px-4 py-2 text-left">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {viewMode === 'active' ? (
            sortedBuilders.map((builder) => (
              <tr key={builder.id} className="border-t border-slate-200 dark:border-slate-700">
                <td className="px-4 py-2 font-mono">{builder.id}</td>
                <td className="px-4 py-2">
                  {builder.architecture ? (
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      builder.architecture === "x86_64"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-purple-100 text-purple-800"
                    }`}>
                      {builder.architecture}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono">{builder.ipAddress}</td>
                <td className="px-4 py-2">{builder.createdAt ? formatDateTime(builder.createdAt) : '-'}</td>
                <td className="px-4 py-2">{builder.expiresAt ? formatDateTime(builder.expiresAt) : '-'}</td>
                <td className="px-4 py-2">
                  {(() => {
                    const hasAssignments = (builder.assignedTasks?.length ?? 0) > 0 || !!builder.assignedTask;
                    // If execution status is "provisioning", show the VM status instead of "assigned"
                    let displayStatus;
                    if (hasAssignments && builder.executionStatus === "provisioning") {
                      displayStatus = builder.status; // Show VM status (provisioned, installing, etc.)
                    } else if (hasAssignments) {
                      displayStatus = "assigned";
                    } else {
                      displayStatus = builder.status;
                    }

                    // Determine the color based on status
                    let statusColor;
                    switch (displayStatus) {
                      case "running":
                        statusColor = "bg-green-100 text-green-800";
                        break;
                      case "assigned":
                        statusColor = "bg-blue-100 text-blue-800";
                        break;
                      case "installing":
                        statusColor = "bg-yellow-100 text-yellow-800";
                        break;
                      case "provisioned":
                        statusColor = "bg-purple-100 text-purple-800";
                        break;
                      default:
                        statusColor = "bg-red-100 text-red-800";
                        break;
                    }

                    const tasks = builder.assignedTasks?.length ? builder.assignedTasks : (builder.assignedTask ? [builder.assignedTask] : []);
                    return (
                      <div className="flex flex-col gap-1">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${statusColor}`}>
                          {displayStatus}
                        </span>
                        {tasks.map((task, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <br />}
                            {renderTaskLink(task)}
                          </React.Fragment>
                        ))}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-4 py-2">
                  {builder.lastUptime ? (
                    <div className="text-xs space-y-1">
                      <div className="font-mono text-sm bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-2 py-1 rounded border border-green-200 dark:border-green-800">
                        {(() => {
                          // Parse uptime to extract load averages
                          const uptimeMatch = builder.lastUptime.match(/load average[s]?:\s*([\d.]+),?\s*([\d.]+),?\s*([\d.]+)/i);
                          if (uptimeMatch) {
                            const [, load1, load5, load15] = uptimeMatch;
                            return (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-green-600 dark:text-green-400 font-medium">Load:</span>
                                <div className="flex gap-1">
                                  <span className="bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono border">
                                    {parseFloat(load1).toFixed(2)}
                                  </span>
                                  <span className="bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono border">
                                    {parseFloat(load5).toFixed(2)}
                                  </span>
                                  <span className="bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono border">
                                    {parseFloat(load15).toFixed(2)}
                                  </span>
                                </div>
                              </div>
                            );
                          }

                          // Fallback: show raw uptime if we can't parse load
                          return (
                            <div className="truncate max-w-48" title={builder.lastUptime}>
                              {builder.lastUptime}
                            </div>
                          );
                        })()}
                      </div>
                      {builder.lastUptimeUpdatedAt && (
                        <div className="text-gray-500 dark:text-gray-400 text-xs flex items-center gap-1">
                          <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                          <span>
                            {(() => {
                              if (!builder.lastUptimeUpdatedAt) return 'unknown';

                              try {
                                // Parse the date string and apply timezone conversion
                                const dateStr = String(builder.lastUptimeUpdatedAt);
                                let updateTime: Date;

                                // If it doesn't have timezone info, treat as UTC
                                if (!dateStr.includes('Z') && !dateStr.includes('+') && !dateStr.includes('-', 10)) {
                                  updateTime = new Date(dateStr + 'Z');
                                } else {
                                  updateTime = new Date(dateStr);
                                }

                                // If it's a Date object, apply timezone offset correction
                                if (builder.lastUptimeUpdatedAt && typeof builder.lastUptimeUpdatedAt === 'object') {
                                  const tempDate = new Date(dateStr);
                                  if (!isNaN(tempDate.getTime())) {
                                    const timezoneOffsetMs = tempDate.getTimezoneOffset() * 60 * 1000;
                                    updateTime = new Date(tempDate.getTime() - timezoneOffsetMs);
                                  }
                                }

                                const now = new Date();
                                const diffMs = now.getTime() - updateTime.getTime();
                                const diffSec = Math.floor(diffMs / 1000);

                                if (diffSec < 0) return 'just now';
                                if (diffSec < 60) return `${diffSec}s ago`;
                                if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
                                return `${Math.floor(diffSec / 3600)}h ago`;
                              } catch (error) {
                                return 'unknown';
                              }
                            })()}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs">
                      <div className="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-1 rounded border border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-1">
                          <div className="w-1.5 h-1.5 bg-gray-400 rounded-full"></div>
                          <span>No data</span>
                        </div>
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 flex gap-2">
                  <button
                    className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition flex items-center justify-center disabled:opacity-50"
                    onClick={() => handleDelete(builder)}
                    title="Delete Builder"
                    disabled={!!deletingId}
                  >
                    <Trash className="h-4 w-4" />
                    {deletingId === builder.id && (
                      <span className="ml-2 animate-spin">⏳</span>
                    )}
                  </button>
                </td>
              </tr>
            ))
          ) : (
            sortedBuilderHistory.map((builder) => (
              <tr key={`${builder.id}-${builder.deletedAt}`} className="border-t border-slate-200 dark:border-slate-700">
                <td className="px-4 py-2 font-mono">{builder.id}</td>
                <td className="px-4 py-2">
                  {builder.architecture ? (
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                      builder.architecture === "x86_64"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-purple-100 text-purple-800"
                    }`}>
                      {builder.architecture}
                    </span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-4 py-2 font-mono">{builder.ipAddress || '-'}</td>
                <td className="px-4 py-2">{formatDateTime(builder.createdAt)}</td>
                <td className="px-4 py-2">{formatDateTime(builder.deletedAt)}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${
                    builder.status === "running"
                      ? "bg-green-100 text-green-800"
                      : builder.status === "installing"
                      ? "bg-yellow-100 text-yellow-800"
                      : "bg-red-100 text-red-800"
                  }`}>
                    {builder.status}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {builder.assignedTask ? renderTaskLink(builder.assignedTask) : '-'}
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${getTerminationReasonColor(builder.terminationReason)}`}>
                    {builder.terminationReason.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {((builder as any).lastCommand || (builder as any).lastStderr || (builder as any).failureDetails) && (
                    <button
                      className="px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-700 transition flex items-center justify-center"
                      onClick={() => setDebugBuilder(builder)}
                      title="View Debug Info"
                    >
                      <Bug className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {viewMode === 'active' && sortedBuilders.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No pool builders found.
        </div>
      )}

      {viewMode === 'history' && sortedBuilderHistory.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No builder history found for the past 6 hours.
        </div>
      )}

      {viewMode === 'active' && (
        <>
          <h2 className="text-xl font-bold mb-4 mt-12">On-demand Builders</h2>

          <table className="min-w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-800">
                <th
                  className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => handleSort('id')}
                >
                  <div className="flex items-center gap-1">
                    ID
                    <SortIcon field="id" />
                  </div>
                </th>
                <th
                  className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => handleSort('architecture')}
                >
                  <div className="flex items-center gap-1">
                    Architecture
                    <SortIcon field="architecture" />
                  </div>
                </th>
                <th
                  className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => handleSort('ipAddress')}
                >
                  <div className="flex items-center gap-1">
                    IP Address
                    <SortIcon field="ipAddress" />
                  </div>
                </th>
                <th
                  className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => handleSort('createdAt')}
                >
                  <div className="flex items-center gap-1">
                    Created At
                    <SortIcon field="createdAt" />
                  </div>
                </th>
                <th
                  className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => handleSort('expiresAt')}
                >
                  <div className="flex items-center gap-1">
                    Expires At
                    <SortIcon field="expiresAt" />
                  </div>
                </th>
                <th
                  className="px-4 py-2 text-left cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  onClick={() => handleSort('status')}
                >
                  <div className="flex items-center gap-1">
                    Status
                    <SortIcon field="status" />
                  </div>
                </th>
                <th className="px-4 py-2 text-left">
                  CPU Usage
                </th>
                <th className="px-4 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedOnDemandBuilders.map((builder) => (
                <tr key={builder.id} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="px-4 py-2 font-mono">{builder.id}</td>
                  <td className="px-4 py-2">
                    {builder.architecture ? (
                      <span className={`px-2 py-1 rounded text-xs font-semibold ${
                        builder.architecture === "x86_64"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-purple-100 text-purple-800"
                      }`}>
                        {builder.architecture}
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 font-mono">{builder.ipAddress}</td>
                  <td className="px-4 py-2">{builder.createdAt ? formatDateTime(builder.createdAt) : '-'}</td>
                  <td className="px-4 py-2">{builder.expiresAt ? formatDateTime(builder.expiresAt) : '-'}</td>
                  <td className="px-4 py-2">
                    {(() => {
                      const hasAssignments = (builder.assignedTasks?.length ?? 0) > 0 || !!builder.assignedTask;
                      let displayStatus;
                      if (hasAssignments && builder.executionStatus === "provisioning") {
                        displayStatus = builder.status;
                      } else if (hasAssignments) {
                        displayStatus = "assigned";
                      } else {
                        displayStatus = builder.status;
                      }

                      let statusColor;
                      switch (displayStatus) {
                        case "running":
                          statusColor = "bg-green-100 text-green-800";
                          break;
                        case "assigned":
                          statusColor = "bg-blue-100 text-blue-800";
                          break;
                        case "installing":
                          statusColor = "bg-yellow-100 text-yellow-800";
                          break;
                        case "provisioned":
                          statusColor = "bg-purple-100 text-purple-800";
                          break;
                        default:
                          statusColor = "bg-red-100 text-red-800";
                          break;
                      }

                      const tasks = builder.assignedTasks?.length ? builder.assignedTasks : (builder.assignedTask ? [builder.assignedTask] : []);
                      return (
                        <div className="flex flex-col gap-1">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${statusColor}`}>
                            {displayStatus}
                          </span>
                          {tasks.map((task, i) => (
                            <React.Fragment key={i}>
                              {i > 0 && <br />}
                              {renderTaskLink(task)}
                            </React.Fragment>
                          ))}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2">
                    {builder.lastUptime ? (
                      <div className="text-xs space-y-1">
                        <div className="font-mono text-sm bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 px-2 py-1 rounded border border-green-200 dark:border-green-800">
                          {(() => {
                            // Parse uptime to extract load averages
                            const uptimeMatch = builder.lastUptime.match(/load average[s]?:\s*([\d.]+),?\s*([\d.]+),?\s*([\d.]+)/i);
                            if (uptimeMatch) {
                              const [, load1, load5, load15] = uptimeMatch;
                              return (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-green-600 dark:text-green-400 font-medium">Load:</span>
                                  <div className="flex gap-1">
                                    <span className="bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono border">
                                      {parseFloat(load1).toFixed(2)}
                                    </span>
                                    <span className="bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono border">
                                      {parseFloat(load5).toFixed(2)}
                                    </span>
                                    <span className="bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono border">
                                      {parseFloat(load15).toFixed(2)}
                                    </span>
                                  </div>
                                </div>
                              );
                            }

                            // Fallback: show raw uptime if we can't parse load
                            return (
                              <div className="truncate max-w-48" title={builder.lastUptime}>
                                {builder.lastUptime}
                              </div>
                            );
                          })()}
                        </div>
                        {builder.lastUptimeUpdatedAt && (
                          <div className="text-gray-500 dark:text-gray-400 text-xs flex items-center gap-1">
                            <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                            <span>
                              {(() => {
                                if (!builder.lastUptimeUpdatedAt) return 'unknown';

                                try {
                                  // Parse the date string and apply timezone conversion
                                  const dateStr = String(builder.lastUptimeUpdatedAt);
                                  let updateTime: Date;

                                  // If it doesn't have timezone info, treat as UTC
                                  if (!dateStr.includes('Z') && !dateStr.includes('+') && !dateStr.includes('-', 10)) {
                                    updateTime = new Date(dateStr + 'Z');
                                  } else {
                                    updateTime = new Date(dateStr);
                                  }

                                  // If it's a Date object, apply timezone offset correction
                                  if (builder.lastUptimeUpdatedAt && typeof builder.lastUptimeUpdatedAt === 'object') {
                                    const tempDate = new Date(dateStr);
                                    if (!isNaN(tempDate.getTime())) {
                                      const timezoneOffsetMs = tempDate.getTimezoneOffset() * 60 * 1000;
                                      updateTime = new Date(tempDate.getTime() - timezoneOffsetMs);
                                    }
                                  }

                                  const now = new Date();
                                  const diffMs = now.getTime() - updateTime.getTime();
                                  const diffSec = Math.floor(diffMs / 1000);

                                  if (diffSec < 0) return 'just now';
                                  if (diffSec < 60) return `${diffSec}s ago`;
                                  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
                                  return `${Math.floor(diffSec / 3600)}h ago`;
                                } catch (error) {
                                  return 'unknown';
                                }
                              })()}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs">
                        <div className="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-1 rounded border border-gray-200 dark:border-gray-700">
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full"></div>
                            <span>No data</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 flex gap-2">
                    <button
                      className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition flex items-center justify-center disabled:opacity-50"
                      onClick={() => handleDelete(builder)}
                      title="Delete Builder"
                      disabled={!!deletingId}
                    >
                      <Trash className="h-4 w-4" />
                      {deletingId === builder.id && (
                        <span className="ml-2 animate-spin">⏳</span>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {sortedOnDemandBuilders.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No on-demand builders found.
            </div>
          )}
        </>
      )}

      <Dialog open={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Builder</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete builder <span className="font-mono font-bold">{confirmDelete?.id}</span>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={!!deletingId}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDeleteBuilder} disabled={!!deletingId}>
              {deletingId ? <span className="animate-spin mr-2">⏳</span> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!debugBuilder} onOpenChange={(open) => { if (!open) setDebugBuilder(null); }}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Debug Information - {debugBuilder?.id}</DialogTitle>
            <DialogDescription>
              Detailed debugging information for terminated VM
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {(debugBuilder as any)?.lastCommand && (
              <div>
                <h4 className="font-semibold text-sm mb-2">Last Command:</h4>
                <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-sm overflow-x-auto">
                  {(debugBuilder as any).lastCommand}
                </pre>
              </div>
            )}

            {(debugBuilder as any)?.lastStdout && (
              <div>
                <h4 className="font-semibold text-sm mb-2">Last Stdout:</h4>
                <pre className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-sm max-h-40 overflow-auto">
                  {(debugBuilder as any).lastStdout}
                </pre>
              </div>
            )}

            {(debugBuilder as any)?.lastStderr && (
              <div>
                <h4 className="font-semibold text-sm mb-2">Last Stderr:</h4>
                <pre className="bg-red-50 dark:bg-red-900/20 p-3 rounded text-sm max-h-40 overflow-auto text-red-800 dark:text-red-200">
                  {(debugBuilder as any).lastStderr}
                </pre>
              </div>
            )}

            {(debugBuilder as any)?.failureDetails && (
              <div>
                <h4 className="font-semibold text-sm mb-2">Failure Details:</h4>
                <pre className="bg-orange-50 dark:bg-orange-900/20 p-3 rounded text-sm overflow-x-auto text-orange-800 dark:text-orange-200">
                  {(debugBuilder as any).failureDetails}
                </pre>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-semibold">Architecture:</span> {debugBuilder?.architecture}
              </div>
              <div>
                <span className="font-semibold">Status:</span> {debugBuilder?.status}
              </div>
              <div>
                <span className="font-semibold">Termination Reason:</span> {debugBuilder?.terminationReason}
              </div>
              <div>
                <span className="font-semibold">Deleted At:</span> {debugBuilder ? formatDateTime(debugBuilder.deletedAt) : '-'}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setDebugBuilder(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
