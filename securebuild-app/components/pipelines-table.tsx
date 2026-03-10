"use client"

import { useState, useMemo } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ChevronDown, ChevronUp, Clock, Package, Calendar, Eye, Play } from 'lucide-react'
import { PackageSparkline } from "@/components/package-sparkline"
import { PackageDetailCharts } from "@/components/package-detail-charts"
import Link from "next/link"

// Mock data for packages
const mockPackages = [
  {
    id: 1,
    name: "Web App Build",
    repository: "demouser/web-app",
    type: "OCI Image",
    lastEdited: "2023-05-15T14:35:00Z",
    lastExecution: "2023-05-20T10:20:00Z",
    status: "success",
    successRate: 92,
    executionHistory: [
      { date: "2023-05-01", success: true, duration: 320, idle: 86000 },
      { date: "2023-05-05", success: true, duration: 310, idle: 85000 },
      { date: "2023-05-10", success: false, duration: 400, idle: 84000 },
      { date: "2023-05-15", success: true, duration: 290, idle: 83000 },
      { date: "2023-05-20", success: true, duration: 300, idle: 82000 },
    ],
  },
  {
    id: 2,
    name: "API Service Build",
    repository: "demouser/api-service",
    type: "OCI Image",
    lastEdited: "2023-05-18T09:15:00Z",
    lastExecution: "2023-05-21T11:30:00Z",
    status: "failed",
    successRate: 78,
    executionHistory: [
      { date: "2023-05-01", success: true, duration: 280, idle: 86000 },
      { date: "2023-05-05", success: true, duration: 290, idle: 85000 },
      { date: "2023-05-10", success: true, duration: 270, idle: 84000 },
      { date: "2023-05-15", success: false, duration: 350, idle: 83000 },
      { date: "2023-05-21", success: false, duration: 340, idle: 82000 },
    ],
  },
  {
    id: 3,
    name: "Mobile App Build",
    repository: "demouser/mobile-app",
    type: "Binary",
    lastEdited: "2023-05-12T16:40:00Z",
    lastExecution: "2023-05-19T14:25:00Z",
    status: "success",
    successRate: 100,
    executionHistory: [
      { date: "2023-05-01", success: true, duration: 420, idle: 86000 },
      { date: "2023-05-05", success: true, duration: 410, idle: 85000 },
      { date: "2023-05-10", success: true, duration: 400, idle: 84000 },
      { date: "2023-05-15", success: true, duration: 390, idle: 83000 },
      { date: "2023-05-19", success: true, duration: 380, idle: 82000 },
    ],
  },
  {
    id: 4,
    name: "Data Processor Build",
    repository: "demouser/data-processor",
    type: "Binary",
    lastEdited: "2023-05-10T11:20:00Z",
    lastExecution: "2023-05-18T09:45:00Z",
    status: "running",
    successRate: 85,
    executionHistory: [
      { date: "2023-05-01", success: false, duration: 320, idle: 86000 },
      { date: "2023-05-05", success: true, duration: 310, idle: 85000 },
      { date: "2023-05-10", success: true, duration: 300, idle: 84000 },
      { date: "2023-05-15", success: true, duration: 290, idle: 83000 },
      { date: "2023-05-18", success: true, duration: 280, idle: 82000 },
    ],
  },
  {
    id: 5,
    name: "ML Model Training",
    repository: "demouser/ml-model",
    type: "Model",
    lastEdited: "2023-05-08T15:30:00Z",
    lastExecution: "2023-05-17T13:10:00Z",
    status: "success",
    successRate: 90,
    executionHistory: [
      { date: "2023-05-01", success: true, duration: 1200, idle: 86000 },
      { date: "2023-05-05", success: false, duration: 1300, idle: 85000 },
      { date: "2023-05-10", success: true, duration: 1100, idle: 84000 },
      { date: "2023-05-15", success: true, duration: 1000, idle: 83000 },
      { date: "2023-05-17", success: true, duration: 950, idle: 82000 },
    ],
  },
]

// Column definitions for sorting
type Column = {
  key: string;
  label: string;
  alwaysShow?: boolean;
  showOnMd?: boolean;
  showOnLg?: boolean;
};

const columns: Column[] = [
  { key: "name", label: "Package Name", alwaysShow: true },
  { key: "type", label: "Type", showOnMd: true },
  { key: "lastEdited", label: "Last Edited", showOnLg: true },
  { key: "lastExecution", label: "Last Execution", showOnMd: true },
  { key: "status", label: "Status", alwaysShow: true },
  { key: "successRate", label: "Success Rate", showOnMd: true },
  { key: "trends", label: "Trends", showOnLg: true },
  { key: "actions", label: "", alwaysShow: true },
]

export function PackagesTable({ searchQuery = "" }) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const [sortColumn, setSortColumn] = useState("name")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")

  // Handle sorting
  const handleSort = (columnKey: string) => {
    if (sortColumn === columnKey) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortColumn(columnKey)
      setSortDirection("asc")
    }
  }

  // Filter and sort packages
  const filteredAndSortedPackages = useMemo(() => {
    return [...mockPackages]
      .filter(
        (pkg) =>
          pkg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          pkg.repository.toLowerCase().includes(searchQuery.toLowerCase()) ||
          pkg.type.toLowerCase().includes(searchQuery.toLowerCase()),
      )
      .sort((a, b) => {
        const aValue = a[sortColumn as keyof typeof a]
        const bValue = b[sortColumn as keyof typeof b]

        if (typeof aValue === "string" && typeof bValue === "string") {
          return sortDirection === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue)
        }

        if (typeof aValue === "number" && typeof bValue === "number") {
          return sortDirection === "asc" ? aValue - bValue : bValue - aValue
        }

        return 0
      })
  }, [searchQuery, sortColumn, sortDirection])

  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(date)
  }

  // Toggle row expansion
  const toggleRowExpansion = (packageId: number) => {
    setExpandedRow(expandedRow === packageId ? null : packageId)
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) =>
              column.alwaysShow || (column.showOnMd && column.showOnLg) ? (
                <TableHead
                  key={column.key}
                  className={`${column.key !== "actions" ? "cursor-pointer" : ""}
                     ${column.showOnMd && !column.alwaysShow ? "hidden md:table-cell" : ""}
                     ${column.showOnLg && !column.alwaysShow && !column.showOnMd ? "hidden lg:table-cell" : ""}`}
                  onClick={() => column.key !== "actions" && handleSort(column.key)}
                >
                  <div className="flex items-center">
                    {column.label}
                    {sortColumn === column.key && <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>}
                  </div>
                </TableHead>
              ) : null,
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredAndSortedPackages.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                No packages found.
              </TableCell>
            </TableRow>
          ) : (
            filteredAndSortedPackages.map((pkg) => (
              <>
                <TableRow key={pkg.id} className="hover:bg-muted/50">
                  <TableCell>
                    <div className="font-medium">{pkg.name}</div>
                    <div className="text-sm text-muted-foreground">{pkg.repository}</div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant="outline" className="flex items-center gap-1">
                      <Package className="h-3 w-3" />
                      {pkg.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <div className="flex items-center gap-1">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      <span>{formatDate(pkg.lastEdited)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span>{formatDate(pkg.lastExecution)}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        pkg.status === "success"
                          ? "success"
                          : pkg.status === "failed"
                            ? "destructive"
                            : "default"
                      }
                    >
                      {pkg.status === "success" ? "Success" : pkg.status === "failed" ? "Failed" : "Running"}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex items-center gap-1">
                      <span
                        className={
                          pkg.successRate >= 90
                            ? "text-green-600"
                            : pkg.successRate >= 75
                              ? "text-amber-600"
                              : "text-red-600"
                        }
                      >
                        {pkg.successRate}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <PackageSparkline data={pkg.executionHistory} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link href={`/dashboard/packages/${pkg.id}`}>
                        <Button variant="ghost" size="icon" title="View Package">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button variant="ghost" size="icon" title="Build Package">
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => toggleRowExpansion(pkg.id)}>
                        {expandedRow === pkg.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedRow === pkg.id && (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="p-4">
                      <PackageDetailCharts />
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
