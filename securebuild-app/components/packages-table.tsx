"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Play, Github, PackageIcon, ChevronRight, ChevronDown, ExternalLink, Clock, Calendar, Cpu, Shield, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { AutoTriggerModal } from "@/components/auto-trigger-modal"
import { Package } from "@/lib/types/package"
import React from "react"
import { useSession } from "@/app/hooks/use-session"
import { buildPackageChainAction } from "@/lib/package/actions/build-package-chain"
import { DeletePackageModal } from "@/components/delete-package-modal"
import { deletePackageAction } from "@/lib/package/actions/delete-package"
import { checkForUpdatesAction } from "@/lib/package/actions/check-for-updates"


type SortField = "name" | "version" | "status" | "created" | "lastBuild";
type SortDirection = "asc" | "desc";

interface SortConfig {
  field: SortField | null;
  direction: SortDirection;
}

interface PackagesTableProps {
  packages: Package[]
  onRefresh?: () => Promise<void>
  onSort?: (field: SortField) => void
  sortConfig?: SortConfig
}

export function PackagesTable({ packages, onRefresh, onSort, sortConfig }: PackagesTableProps) {
  const router = useRouter()
  // Modal states
  const [autoTriggerModalOpen, setAutoTriggerModalOpen] = useState(false)
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null)
  const [selectedTriggerType, setSelectedTriggerType] = useState<string | null>(null)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const { session, isSessionLoading } = useSession()
  const [isBuildLoading, setIsBuildLoading] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [isUpdateQueuedModalOpen, setIsUpdateQueuedModalOpen] = useState(false)
  const [updateQueuedPackageName, setUpdateQueuedPackageName] = useState<string | null>(null)

  const handleCheckForUpdates = async (pkg: Package) => {
    if (!session) return
    await checkForUpdatesAction(session, pkg.id)
    setUpdateQueuedPackageName(pkg.name)
    setIsUpdateQueuedModalOpen(true)
  }

  const handleBuildPackageChain = async (pkg: Package) => {
    if (!session) return
    setIsBuildLoading(true)
    setSelectedPackage(pkg)
    try {
      await buildPackageChainAction(session, pkg.id)
      // Refresh the package list to show updated status
      if (onRefresh) {
        await onRefresh()
      }
    } catch (error) {
      console.error("Error building package chain:", error)
    } finally {
      setIsBuildLoading(false)
    }
  }

  const handleAutoTrigger = (pkg: Package, triggerType: string) => {
    setSelectedPackage(pkg)
    setSelectedTriggerType(triggerType)
    setAutoTriggerModalOpen(true)
  }

  const handleDeletePackage = (pkg: Package) => {
    setSelectedPackage(pkg)
    setDeleteModalOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!session || !selectedPackage) return
    setDeleteLoading(true)
    try {
      await deletePackageAction(session, selectedPackage.id)
      setDeleteModalOpen(false)
      setSelectedPackage(null)
      // Refresh the package list to show updated status
      if (onRefresh) {
        await onRefresh()
      }
    } catch (error) {
      console.error("Error deleting package:", error)
    } finally {
      setDeleteLoading(false)
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const formatDate = (dateInput: any) => {
    if (!dateInput) return "—"

    try {
      let date: Date;

      if (dateInput instanceof Date) {
        const localDate = dateInput;
        const timezoneOffsetMs = localDate.getTimezoneOffset() * 60 * 1000;
        date = new Date(localDate.getTime() - timezoneOffsetMs);
      } else {
        const timeString = String(dateInput);
        if (!timeString.includes('Z') && !timeString.includes('+') && !timeString.includes('-', 10)) {
          date = new Date(timeString + 'Z');
        } else {
          date = new Date(timeString);
        }
      }

      if (isNaN(date.getTime())) {
        return "Invalid";
      }

      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
      } else if (diffHours < 24) {
        return `${diffHours}h ago`;
      } else if (diffDays < 7) {
        return `${diffDays}d ago`;
      } else {
        return date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
        });
      }
    } catch (error) {
      return "Invalid";
    }
  }

  const formatCompactDate = (dateInput: any) => {
    if (!dateInput) return "—"

    try {
      let date: Date;
      if (dateInput instanceof Date) {
        date = dateInput;
      } else {
        date = new Date(dateInput);
      }

      if (isNaN(date.getTime())) {
        return "Invalid";
      }

      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: '2-digit'
      });
    } catch (error) {
      return "Invalid";
    }
  }

  const SortableHeader = ({ field, children, className }: { field?: SortField; children: React.ReactNode; className?: string }) => {
    if (!field || !onSort) {
      return <TableHead className={className}>{children}</TableHead>
    }

    const isActive = sortConfig?.field === field
    const direction = isActive ? sortConfig.direction : null

    return (
      <TableHead className={className}>
        <button 
          className="flex items-center gap-1 hover:text-foreground text-left w-full"
          onClick={() => onSort(field)}
        >
          {children}
          {isActive ? (
            direction === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-50" />
          )}
        </button>
      </TableHead>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <SortableHeader field="name" className="w-[200px] py-2">Package</SortableHeader>
              <SortableHeader field="version" className="w-[120px] py-2">Version & Release</SortableHeader>
              <TableHead className="w-[100px] py-2">Source</TableHead>
              <SortableHeader field="lastBuild" className="w-[140px] py-2">Last Build</SortableHeader>
              <SortableHeader field="status" className="w-[100px] py-2">Status</SortableHeader>
              <SortableHeader field="created" className="w-[100px] py-2">Created</SortableHeader>
              <TableHead className="w-[80px] py-2">Versions</TableHead>
              <TableHead className="w-[80px] py-2 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packages.map((pkg) => (
              <React.Fragment key={pkg.id}>
                <TableRow className={`text-xs`}>
                  <TableCell className="py-2 pr-2">
                    <div className="flex items-center gap-1">
                      {pkg.subpackages && pkg.subpackages.length > 0 ? (
                        <button
                          className="p-0.5 hover:bg-gray-100 rounded"
                          onClick={() => toggleExpand(pkg.id)}
                          aria-label={expandedRows[pkg.id] ? "Collapse" : "Expand"}
                        >
                          {expandedRows[pkg.id] ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                        </button>
                      ) : (
                        <span className="w-4" />
                      )}
                      <div className="min-w-0 flex-1">
                        <Link href={`/packages/${pkg.id}`} className="font-medium text-sm truncate hover:underline">{pkg.name}</Link>
                        {pkg.subpackages && pkg.subpackages.length > 0 && (
                          <div className="text-xs text-muted-foreground">
                            {pkg.subpackages.length} subpackage{pkg.subpackages.length !== 1 ? 's' : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="py-2 px-2">
                    <div className="space-y-0.5">
                      <div className="font-mono text-xs">
                        {pkg.lastVersion || "—"}
                      </div>
                      {pkg.lastVersion && (
                        <div className="text-xs text-muted-foreground">
                          r{pkg.lastAPKRelease}
                        </div>
                      )}
                      {pkg.versionInfos && pkg.versionInfos.length > 1 && (
                        <div className="text-xs text-muted-foreground">
                          +{pkg.versionInfos.length - 1} more
                        </div>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      <>
                        <Shield className="h-3 w-3 text-green-500" />
                        <span className="text-xs text-green-600 dark:text-green-400">Internal</span>
                      </>
                    </div>
                  </TableCell>

                  <TableCell className="py-2 px-2">
                    {pkg.lastBuildTime ? (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs">{formatDate(pkg.lastBuildTime)}</span>
                        </div>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-xs px-1 py-0 h-4">
                        Never
                      </Badge>
                    )}
                  </TableCell>

                  <TableCell className="py-2 px-2">
                    <Badge
                      variant={
                        pkg.lastBuildStatus === "success" ? "default" :
                        pkg.lastBuildStatus === "failed" ? "destructive" :
                        pkg.lastBuildStatus === "running" ? "secondary" :
                        "outline"
                      }
                      className="text-xs px-1.5 py-0 h-5"
                    >
                      {pkg.lastBuildStatus || "pending"}
                    </Badge>
                  </TableCell>

                  <TableCell className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs">{formatCompactDate(pkg.createdAt)}</span>
                    </div>
                  </TableCell>

                  <TableCell className="py-2 px-2">
                    <div className="text-xs text-center">
                      <div className="font-medium">{pkg.versionLabels?.length || 0}</div>
                      <div className="text-muted-foreground">versions</div>
                    </div>
                  </TableCell>

                  <TableCell className="py-2 pl-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={() => handleBuildPackageChain(pkg)}
                        title="Build Package Chain"
                        disabled={isBuildLoading}
                      >
                        {isBuildLoading && selectedPackage?.id === pkg.id ?
                          <PackageIcon className="h-3 w-3 animate-spin" /> :
                          <Play className="h-3 w-3" />
                        }
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                            <MoreHorizontal className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="text-xs">
                          <>
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem>
                              <Link href={`/packages/${pkg.id}`} className="w-full">
                                View Details
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => handleBuildPackageChain(pkg)} disabled={isBuildLoading && selectedPackage?.id === pkg.id}>
                              {isBuildLoading && selectedPackage?.id === pkg.id ? "Building..." : "Build Package Chain"}
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCheckForUpdates(pkg)}>Check for Updates</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-600" onClick={() => handleDeletePackage(pkg)}>Delete Package</DropdownMenuItem>
                          </>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedRows[pkg.id] && pkg.subpackages && pkg.subpackages.length > 0 && (
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={8} className="py-2 pl-8">
                      <div className="text-xs font-medium text-muted-foreground mb-1">Subpackages:</div>
                      <div className="flex flex-wrap gap-1">
                        {pkg.subpackages.map((sub) => (
                          <Link
                            key={sub.id}
                            href={`/packages/${sub.id}`}
                            className="text-xs bg-muted hover:bg-muted/80 px-2 py-1 rounded border hover:underline"
                          >
                            {sub.name}
                          </Link>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Modals */}
      {selectedPackage && (
        <>
          {autoTriggerModalOpen && selectedTriggerType && (
            <AutoTriggerModal
              isOpen={autoTriggerModalOpen}
              onClose={() => setAutoTriggerModalOpen(false)}
              packageName={selectedPackage.name}
              triggerType={selectedTriggerType}
            />
          )}
          <DeletePackageModal
            isOpen={deleteModalOpen}
            onClose={() => setDeleteModalOpen(false)}
            packageName={selectedPackage.name}
            onDelete={handleConfirmDelete}
            isLoading={deleteLoading}
          />
        </>
      )}
      {/* Modal for update queued message */}
      <UpdateQueuedModal
        isOpen={isUpdateQueuedModalOpen}
        onClose={() => setIsUpdateQueuedModalOpen(false)}
        packageName={updateQueuedPackageName}
      />
    </>
  )
}

// Modal for update queued message
interface UpdateQueuedModalProps {
  isOpen: boolean
  onClose: () => void
  packageName: string | null
}

function UpdateQueuedModal({ isOpen, onClose, packageName }: UpdateQueuedModalProps) {
  if (!isOpen || !packageName) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800">
        <h3 className="mb-4 text-lg font-medium">Update Queued</h3>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          {`This package (${packageName}) has been queued to check for updates. Check back here for results.`}
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  )
}
