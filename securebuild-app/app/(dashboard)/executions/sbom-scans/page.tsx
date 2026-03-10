"use client";

import { useState, useEffect, useRef } from "react";

import { useSession } from "@/app/hooks/use-session";
import {
  getExternalSBOMCountsAction,
  listExternalSBOMStatusesAction,
  type SerializedExternalSBOMStatusItem,
} from "@/lib/vulnscan/actions/get-external-scan-data";
import type {
  ExternalSBOMCounts,
} from "@/lib/vulnscan/vulnscan";
import { parseImageSearchTerms } from "@/lib/utils/image-parser";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  FileSearch,
  Search,
} from "lucide-react";
import { formatTimeAgo } from "@/lib/utils/time";
import { getPageNumbers } from "@/lib/utils/pagination";

type TimePeriod = "1hr" | "4h" | "1d";
type SBOMStatusFilter = "all" | "pending" | "generating" | "succeeded" | "failed";

const PAGE_SIZE = 50;

function truncateDigest(digest: string): string {
  if (!digest) return "";
  const parts = digest.split(":");
  if (parts.length === 2) {
    return `${parts[0]}:${parts[1].substring(0, 12)}...`;
  }
  return digest.substring(0, 20) + "...";
}

function getSBOMStatusBadge(status: string) {
  switch (status) {
    case "pending":
      return <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Pending</Badge>;
    case "generating":
      return <Badge variant="default" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Generating</Badge>;
    case "succeeded":
      return <Badge variant="default" className="gap-1 bg-green-600 hover:bg-green-700"><CheckCircle className="h-3 w-3" />Succeeded</Badge>;
    case "failed":
      return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function SBOMScansPage() {
  const { session, isSessionLoading } = useSession();
  const user = session?.user;
  const [loading, setLoading] = useState(true);
  const initialLoadDone = useRef(false);
  const fetchSeqRef = useRef(0);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("1hr");

  // SBOM counts state
  const [sbomCounts, setSbomCounts] = useState<ExternalSBOMCounts>({
    pending: 0,
    generating: 0,
    succeeded: 0,
    failed: 0,
    total: 0,
  });
  const [countsLoading, setCountsLoading] = useState(true);

  // Table state
  const [sbomStatuses, setSbomStatuses] = useState<SerializedExternalSBOMStatusItem[]>([]);
  const [sbomPage, setSbomPage] = useState(1);
  const [sbomTotalCount, setSbomTotalCount] = useState(0);
  const [sbomStatusFilter, setSbomStatusFilter] = useState<SBOMStatusFilter>("all");
  const [imageTagSearch, setImageTagSearch] = useState("");
  const [debouncedRegistrySearch, setDebouncedRegistrySearch] = useState("");
  const [debouncedImageSearch, setDebouncedImageSearch] = useState("");
  const [debouncedTagSearch, setDebouncedTagSearch] = useState("");
  const [debouncedDigestSearch, setDebouncedDigestSearch] = useState("");

  // Debounce image search
  useEffect(() => {
    const timeout = setTimeout(() => {
      const parsed = parseImageSearchTerms(imageTagSearch);
      setDebouncedRegistrySearch(parsed.registry);
      setDebouncedImageSearch(parsed.image);
      setDebouncedTagSearch(parsed.tag);
      setDebouncedDigestSearch(parsed.digest || "");
      setSbomPage(1);
    }, 500);

    return () => clearTimeout(timeout);
  }, [imageTagSearch]);

  const fetchAllData = async () => {
    if (!session) return;
    const seq = ++fetchSeqRef.current;
    try {
      const [counts, statusesData] = await Promise.all([
        getExternalSBOMCountsAction(session, timePeriod),
        listExternalSBOMStatusesAction(
          session,
          {
            status: sbomStatusFilter === "all" ? undefined : sbomStatusFilter,
            timePeriod: debouncedRegistrySearch || debouncedImageSearch || debouncedTagSearch || debouncedDigestSearch ? undefined : timePeriod,
            registry: debouncedRegistrySearch || undefined,
            image: debouncedImageSearch || undefined,
            tag: debouncedTagSearch || undefined,
            digest: debouncedDigestSearch || undefined,
          },
          { page: sbomPage, limit: PAGE_SIZE }
        ),
      ]);

      if (seq !== fetchSeqRef.current) return false;

      const newTotalPages = Math.ceil(statusesData.totalCount / PAGE_SIZE);
      if (sbomPage > newTotalPages && newTotalPages > 0) {
        setSbomPage(1);
      }

      setSbomCounts(counts);
      setSbomStatuses(statusesData.statuses);
      setSbomTotalCount(statusesData.totalCount);
      return true;
    } catch (error) {
      console.error("Failed to fetch SBOM scan data:", error);
      return false;
    }
  };

  // Initial fetch
  useEffect(() => {
    if (session && user) {
      const doFetch = async () => {
        if (!initialLoadDone.current) {
          setLoading(true);
          setCountsLoading(true);
        }
        const committed = await fetchAllData();
        if (committed) {
          setLoading(false);
          setCountsLoading(false);
          initialLoadDone.current = true;
        }
      };
      doFetch();
    } else if (!isSessionLoading && !session) {
      setLoading(false);
      setCountsLoading(false);
    }
  }, [
    session,
    user,
    isSessionLoading,
    timePeriod,
    sbomPage,
    sbomStatusFilter,
    debouncedRegistrySearch,
    debouncedImageSearch,
    debouncedTagSearch,
    debouncedDigestSearch,
  ]);

  // Auto-refresh every 2 seconds
  useEffect(() => {
    if (!session || !user) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const schedule = () => {
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        try {
          const committed = await fetchAllData();
          if (committed) {
            setLoading(false);
            setCountsLoading(false);
            initialLoadDone.current = true;
          }
        } catch (error) {
          console.error("Auto-refresh failed:", error);
        }
        if (!cancelled) schedule();
      }, 2000);
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [
    session,
    user,
    timePeriod,
    sbomPage,
    sbomStatusFilter,
    debouncedRegistrySearch,
    debouncedImageSearch,
    debouncedTagSearch,
    debouncedDigestSearch,
  ]);

  if (!session || !user || isSessionLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading SBOM generations ...</div>
        </div>
      </div>
    );
  }

  const sbomTotalPages = Math.ceil(sbomTotalCount / PAGE_SIZE);
  const sbomStartItem = (sbomPage - 1) * PAGE_SIZE + 1;
  const sbomEndItem = Math.min(sbomPage * PAGE_SIZE, sbomTotalCount);

  return (
    <div className="p-6">
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
            <div>Loading SBOM generations ...</div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
            <div>
              <h1 className="text-3xl font-bold">SBOMs</h1>
              <p className="text-muted-foreground">Monitor SBOM generation queue status</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Label htmlFor="time-period">Time period:</Label>
                <Select
                  value={timePeriod}
                  onValueChange={(value: TimePeriod) => {
                    setTimePeriod(value);
                    setSbomPage(1);
                  }}
                >
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

          <div className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
              SBOM Generation Status
            </h3>
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                    <Clock className="h-4 w-4 mr-2" />
                    Pending
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {countsLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      sbomCounts.pending
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                    <FileSearch className="h-4 w-4 mr-2" />
                    Generating
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {countsLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      sbomCounts.generating
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground flex items-center">
                    <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                    Succeeded
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">
                    {countsLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      sbomCounts.succeeded
                    )}
                  </div>
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
                    {countsLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      sbomCounts.failed
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Filter and Table */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <div className="flex items-center space-x-2">
              <Label htmlFor="sbom-status-filter">Filter by status:</Label>
              <Select
                value={sbomStatusFilter}
                onValueChange={(value: SBOMStatusFilter) => {
                  setSbomStatusFilter(value);
                  setSbomPage(1);
                }}
              >
                <SelectTrigger id="sbom-status-filter" className="w-[180px]">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="generating">Generating</SelectItem>
                  <SelectItem value="succeeded">Succeeded</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2">
              <Label htmlFor="sbom-image-search">Image:</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="sbom-image-search"
                  placeholder="image:tag or sha256:..."
                  value={imageTagSearch}
                  onChange={(e) => setImageTagSearch(e.target.value)}
                  className="pl-7 w-[260px]"
                />
              </div>
            </div>
            {(debouncedRegistrySearch || debouncedImageSearch || debouncedTagSearch || debouncedDigestSearch) && (
              <p className="text-xs text-muted-foreground">Searching all time periods</p>
            )}
          </div>

          <div className="mb-4 text-sm text-muted-foreground">
            Showing {sbomTotalCount > 0 ? sbomStartItem : 0}-{sbomEndItem} of{" "}
            {sbomTotalCount} SBOM generations
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Image</TableHead>
                  <TableHead>Digest</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sbomStatuses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No SBOM generations found
                    </TableCell>
                  </TableRow>
                ) : (
                  sbomStatuses.map((status) => (
                    <TableRow key={status.digest}>
                      <TableCell className="font-medium">
                        {status.imageName ? (
                          `${status.registry ? status.registry + "/" : ""}${status.imageName}${status.imageTag ? ":" + status.imageTag : ""}`
                        ) : (
                          <span className="text-muted-foreground">Unknown</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs" title={status.digest}>
                        {truncateDigest(status.digest)}
                      </TableCell>
                      <TableCell>{getSBOMStatusBadge(status.status)}</TableCell>
                      <TableCell className="text-sm">
                        {formatTimeAgo(status.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatTimeAgo(status.statusUpdatedAt)}
                      </TableCell>
                      <TableCell
                        className="max-w-[200px] truncate text-xs text-red-600"
                        title={status.statusMessage || undefined}
                      >
                        {status.statusMessage || "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {sbomTotalPages > 1 && (
            <div className="mt-6">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        if (sbomPage > 1) setSbomPage(sbomPage - 1);
                      }}
                      className={sbomPage <= 1 ? "pointer-events-none opacity-50" : ""}
                    />
                  </PaginationItem>
                  {getPageNumbers(sbomPage, sbomTotalPages).map((page, index) => (
                    <PaginationItem key={index}>
                      {page === "ellipsis" ? (
                        <PaginationEllipsis />
                      ) : (
                        <PaginationLink
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            setSbomPage(page as number);
                          }}
                          isActive={sbomPage === page}
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
                        if (sbomPage < sbomTotalPages) setSbomPage(sbomPage + 1);
                      }}
                      className={
                        sbomPage >= sbomTotalPages ? "pointer-events-none opacity-50" : ""
                      }
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
