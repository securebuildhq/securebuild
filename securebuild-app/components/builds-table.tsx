"use client"
import { useState } from "react"
import React from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, CheckCircle, XCircle, AlertCircle, Loader2, Eye, Tag, FlaskConical, Upload, Play } from "lucide-react"
import { ImageBuild, ImageBuildStatus } from "@/lib/types/image"
import Link from "next/link"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

interface BuildsTableProps {
  builds: ImageBuild[]
  showImageName?: boolean
}

interface StatusConfig {
  variant: "default" | "destructive" | "success" | "secondary" | "outline" | "warning";
  icon: React.ElementType;
  label: string;
}

const statusConfig: Record<ImageBuildStatus, StatusConfig> = {
  pending: { variant: "secondary", icon: Clock, label: "Pending" },
  queued: { variant: "secondary", icon: Clock, label: "Queued" },
  building: { variant: "default", icon: Loader2, label: "Building" },
  testing: { variant: "warning", icon: FlaskConical, label: "Testing" },
  publishing: { variant: "default", icon: Upload, label: "Publishing" },
  running: { variant: "default", icon: Play, label: "Running" },
  success: { variant: "success", icon: CheckCircle, label: "Success" },
  failed: { variant: "destructive", icon: XCircle, label: "Failed" },
  timed_out: { variant: "destructive", icon: Clock, label: "Timed Out" },
};

const defaultStatusConfig: StatusConfig = {
  variant: "outline",
  icon: AlertCircle,
  label: "Unknown",
};

export function BuildsTable({ builds, showImageName = false }: BuildsTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

  // Helper function to check if a build is in progress
  const isBuilding = (build: ImageBuild) => {
    return build.status === "building" || build.status === "queued" || build.status === "testing" || build.status === "publishing" || build.status === "running";
  };

  // Helper function to check if a build is in a failed state
  const isFailed = (build: ImageBuild) => {
    return build.status === "failed" || build.status === "timed_out";
  };

  // Calculate pagination values
  const totalPages = Math.ceil(builds.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentBuilds = builds.slice(startIndex, endIndex);

  // Find the index where building builds end (within the current page)
  const buildingEndIndex = currentBuilds.findIndex((build, index) => {
    if (index === 0) return false;
    return !isBuilding(build) && isBuilding(currentBuilds[index - 1]);
  });

  const shouldShowSeparator = buildingEndIndex > 0;

  // Reset to first page when builds change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [builds.length]);

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {showImageName && <TableHead>Image Name</TableHead>}
            <TableHead>Image Tags</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {currentBuilds.map((build, index) => {
            const startDate = new Date(build.createdAt)

            // Determine the end time and duration based on status
            let durationFormatted: string;

            if (build.status === 'success' || build.status === 'failed' || build.status === 'timed_out') {
              if (build.buildFinishedAt) {
                const endDate = new Date(build.buildFinishedAt)
                const durationMs = endDate.getTime() - startDate.getTime()
                const durationMinutes = Math.floor(durationMs / 60000)
                const durationSeconds = Math.floor((durationMs % 60000) / 1000)
                durationFormatted = `${durationMinutes}m ${durationSeconds}s`
              } else {
                durationFormatted = "-"
              }
            } else if (build.status === 'building' || build.status === 'testing' || build.status === 'publishing' || build.status === 'running') {
              // For ongoing builds, calculate from start to now
              const now = new Date()
              const durationMs = now.getTime() - startDate.getTime()
              const durationMinutes = Math.floor(durationMs / 60000)
              const durationSeconds = Math.floor((durationMs % 60000) / 1000)
              durationFormatted = `${durationMinutes}m ${durationSeconds}s (ongoing)`
            } else {
              // For pending or queued statuses
              durationFormatted = "-"
            }

            const currentStatus = build.status;
            const { variant, icon: Icon, label } = statusConfig[currentStatus] || defaultStatusConfig;

            return (
              <React.Fragment key={build.id}>
                {/* Show separator before the first non-building build */}
                {shouldShowSeparator && index === buildingEndIndex && (
                  <TableRow key={`separator-${index}`} className="border-t-2 border-muted">
                    <TableCell colSpan={showImageName ? 5 : 4} className="py-3 text-center text-sm text-muted-foreground bg-muted/30">
                      <div className="flex items-center justify-center gap-2">
                        <div className="h-px bg-border flex-1" />
                        <span className="px-3 font-medium">Previous Builds</span>
                        <div className="h-px bg-border flex-1" />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                <TableRow>
                  {showImageName && (
                    <TableCell>
                      <Link href={`/images/${build.imageId}`} className="text-blue-600 hover:underline">
                        {build.imageName}
                      </Link>
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {build.imageTags && build.imageTags.length > 0 ? (
                        build.imageTags.map((tag, tagIndex) => (
                          <Badge key={tagIndex} variant="outline" className="text-xs">
                            <Tag className="h-3 w-3 mr-1" />
                            {tag}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={variant} className="whitespace-nowrap">
                      <Icon className={`mr-1 h-4 w-4 ${Icon === Loader2 ? "animate-spin" : ""}`} />
                      {label}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(build.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{durationFormatted}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/builds/${build.id}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="View Details"
                        >
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
      
      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center space-x-2 py-4">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setCurrentPage(prev => Math.max(prev - 1, 1));
                  }}
                  className={currentPage === 1 ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
              
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <PaginationItem key={page}>
                  <PaginationLink
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      setCurrentPage(page);
                    }}
                    isActive={currentPage === page}
                  >
                    {page}
                  </PaginationLink>
                </PaginationItem>
              ))}
              
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setCurrentPage(prev => Math.min(prev + 1, totalPages));
                  }}
                  className={currentPage === totalPages ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  )
} 