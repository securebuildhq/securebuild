"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"

import { BuildsTable } from "@/components/builds-table"
import { useSession } from "@/app/hooks/use-session"
import { listAllImageBuildsAction } from "@/lib/image/actions/list-all-image-builds"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Activity, CheckCircle, XCircle, Clock } from "lucide-react"
import { ImageBuild } from "@/lib/types/image"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

type StatusFilter = "all" | "success" | "failed" | "building" | "pending" | "queued" | "timed_out"
type TimePeriod = "1hr" | "4h" | "1d"

const PAGE_SIZE = 50;

export default function ImageBuildsPage() {
  const { session, isSessionLoading } = useSession();
  const router = useRouter();
  const user = session?.user;
  const [builds, setBuilds] = useState<ImageBuild[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("1hr")

  // Helper function to filter builds by time period
  const filterBuildsByTimePeriod = (builds: ImageBuild[], period: TimePeriod) => {
    const now = new Date();
    let cutoffTime: Date;

    switch (period) {
      case "1hr":
        cutoffTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case "4h":
        cutoffTime = new Date(now.getTime() - 4 * 60 * 60 * 1000);
        break;
      case "1d":
        cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      default:
        cutoffTime = new Date(now.getTime() - 60 * 60 * 1000);
    }

    return builds.filter(build => new Date(build.createdAt) >= cutoffTime);
  };

  // Filter builds based on time period first, then status
  const timeFilteredBuilds = filterBuildsByTimePeriod(builds, timePeriod);
  
  const filteredBuilds = timeFilteredBuilds.filter((build) => {
    if (statusFilter === "all") return true;

    const status = build.status.toLowerCase();

    // For backward compatibility, handle grouped filters
    if (statusFilter === "failed") {
      return status === "failed" || status === "timed_out";
    }
    if (statusFilter === "success") {
      return status === "success";
    }
    if (statusFilter === "queued") {
      return status === "queued" || status === "pending";
    }
    if (statusFilter === "building") {
      return status === "building";
    }

    // Handle individual status filters
    return status === statusFilter;
  });

  // Pagination logic
  const totalPages = Math.ceil(filteredBuilds.length / PAGE_SIZE);
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedBuilds = filteredBuilds.slice(startIndex, endIndex);

  // Load builds data
  useEffect(() => {
    if (session && user) {
      const loadBuilds = async () => {
        try {
          setLoading(true);
          const fetchedBuilds = await listAllImageBuildsAction(session);
          setBuilds(fetchedBuilds);
          setTotalCount(fetchedBuilds.length);
        } catch (error) {
          console.error("Failed to load image builds:", error);
        } finally {
          setLoading(false);
        }
      };

      loadBuilds();
    } else {
      setLoading(false);
    }
  }, [session, user]);

  // Reset pagination when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, timePeriod]);

  const handleStatusFilterChange = (value: StatusFilter) => {
    setStatusFilter(value);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;
    
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      const startPage = Math.max(1, currentPage - 2);
      const endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
      
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }
    }
    
    return pages;
  };

  // Count builds by status (based on filtered builds)
  const buildCounts = {
    all: timeFilteredBuilds.length,
    success: timeFilteredBuilds.filter(b => b.status === "success").length,
    failed: timeFilteredBuilds.filter(b => b.status === "failed" || b.status === "timed_out").length,
    building: timeFilteredBuilds.filter(b => b.status === "building").length,
    pending: timeFilteredBuilds.filter(b => b.status === "pending" || b.status === "queued").length,
  };

  // Session is handled by the layout
  if (!session || !user || isSessionLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading image builds...</div>
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
                <div>Loading image builds...</div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
                <div>
                  <h1 className="text-3xl font-bold">Image Builds</h1>
                  <p className="text-muted-foreground">View all image build history</p>
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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Builds</CardTitle>
                    <Activity className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{buildCounts.all}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Successful</CardTitle>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-green-600">{buildCounts.success}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Failed</CardTitle>
                    <XCircle className="h-4 w-4 text-red-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-red-600">{buildCounts.failed}</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Building</CardTitle>
                    <Clock className="h-4 w-4 text-blue-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-blue-600">{buildCounts.building}</div>
                  </CardContent>
                </Card>
              </div>

              {/* Filters */}
              <div className="flex items-center space-x-4 mb-6">
                <div className="flex items-center space-x-2">
                  <Label htmlFor="status-filter">Status:</Label>
                  <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                    <SelectTrigger id="status-filter" className="w-[180px]">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="building">Building</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Results info */}
              {!loading && (
                <div className="mb-4 text-sm text-muted-foreground">
                  Showing {filteredBuilds.length} of {buildCounts.all} builds ({timePeriod === "1hr" ? "1 hour" : timePeriod === "4h" ? "4 hours" : "1 day"} period)
                </div>
              )}

              {/* Builds Table */}
              <div className="mb-6">
                <BuildsTable builds={paginatedBuilds} showImageName={true} />
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-center">
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => handlePageChange(Math.max(1, currentPage - 1))}
                          className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                      {getPageNumbers().map((page) => (
                        <PaginationItem key={page}>
                          <PaginationLink
                            onClick={() => handlePageChange(page)}
                            isActive={currentPage === page}
                            className="cursor-pointer"
                          >
                            {page}
                          </PaginationLink>
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => handlePageChange(Math.min(totalPages, currentPage + 1))}
                          className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              )}
            </>
          )}
    </div>
  );
} 
