"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Search,
  Shield,
  AlertCircle,
  Calendar,
  Package,
  ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

// Advisory interface
interface Advisory {
  id: string
  title: string
  description: string
  severity: string
  cvssScore: number
  status: string
  affectedImage: string
  affectedComponent: string
  fixedInVersion: string | null
  publishedDate: string
  updatedDate: string
  fixedDate: string | null
  references: string[]
}

// Mock data for advisories
const advisories: Advisory[] = [
  {
    id: "CVE-2023-1234",
    title: "Container Escape Vulnerability in Dagger",
    description:
      "A vulnerability in the container runtime could allow an attacker to escape the container and access the host system.",
    severity: "Critical",
    cvssScore: 9.8,
    status: "Fixed",
    affectedImage: "dagger",
    affectedComponent: "container-runtime",
    fixedInVersion: "0.8.1",
    publishedDate: "2023-03-15",
    updatedDate: "2023-03-20",
    fixedDate: "2023-03-22",
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2023-1234",
      "https://github.com/dagger/dagger/security/advisories/GHSA-abcd-1234-efgh",
    ],
  },
  {
    id: "CVE-2023-5678",
    title: "Authentication Bypass in Linkerd",
    description:
      "A vulnerability in the authentication mechanism could allow unauthorized access to protected resources.",
    severity: "High",
    cvssScore: 8.5,
    status: "Fixed",
    affectedImage: "linkerd",
    affectedComponent: "auth-service",
    fixedInVersion: "2.12.3",
    publishedDate: "2023-04-10",
    updatedDate: "2023-04-12",
    fixedDate: "2023-04-15",
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2023-5678",
      "https://github.com/linkerd/linkerd2/security/advisories/GHSA-wxyz-7890-mnop",
    ],
  },
  {
    id: "CVE-2023-9012",
    title: "Information Disclosure in code-server",
    description: "A vulnerability in the API could expose sensitive information about the environment configuration.",
    severity: "Medium",
    cvssScore: 6.5,
    status: "Fixed",
    affectedImage: "code-server",
    affectedComponent: "api-server",
    fixedInVersion: "4.11.1",
    publishedDate: "2023-05-05",
    updatedDate: "2023-05-07",
    fixedDate: "2023-05-10",
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2023-9012",
      "https://github.com/coder/code-server/security/advisories/GHSA-qrst-5678-uvwx",
    ],
  },
  {
    id: "CVE-2023-3456",
    title: "Path Traversal in Dagger",
    description:
      "A vulnerability in the file path handling could allow an attacker to access files outside the project directory.",
    severity: "High",
    cvssScore: 7.8,
    status: "Fixed",
    affectedImage: "dagger",
    affectedComponent: "file-system",
    fixedInVersion: "0.8.0",
    publishedDate: "2023-06-20",
    updatedDate: "2023-06-22",
    fixedDate: "2023-06-25",
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2023-3456",
      "https://github.com/dagger/dagger/security/advisories/GHSA-efgh-5678-ijkl",
    ],
  },
  {
    id: "CVE-2023-7890",
    title: "Denial of Service in Linkerd",
    description:
      "A vulnerability in the proxy component could allow an attacker to cause a denial of service condition.",
    severity: "Medium",
    cvssScore: 5.9,
    status: "In Progress",
    affectedImage: "linkerd",
    affectedComponent: "proxy",
    fixedInVersion: null,
    publishedDate: "2023-07-15",
    updatedDate: "2023-07-18",
    fixedDate: null,
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2023-7890",
      "https://github.com/linkerd/linkerd2/security/advisories/GHSA-mnop-1234-qrst",
    ],
  },
  {
    id: "CVE-2023-1213",
    title: "Cross-Site Scripting in code-server",
    description: "A vulnerability in the web interface could allow an attacker to inject malicious scripts.",
    severity: "Medium",
    cvssScore: 6.1,
    status: "Fixed",
    affectedImage: "code-server",
    affectedComponent: "web-ui",
    fixedInVersion: "4.10.1",
    publishedDate: "2023-02-10",
    updatedDate: "2023-02-12",
    fixedDate: "2023-02-15",
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2023-1213",
      "https://github.com/coder/code-server/security/advisories/GHSA-uvwx-9012-yzab",
    ],
  },
  {
    id: "CVE-2023-4567",
    title: "Remote Code Execution in Dagger",
    description: "A vulnerability in the script execution could allow remote code execution during the build process.",
    severity: "Critical",
    cvssScore: 9.5,
    status: "Under Investigation",
    affectedImage: "dagger",
    affectedComponent: "script-executor",
    fixedInVersion: null,
    publishedDate: "2023-08-05",
    updatedDate: "2023-08-07",
    fixedDate: null,
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2023-4567",
      "https://github.com/dagger/dagger/security/advisories/GHSA-ijkl-9012-mnop",
    ],
  },
  {
    id: "CVE-2023-8901",
    title: "Privilege Escalation in Linkerd",
    description: "A vulnerability in the role-based access control system could allow privilege escalation.",
    severity: "High",
    cvssScore: 8.2,
    status: "Fixed",
    affectedImage: "linkerd",
    affectedComponent: "rbac",
    fixedInVersion: "2.12.2",
    publishedDate: "2023-01-20",
    updatedDate: "2023-01-22",
    fixedDate: "2023-01-25",
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2023-8901",
      "https://github.com/linkerd/linkerd2/security/advisories/GHSA-qrst-5678-uvwx",
    ],
  },
  {
    id: "CVE-2023-1415",
    title: "Sensitive Information Exposure in code-server",
    description: "A vulnerability in the logging mechanism could expose sensitive information in log files.",
    severity: "Low",
    cvssScore: 3.5,
    status: "Fixed",
    affectedImage: "code-server",
    affectedComponent: "logger",
    fixedInVersion: "4.9.1",
    publishedDate: "2023-09-10",
    updatedDate: "2023-09-12",
    fixedDate: "2023-09-15",
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2023-1415",
      "https://github.com/coder/code-server/security/advisories/GHSA-yzab-1234-cdef",
    ],
  },
  {
    id: "CVE-2023-2425",
    title: "SQL Injection in Dagger",
    description: "A vulnerability in the database query handling could allow SQL injection attacks.",
    severity: "High",
    cvssScore: 7.5,
    status: "Not Affected",
    affectedImage: "dagger",
    affectedComponent: "database",
    fixedInVersion: null,
    publishedDate: "2023-10-05",
    updatedDate: "2023-10-07",
    fixedDate: null,
    references: [
      "https://nvd.nist.gov/vuln/detail/CVE-2023-2425",
      "https://github.com/dagger/dagger/security/advisories/GHSA-cdef-5678-ghij",
    ],
  },
]

// Helper function to get severity color
function getSeverityColor(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return "bg-red-500 hover:bg-red-600"
    case "high":
      return "bg-orange-500 hover:bg-orange-600"
    case "medium":
      return "bg-yellow-500 hover:bg-yellow-600"
    case "low":
      return "bg-blue-500 hover:bg-blue-600"
    default:
      return "bg-gray-500 hover:bg-gray-600"
  }
}

// Helper function to get status color and icon
function getStatusInfo(status: string) {
  switch (status.toLowerCase()) {
    case "fixed":
      return {
        color: "bg-green-100 text-green-800 hover:bg-green-200",
        icon: <CheckCircle2 className="h-4 w-4 text-green-600" />,
      }
    case "in progress":
      return {
        color: "bg-blue-100 text-blue-800 hover:bg-blue-200",
        icon: <Clock className="h-4 w-4 text-blue-600" />,
      }
    case "under investigation":
      return {
        color: "bg-yellow-100 text-yellow-800 hover:bg-yellow-200",
        icon: <AlertCircle className="h-4 w-4 text-yellow-600" />,
      }
    case "not affected":
      return {
        color: "bg-gray-100 text-gray-800 hover:bg-gray-200",
        icon: <Shield className="h-4 w-4 text-gray-600" />,
      }
    default:
      return {
        color: "bg-gray-100 text-gray-800 hover:bg-gray-200",
        icon: <AlertTriangle className="h-4 w-4 text-gray-600" />,
      }
  }
}

// Helper function to format date
function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

export default function AdvisoriesPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [selectedAdvisory, setSelectedAdvisory] = useState<Advisory | null>(null)

  // Get unique images for filter
  const uniqueImages = Array.from(new Set(advisories.map((adv) => adv.affectedImage)))

  // Filter advisories based on search and filters
  const filteredAdvisories = advisories.filter((advisory) => {
    const matchesSearch =
      searchQuery === "" ||
      advisory.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      advisory.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      advisory.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      advisory.affectedComponent.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesSeverity =
      selectedSeverity === null || advisory.severity.toLowerCase() === selectedSeverity.toLowerCase()
    const matchesStatus = selectedStatus === null || advisory.status.toLowerCase() === selectedStatus.toLowerCase()
    const matchesImage = selectedImage === null || advisory.affectedImage.toLowerCase() === selectedImage.toLowerCase()

    return matchesSearch && matchesSeverity && matchesStatus && matchesImage
  })

  // Calculate statistics
  const totalAdvisories = advisories.length
  const fixedAdvisories = advisories.filter((adv) => adv.status.toLowerCase() === "fixed").length
  const criticalAdvisories = advisories.filter((adv) => adv.severity.toLowerCase() === "critical").length
  const highAdvisories = advisories.filter((adv) => adv.severity.toLowerCase() === "high").length

  // Reset all filters
  const resetFilters = () => {
    setSearchQuery("")
    setSelectedSeverity(null)
    setSelectedStatus(null)
    setSelectedImage(null)
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex flex-col space-y-8">
        {/* Header */}
        <div className="flex flex-col space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Security Advisories</h1>
          <p className="text-muted-foreground">
            Track and manage CVE advisories for your organization&apos;s container images and dependencies.
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm font-medium">Total Advisories</span>
            </div>
            <div className="mt-2">
              <p className="text-2xl font-bold">{totalAdvisories}</p>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-500" />
              <span className="text-sm font-medium">Fixed</span>
            </div>
            <div className="mt-2">
              <p className="text-2xl font-bold">{fixedAdvisories}</p>
              <p className="text-xs text-muted-foreground">
                {Math.round((fixedAdvisories / totalAdvisories) * 100)}% of total
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              <span className="text-sm font-medium">Critical</span>
            </div>
            <div className="mt-2">
              <p className="text-2xl font-bold">{criticalAdvisories}</p>
              <p className="text-xs text-muted-foreground">
                {Math.round((criticalAdvisories / totalAdvisories) * 100)}% of total
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <span className="text-sm font-medium">High</span>
            </div>
            <div className="mt-2">
              <p className="text-2xl font-bold">{highAdvisories}</p>
              <p className="text-xs text-muted-foreground">
                {Math.round((highAdvisories / totalAdvisories) * 100)}% of total
              </p>
            </div>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
          <div className="flex w-full max-w-sm items-center space-x-2">
            <Input
              placeholder="Search advisories..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
              type="search"
            />
            <Button variant="outline" size="icon" onClick={() => setSearchQuery("")}>
              <Search className="h-4 w-4" />
              <span className="sr-only">Search</span>
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedSeverity || "all"}
              onValueChange={(value) => setSelectedSeverity(value === "all" ? null : value)}
            >
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={selectedStatus || "all"}
              onValueChange={(value) => setSelectedStatus(value === "all" ? null : value)}
            >
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="in progress">In Progress</SelectItem>
                <SelectItem value="under investigation">Under Investigation</SelectItem>
                <SelectItem value="not affected">Not Affected</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={selectedImage || "all"}
              onValueChange={(value) => setSelectedImage(value === "all" ? null : value)}
            >
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Image" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Images</SelectItem>
                {uniqueImages.map((image) => (
                  <SelectItem key={image} value={image}>
                    {image}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button variant="ghost" onClick={resetFilters} className="h-9 px-2 lg:px-3">
              Reset
            </Button>

            <Button variant="outline" className="ml-auto">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </div>

        {/* Applied Filters */}
        {(selectedSeverity || selectedStatus || selectedImage || searchQuery) && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Filters:</span>

            {searchQuery && (
              <Badge variant="outline" className="flex items-center gap-1">
                Search: {searchQuery}
                <button onClick={() => setSearchQuery("")} className="ml-1 rounded-full hover:bg-muted">
                  <span className="sr-only">Remove</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </Badge>
            )}

            {selectedSeverity && (
              <Badge variant="outline" className="flex items-center gap-1">
                Severity: {selectedSeverity}
                <button onClick={() => setSelectedSeverity(null)} className="ml-1 rounded-full hover:bg-muted">
                  <span className="sr-only">Remove</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </Badge>
            )}

            {selectedStatus && (
              <Badge variant="outline" className="flex items-center gap-1">
                Status: {selectedStatus}
                <button onClick={() => setSelectedStatus(null)} className="ml-1 rounded-full hover:bg-muted">
                  <span className="sr-only">Remove</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </Badge>
            )}

            {selectedImage && (
              <Badge variant="outline" className="flex items-center gap-1">
                Image: {selectedImage}
                <button onClick={() => setSelectedImage(null)} className="ml-1 rounded-full hover:bg-muted">
                  <span className="sr-only">Remove</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3 w-3"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </Badge>
            )}

            <Button variant="ghost" size="sm" onClick={resetFilters} className="h-7 px-2 text-xs">
              Clear all
            </Button>
          </div>
        )}

        {/* Advisories Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px]">CVE ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="w-[100px]">Severity</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead className="w-[120px]">Image</TableHead>
                <TableHead className="w-[120px]">Component</TableHead>
                <TableHead className="w-[120px]">Published</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAdvisories.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    No advisories found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredAdvisories.map((advisory) => (
                  <TableRow key={advisory.id}>
                    <TableCell className="font-mono text-xs">{advisory.id}</TableCell>
                    <TableCell>{advisory.title}</TableCell>
                    <TableCell>
                      <Badge className={`${getSeverityColor(advisory.severity)} text-white`}>{advisory.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {getStatusInfo(advisory.status).icon}
                        <Badge variant="outline" className={getStatusInfo(advisory.status).color}>
                          {advisory.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/dashboard/images/${advisory.affectedImage}`}
                        className="text-blue-600 hover:underline"
                      >
                        {advisory.affectedImage}
                      </Link>
                    </TableCell>
                    <TableCell>{advisory.affectedComponent}</TableCell>
                    <TableCell>{formatDate(advisory.publishedDate)}</TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="sm" onClick={() => setSelectedAdvisory(advisory)}>
                            Details
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl">
                          <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                              <span className="font-mono text-sm">{advisory.id}</span>
                              <Separator orientation="vertical" className="h-4" />
                              <span>{advisory.title}</span>
                            </DialogTitle>
                            <DialogDescription>Detailed information about this security advisory</DialogDescription>
                          </DialogHeader>

                          {selectedAdvisory && (
                            <div className="mt-4 space-y-6">
                              <div className="grid gap-4 md:grid-cols-3">
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-muted-foreground">Severity</p>
                                  <div className="flex items-center gap-2">
                                    <Badge className={`${getSeverityColor(selectedAdvisory.severity)} text-white`}>
                                      {selectedAdvisory.severity}
                                    </Badge>
                                    <span className="text-sm">CVSS: {selectedAdvisory.cvssScore}</span>
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                                  <div className="flex items-center gap-1">
                                    {getStatusInfo(selectedAdvisory.status).icon}
                                    <Badge variant="outline" className={getStatusInfo(selectedAdvisory.status).color}>
                                      {selectedAdvisory.status}
                                    </Badge>
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-muted-foreground">Fixed Version</p>
                                  <p className="text-sm">{selectedAdvisory.fixedInVersion || "Not yet fixed"}</p>
                                </div>
                              </div>

                              <Separator />

                              <div className="space-y-2">
                                <p className="text-sm font-medium text-muted-foreground">Description</p>
                                <p className="text-sm">{selectedAdvisory.description}</p>
                              </div>

                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <p className="text-sm font-medium text-muted-foreground">Affected Image</p>
                                  <div className="flex items-center gap-2">
                                    <Package className="h-4 w-4 text-muted-foreground" />
                                    <Link
                                      href={`/dashboard/images/${selectedAdvisory.affectedImage}`}
                                      className="text-sm text-blue-600 hover:underline"
                                    >
                                      {selectedAdvisory.affectedImage}
                                    </Link>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <p className="text-sm font-medium text-muted-foreground">Affected Component</p>
                                  <p className="text-sm">{selectedAdvisory.affectedComponent}</p>
                                </div>
                              </div>

                              <div className="grid gap-4 md:grid-cols-3">
                                <div className="space-y-2">
                                  <p className="text-sm font-medium text-muted-foreground">Published</p>
                                  <div className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-muted-foreground" />
                                    <p className="text-sm">{formatDate(selectedAdvisory.publishedDate)}</p>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <p className="text-sm font-medium text-muted-foreground">Updated</p>
                                  <div className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-muted-foreground" />
                                    <p className="text-sm">{formatDate(selectedAdvisory.updatedDate)}</p>
                                  </div>
                                </div>

                                <div className="space-y-2">
                                  <p className="text-sm font-medium text-muted-foreground">Fixed</p>
                                  <div className="flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-muted-foreground" />
                                    <p className="text-sm">
                                      {selectedAdvisory.fixedDate
                                        ? formatDate(selectedAdvisory.fixedDate)
                                        : "Not yet fixed"}
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <Separator />

                              <div className="space-y-2">
                                <p className="text-sm font-medium text-muted-foreground">References</p>
                                <ul className="space-y-1">
                                  {selectedAdvisory.references.map((ref: string, index: number) => (
                                    <li key={index} className="flex items-center gap-1">
                                      <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                      <a
                                        href={ref}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-sm text-blue-600 hover:underline"
                                      >
                                        {ref}
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              <div className="flex justify-end gap-2">
                                <Button variant="outline">View Remediation</Button>
                                <Button>Mark as Reviewed</Button>
                              </div>
                            </div>
                          )}
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing <strong>{filteredAdvisories.length}</strong> of <strong>{totalAdvisories}</strong> advisories
          </p>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
            <Button variant="outline" size="sm" className="px-4">
              1
            </Button>
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
