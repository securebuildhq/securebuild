"use client"

import { useState, useEffect, useMemo, useRef } from "react"

import { Button } from "@/components/ui/button"
import { Plus, Filter, X, Pencil, ChevronDown, Search } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSetAtom } from "jotai"
import { persistedMelangeIdAtom } from "@/app/state/melange-generation-atom"
import { PackagesTable } from "@/components/packages-table"
import { useSession } from "@/app/hooks/use-session"
import { Package } from "@/lib/types/package"
import { listPackagesAction } from "@/lib/package/actions/list-packages"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

// Helper for filter labels
const FILTER_OPTIONS = {
  status: {
    label: "Last Build Status",
    values: {
      pending: "Pending",
      queued: "Queued",
      building: "Building",
      publishing: "Publishing",
      success: "Success",
      failed: "Failed",
      vm_deleted: "VM Deleted",
      all: "All Statuses",
    },
  },
  fips: {
    label: "FIPS",
    values: {
      fips: "FIPS",
      "non-fips": "Non-FIPS",
      all: "All",
    },
  },
  type: {
    label: "Type",
    values: {
      rpm: "RPM",
      deb: "DEB",
      apk: "APK",
      all: "All Types",
    },
  },
  arch: {
    label: "Architecture",
    values: {
      x86_64: "x86_64",
      aarch64: "aarch64",
      all: "All Architectures",
    },
  },
  source: {
    label: "Source",
    values: {
      all: "All Sources",
      internal: "Internal",
      external: "External",
    },
  },
}

type FilterKey = "status" | "fips" | "search" | "type" | "arch" | "source";
interface Filters {
  search: string;
  status: string;
  fips: string;
  type: string;
  arch: string;
  source: string;
}

type SortField = "name" | "version" | "status" | "created" | "lastBuild";
type SortDirection = "asc" | "desc";

interface SortConfig {
  field: SortField | null;
  direction: SortDirection;
}

const PAGE_SIZE = 100;

export default function InternalPackagesPage() {
  const { session, isSessionLoading } = useSession()
  const router = useRouter()
  const setPersistedId = useSetAtom(persistedMelangeIdAtom)
  const [packages, setPackages] = useState<Package[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const isFirstRender = useRef(true)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: null, direction: "asc" })

  const handleSort = (field: SortField) => {
    setSortConfig((prev) => ({
      field,
      direction: prev.field === field && prev.direction === "asc" ? "desc" : "asc",
    }))
    setCurrentPage(1) // Reset to first page when sorting changes
  }

  // Filter state (excluding search for API calls)
  const [filters, setFilters] = useState<Filters>({
    search: "",
    status: "all",
    fips: "all",
    type: "all",
    arch: "all",
    source: "all",
  })
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [editFilter, setEditFilter] = useState<FilterKey | null>(null)

  // Debounce search input to avoid API calls on every keystroke
  useEffect(() => {
    // Skip the debounced effect on the first render to prevent double loading
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const timeoutId = setTimeout(() => {
      // Only update if the search value has actually changed
      setFilters((prev) => {
        if (prev.search === searchTerm) {
          return prev; // Don't trigger a state update if value hasn't changed
        }
        return { ...prev, search: searchTerm };
      });

      // Only reset to page 1 if we're not already on page 1 and search actually changed
      if (currentPage !== 1 && searchTerm !== filters.search) {
        setCurrentPage(1);
      }
    }, 300) // 300ms debounce

    return () => clearTimeout(timeoutId)
  }, [searchTerm, currentPage, filters.search])

  // Handlers for filter changes
  const handleFilterChange = (key: FilterKey, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
    setCurrentPage(1) // Reset to first page when filters change
  }
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value) // Update UI immediately
    // Don't update filters.search here - let the debounced useEffect handle it
  }
  const handleClearFilter = (key: FilterKey) => {
    if (key === "search") {
      setSearchTerm("")
      setFilters((prev) => ({ ...prev, search: "" })) // Clear immediately for better UX
    } else {
      setFilters((prev) => ({ ...prev, [key]: "all" }))
    }
    setCurrentPage(1) // Reset to first page when filters change
  }
  const handleEditFilter = (key: FilterKey) => {
    setEditFilter(key)
    setPopoverOpen(true)
  }
  const handlePopoverOpenChange = (open: boolean) => {
    setPopoverOpen(open)
    if (!open) setEditFilter(null)
  }

  const doListPackages = async (isInitialLoad = false) => {
    if (!session) {
      setLoading(false);
      return;
    }
    
    // Only show full page loading on initial load
    if (isInitialLoad) {
      setLoading(true)
    } else {
      setSearchLoading(true)
    }
    
    // Include search and sorting in API call
    const filtersWithSort = {
      ...filters,
      sortField: sortConfig.field || undefined,
      sortDirection: sortConfig.field ? sortConfig.direction : undefined,
    }
    const pagination = { page: currentPage, limit: PAGE_SIZE }
    const result = await listPackagesAction(filtersWithSort, pagination)
    console.log(result)
    setPackages(result.packages)
    setTotalCount(result.totalCount)
    
    if (isInitialLoad) {
      setLoading(false)
    } else {
      setSearchLoading(false)
    }
  }

  const refreshPackages = async () => {
    if (!session) return;
    // Refresh without showing loading state
    const filtersWithSort = {
      ...filters,
      sortField: sortConfig.field || undefined,
      sortDirection: sortConfig.field ? sortConfig.direction : undefined,
    }
    const pagination = { page: currentPage, limit: PAGE_SIZE }
    const result = await listPackagesAction(filtersWithSort, pagination)
    setPackages(result.packages)
    setTotalCount(result.totalCount)
  }

  useEffect(() => {
    // Check if this is the initial load (when packages array is empty and loading is true)
    const isInitialLoad = packages.length === 0 && loading
    doListPackages(isInitialLoad)
  }, [session, filters, currentPage, sortConfig]);

  const handleNavigateToAiPage = () => {
    setPersistedId(null)
    router.push("/packages/ai")
  }

  // Calculate pagination info
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const startItem = (currentPage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(currentPage * PAGE_SIZE, totalCount);

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const pages = [];
    const maxVisiblePages = 5;

    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('ellipsis');
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push('ellipsis');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push('ellipsis');
        pages.push(totalPages);
      }
    }

    return pages;
  };

  // Session is handled by the dashboard layout
  if (!session || !session?.user || isSessionLoading) {
    return (
      <div className="flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <div>Loading packages...</div>
        </div>
      </div>
    );
  }

  return (
    <>
      {loading && packages.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
            <div>Loading packages...</div>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0 mb-6">
            <div className="inline-flex items-center">
              <Button asChild className="rounded-r-none">
                <Link href="/packages/new" className="flex items-center">
                  <Plus className="mr-2 h-4 w-4" />
                  New Package
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="rounded-l-none -ml-px px-3">
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href="/packages/new">Create from existing melange.yaml</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleNavigateToAiPage}>
                    Use AI to author a melange.yaml
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Search bar */}
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Search packages by name..."
                value={searchTerm}
                onChange={handleSearchChange}
                className="pl-10 w-full md:w-96"
              />
              {searchLoading && (
                <div className="absolute right-12 top-1/2 -translate-y-1/2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                </div>
              )}
              {searchTerm && (
                <button
                  onClick={() => handleClearFilter("search")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Filters popover and dynamic filter pills UI */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Popover open={popoverOpen} onOpenChange={handlePopoverOpenChange}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="flex items-center gap-2">
                  <Filter className="h-4 w-4" /> Filters
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="flex flex-col gap-4">
                  <Select value={filters.status} onValueChange={v => handleFilterChange("status", v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Filter by last build status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="queued">Queued</SelectItem>
                      <SelectItem value="building">Building</SelectItem>
                      <SelectItem value="testing">Testing</SelectItem>
                      <SelectItem value="publishing">Publishing</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                      <SelectItem value="vm_deleted">VM Deleted</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={filters.fips} onValueChange={v => handleFilterChange("fips", v)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="FIPS available" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="fips">FIPS</SelectItem>
                      <SelectItem value="non-fips">Non-FIPS</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="secondary" className="w-full mt-2" onClick={() => setPopoverOpen(false)}>Apply Filters</Button>
                </div>
              </PopoverContent>
            </Popover>
            {/* Dynamic filter pills */}
            {Object.entries(filters).map(([key, value]) => {
              if (value === "all" || value === "") return null
              const typedKey = key as FilterKey;
              let label, display;

              if (key === "search") {
                label = "Search";
                display = `"${value}"`;
              } else {
                const filterOption = FILTER_OPTIONS[typedKey as Exclude<FilterKey, "search">];
                label = filterOption?.label || key;
                const valuesObj = filterOption?.values as Record<string, string> | undefined;
                display = valuesObj?.[value as string] || value;
              }

              return (
                <Badge key={key} className="flex items-center gap-1">
                  {label}: {display}
                  {key !== "search" && (
                    <button className="ml-1" aria-label="Edit filter" onClick={() => handleEditFilter(typedKey)}>
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  <button className="ml-1" aria-label="Remove filter" onClick={() => handleClearFilter(typedKey)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              )
            })}
          </div>

          {/* Results info */}
          <div className="mb-4 text-sm text-muted-foreground">
            {searchLoading ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                Searching packages...
              </div>
            ) : (
              <>Showing {startItem}-{endItem} of {totalCount} packages</>
            )}
          </div>

          {packages.length > 0 ? (
            <div className={searchLoading ? "opacity-50 transition-opacity" : ""}>
              <PackagesTable 
                packages={packages} 
                onRefresh={refreshPackages} 
                onSort={handleSort}
                sortConfig={sortConfig}
              />

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

                      {getPageNumbers().map((page, index) => (
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
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-6">
              <svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g filter="url(#shadow)">
                  <rect x="20" y="36" width="56" height="32" rx="6" fill="#F3F4F6" />
                  <rect x="28" y="44" width="40" height="16" rx="3" fill="#E0E7EF" />
                  <rect x="40" y="56" width="16" height="5" rx="2.5" fill="#CBD5E1" />
                  <rect x="44" y="64" width="8" height="3" rx="1.5" fill="#CBD5E1" />
                  <rect x="20" y="36" width="56" height="32" rx="6" stroke="#A5B4FC" strokeWidth="2" />
                  <polygon points="48,20 76,36 20,36" fill="#A5B4FC" />
                  <polygon points="48,20 76,36 48,52 20,36" fill="#6366F1" fillOpacity="0.15" />
                </g>
                <g>
                  <circle cx="72" cy="72" r="12" fill="#FDE68A" />
                  <circle cx="72" cy="72" r="7" fill="#F59E42" fillOpacity="0.3" />
                  <rect x="80" y="80" width="8" height="2" rx="1" transform="rotate(45 80 80)" fill="#F59E42" />
                </g>
                <defs>
                  <filter id="shadow" x="0" y="10" width="96" height="86" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                    <feFlood floodOpacity="0" result="BackgroundImageFix" />
                    <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" />
                    <feOffset dy="4" />
                    <feGaussianBlur stdDeviation="6" />
                    <feColorMatrix type="matrix" values="0 0 0 0 0.2 0 0 0 0 0.22 0 0 0 0 0.4 0 0 0 0.12 0" />
                    <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow" />
                    <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow" result="shape" />
                  </filter>
                </defs>
              </svg>
              <div>
                <h2 className="text-xl font-semibold mb-2">No packages found</h2>
                <p className="text-muted-foreground max-w-md">
                  {searchTerm
                    ? 'No packages matching "' + searchTerm + '". Try adjusting your search or filters.'
                    : "Try adjusting your filters to find packages that match your criteria."}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
