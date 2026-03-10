"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Package,
  Search,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Copy,
  Check,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import Navbar from "@/components/navbar"
import React from "react"

// Mock data types
interface PackageRelease {
  version: string
  release: string
  publishDate: string
  architecture: string
  size: string
  checksum: string
}

interface APKPackage {
  name: string
  description: string
  category: string
  latestVersion: string
  latestRelease: string
  releases: PackageRelease[]
  maintainer: string
  license: string
  homepage: string
}

// Sort options
type SortField = 'name' | 'version' | 'updated'
type SortOrder = 'asc' | 'desc'

// Mock data - using your naming convention
const mockPackages: APKPackage[] = [
  {
    name: "curl",
    description: "Command line tool and library for transferring data with URLs",
    category: "network",
    latestVersion: "8.4.0",
    latestRelease: "r5",
    maintainer: "SecureBuild Team",
    license: "MIT",
    homepage: "https://curl.se/",
    releases: [
      {
        version: "8.4.0",
        release: "r5",
        publishDate: "2024-01-15",
        architecture: "x86_64",
        size: "236 KB",
        checksum: "sha256:1234567890abcdef..."
      },
      {
        version: "8.4.0",
        release: "r4",
        publishDate: "2024-01-10",
        architecture: "x86_64",
        size: "236 KB",
        checksum: "sha256:abcdef1234567890..."
      }
    ]
  },
  {
    name: "nginx-1.25",
    description: "High performance web server and reverse proxy",
    category: "web",
    latestVersion: "1.25.3",
    latestRelease: "r3",
    maintainer: "SecureBuild Team",
    license: "BSD-2-Clause",
    homepage: "https://nginx.org/",
    releases: [
      {
        version: "1.25.3",
        release: "r3",
        publishDate: "2024-01-14",
        architecture: "x86_64",
        size: "1.2 MB",
        checksum: "sha256:9876543210fedcba..."
      },
      {
        version: "1.25.3",
        release: "r2",
        publishDate: "2024-01-08",
        architecture: "x86_64",
        size: "1.2 MB",
        checksum: "sha256:fedcba9876543210..."
      },
      {
        version: "1.25.2",
        release: "r1",
        publishDate: "2023-12-25",
        architecture: "x86_64",
        size: "1.1 MB",
        checksum: "sha256:3210fedcba987654..."
      }
    ]
  },
  {
    name: "nginx",
    description: "High performance web server and reverse proxy (latest)",
    category: "web",
    latestVersion: "1.25.3",
    latestRelease: "r3",
    maintainer: "SecureBuild Team",
    license: "BSD-2-Clause",
    homepage: "https://nginx.org/",
    releases: [
      {
        version: "1.25.3",
        release: "r3",
        publishDate: "2024-01-14",
        architecture: "x86_64",
        size: "1.2 MB",
        checksum: "sha256:9876543210fedcba..."
      }
    ]
  },
  {
    name: "python-3.12",
    description: "A high-level scripting language",
    category: "language",
    latestVersion: "3.12.1",
    latestRelease: "r7",
    maintainer: "SecureBuild Team",
    license: "PSF-2.0",
    homepage: "https://www.python.org/",
    releases: [
      {
        version: "3.12.1",
        release: "r7",
        publishDate: "2024-01-16",
        architecture: "x86_64",
        size: "45 MB",
        checksum: "sha256:abcdefghijklmnop..."
      },
      {
        version: "3.12.1",
        release: "r6",
        publishDate: "2024-01-12",
        architecture: "x86_64",
        size: "45 MB",
        checksum: "sha256:ponmlkjihgfedcba..."
      }
    ]
  },
  {
    name: "python3",
    description: "A high-level scripting language (latest)",
    category: "language",
    latestVersion: "3.12.1",
    latestRelease: "r7",
    maintainer: "SecureBuild Team",
    license: "PSF-2.0",
    homepage: "https://www.python.org/",
    releases: [
      {
        version: "3.12.1",
        release: "r7",
        publishDate: "2024-01-16",
        architecture: "x86_64",
        size: "45 MB",
        checksum: "sha256:abcdefghijklmnop..."
      }
    ]
  },
  {
    name: "postgresql-17",
    description: "The world's most advanced open source database",
    category: "database",
    latestVersion: "17.1",
    latestRelease: "r0",
    maintainer: "SecureBuild Team",
    license: "PostgreSQL",
    homepage: "https://www.postgresql.org/",
    releases: [
      {
        version: "17.1",
        release: "r0",
        publishDate: "2024-01-15",
        architecture: "x86_64",
        size: "8.8 MB",
        checksum: "sha256:pg17checksum..."
      }
    ]
  },
  {
    name: "postgresql-16",
    description: "The world's most advanced open source database",
    category: "database",
    latestVersion: "16.1",
    latestRelease: "r2",
    maintainer: "SecureBuild Team",
    license: "PostgreSQL",
    homepage: "https://www.postgresql.org/",
    releases: [
      {
        version: "16.1",
        release: "r2",
        publishDate: "2024-01-13",
        architecture: "x86_64",
        size: "8.7 MB",
        checksum: "sha256:qrstuvwxyzabcdef..."
      },
      {
        version: "16.1",
        release: "r1",
        publishDate: "2024-01-01",
        architecture: "x86_64",
        size: "8.7 MB",
        checksum: "sha256:fedcbaqrstuvwxyz..."
      }
    ]
  },
  {
    name: "git",
    description: "Distributed version control system",
    category: "development",
    latestVersion: "2.43.0",
    latestRelease: "r4",
    maintainer: "SecureBuild Team",
    license: "GPL-2.0",
    homepage: "https://git-scm.com/",
    releases: [
      {
        version: "2.43.0",
        release: "r4",
        publishDate: "2024-01-11",
        architecture: "x86_64",
        size: "5.2 MB",
        checksum: "sha256:zxcvbnmasdfghjkl..."
      }
    ]
  },
  {
    name: "redis-7.2",
    description: "In-memory data structure store",
    category: "database",
    latestVersion: "7.2.4",
    latestRelease: "r3",
    maintainer: "SecureBuild Team",
    license: "BSD-3-Clause",
    homepage: "https://redis.io/",
    releases: [
      {
        version: "7.2.4",
        release: "r3",
        publishDate: "2024-01-09",
        architecture: "x86_64",
        size: "2.3 MB",
        checksum: "sha256:lkjhgfdsaqwertyu..."
      },
      {
        version: "7.2.4",
        release: "r2",
        publishDate: "2024-01-03",
        architecture: "x86_64",
        size: "2.3 MB",
        checksum: "sha256:uytreqwasdfghjkl..."
      }
    ]
  },
  {
    name: "busybox",
    description: "Tiny versions of many common UNIX utilities",
    category: "system",
    latestVersion: "1.36.1",
    latestRelease: "r15",
    maintainer: "SecureBuild Team",
    license: "GPL-2.0",
    homepage: "https://busybox.net/",
    releases: [
      {
        version: "1.36.1",
        release: "r15",
        publishDate: "2024-01-14",
        architecture: "x86_64",
        size: "1.1 MB",
        checksum: "sha256:busybox15checksum..."
      }
    ]
  },
  {
    name: "openssl",
    description: "Cryptography and SSL/TLS toolkit",
    category: "security",
    latestVersion: "3.1.4",
    latestRelease: "r1",
    maintainer: "SecureBuild Team",
    license: "Apache-2.0",
    homepage: "https://www.openssl.org/",
    releases: [
      {
        version: "3.1.4",
        release: "r1",
        publishDate: "2024-01-12",
        architecture: "x86_64",
        size: "3.8 MB",
        checksum: "sha256:opensslchecksum..."
      }
    ]
  },
  {
    name: "zlib",
    description: "A Massively Spiffy Yet Delicately Unobtrusive Compression Library",
    category: "libraries",
    latestVersion: "1.3.1",
    latestRelease: "r0",
    maintainer: "SecureBuild Team",
    license: "Zlib",
    homepage: "https://zlib.net/",
    releases: [
      {
        version: "1.3.1",
        release: "r0",
        publishDate: "2024-01-10",
        architecture: "x86_64",
        size: "124 KB",
        checksum: "sha256:zlibchecksum..."
      }
    ]
  },
  {
    name: "bash",
    description: "The GNU Bourne Again shell",
    category: "system",
    latestVersion: "5.2.21",
    latestRelease: "r0",
    maintainer: "SecureBuild Team",
    license: "GPL-3.0",
    homepage: "https://www.gnu.org/software/bash/",
    releases: [
      {
        version: "5.2.21",
        release: "r0",
        publishDate: "2024-01-08",
        architecture: "x86_64",
        size: "1.4 MB",
        checksum: "sha256:bashchecksum..."
      }
    ]
  },
  // Adding more packages for pagination demo
  {
    name: "alpine-base",
    description: "Meta package for minimal Alpine Linux",
    category: "system",
    latestVersion: "3.19.0",
    latestRelease: "r0",
    maintainer: "SecureBuild Team",
    license: "MIT",
    homepage: "https://alpinelinux.org/",
    releases: [
      {
        version: "3.19.0",
        release: "r0",
        publishDate: "2024-01-07",
        architecture: "x86_64",
        size: "5 KB",
        checksum: "sha256:alpinebasechecksum..."
      }
    ]
  },
  {
    name: "nodejs-21",
    description: "JavaScript runtime built on Chrome's V8 JavaScript engine",
    category: "language",
    latestVersion: "21.6.0",
    latestRelease: "r0",
    maintainer: "SecureBuild Team",
    license: "MIT",
    homepage: "https://nodejs.org/",
    releases: [
      {
        version: "21.6.0",
        release: "r0",
        publishDate: "2024-01-06",
        architecture: "x86_64",
        size: "42 MB",
        checksum: "sha256:nodejschecksum..."
      }
    ]
  },
  {
    name: "nodejs-20",
    description: "JavaScript runtime built on Chrome's V8 JavaScript engine",
    category: "language",
    latestVersion: "20.11.0",
    latestRelease: "r1",
    maintainer: "SecureBuild Team",
    license: "MIT",
    homepage: "https://nodejs.org/",
    releases: [
      {
        version: "20.11.0",
        release: "r1",
        publishDate: "2024-01-06",
        architecture: "x86_64",
        size: "41 MB",
        checksum: "sha256:nodejs20checksum..."
      }
    ]
  },
  {
    name: "go-1.21",
    description: "The Go programming language",
    category: "language",
    latestVersion: "1.21.6",
    latestRelease: "r0",
    maintainer: "SecureBuild Team",
    license: "BSD-3-Clause",
    homepage: "https://go.dev/",
    releases: [
      {
        version: "1.21.6",
        release: "r0",
        publishDate: "2024-01-05",
        architecture: "x86_64",
        size: "125 MB",
        checksum: "sha256:gochecksum..."
      }
    ]
  },
  {
    name: "go",
    description: "The Go programming language (latest)",
    category: "language",
    latestVersion: "1.21.6",
    latestRelease: "r0",
    maintainer: "SecureBuild Team",
    license: "BSD-3-Clause",
    homepage: "https://go.dev/",
    releases: [
      {
        version: "1.21.6",
        release: "r0",
        publishDate: "2024-01-05",
        architecture: "x86_64",
        size: "125 MB",
        checksum: "sha256:gochecksum..."
      }
    ]
  },
  {
    name: "docker-cli",
    description: "Docker command-line interface",
    category: "tools",
    latestVersion: "24.0.7",
    latestRelease: "r1",
    maintainer: "SecureBuild Team",
    license: "Apache-2.0",
    homepage: "https://www.docker.com/",
    releases: [
      {
        version: "24.0.7",
        release: "r1",
        publishDate: "2024-01-04",
        architecture: "x86_64",
        size: "48 MB",
        checksum: "sha256:dockerchecksum..."
      }
    ]
  },
  {
    name: "vim",
    description: "Improved vi-style text editor",
    category: "editors",
    latestVersion: "9.1.0",
    latestRelease: "r0",
    maintainer: "SecureBuild Team",
    license: "Vim",
    homepage: "https://www.vim.org/",
    releases: [
      {
        version: "9.1.0",
        release: "r0",
        publishDate: "2024-01-03",
        architecture: "x86_64",
        size: "35 MB",
        checksum: "sha256:vimchecksum..."
      }
    ]
  }
]

export default function PackagesPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedPackage, setExpandedPackage] = useState<string | null>(null)
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set())

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)

  // Sort state
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  // Filter and sort packages
  const processedPackages = useMemo(() => {
    // First filter
    let filtered = mockPackages.filter(pkg => {
      const matchesSearch = searchQuery === "" ||
        pkg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pkg.description.toLowerCase().includes(searchQuery.toLowerCase())

      return matchesSearch
    })

    // Then sort
    filtered = [...filtered].sort((a, b) => {
      let comparison = 0

      switch (sortField) {
        case 'name':
          comparison = a.name.localeCompare(b.name)
          break
        case 'version':
          comparison = a.latestVersion.localeCompare(b.latestVersion, undefined, { numeric: true })
          break
        case 'updated':
          comparison = new Date(b.releases[0].publishDate).getTime() - new Date(a.releases[0].publishDate).getTime()
          break
      }

      return sortOrder === 'asc' ? comparison : -comparison
    })

    return filtered
  }, [searchQuery, sortField, sortOrder])

  // Paginate
  const paginatedPackages = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return processedPackages.slice(startIndex, startIndex + itemsPerPage)
  }, [processedPackages, currentPage, itemsPerPage])

  // Calculate total pages
  const totalPages = Math.ceil(processedPackages.length / itemsPerPage)

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery, sortField, sortOrder])

  // Reset expanded package when changing pages
  useEffect(() => {
    setExpandedPackage(null)
  }, [currentPage])

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('asc')
    }
  }

  // Get sort icon
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
    }
    return sortOrder === 'asc'
      ? <ArrowUp className="h-4 w-4" />
      : <ArrowDown className="h-4 w-4" />
  }

  // Toggle package expansion
  const togglePackage = (packageName: string) => {
    setExpandedPackage(expandedPackage === packageName ? null : packageName)
  }

  // Copy to clipboard function
  const copyToClipboard = async (text: string, itemId: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedItems(prev => new Set(prev).add(itemId))
      setTimeout(() => {
        setCopiedItems(prev => {
          const newSet = new Set(prev)
          newSet.delete(itemId)
          return newSet
        })
      }, 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Format date
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col">
        <Navbar />

        <main className="flex-1">
          {/* Compact Header with Search */}
          <section className="w-full py-6 bg-linear-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
            <div className="container mx-auto max-w-7xl px-4 md:px-8 lg:px-12">
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <h1 className="text-2xl font-bold tracking-tight">APK Package Catalog</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                      Search {mockPackages.length} secure packages for Alpine Linux
                    </p>
                  </div>
                  <Select value={itemsPerPage.toString()} onValueChange={(v) => setItemsPerPage(Number(v))}>
                    <SelectTrigger className="w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10 / page</SelectItem>
                      <SelectItem value="25">25 / page</SelectItem>
                      <SelectItem value="50">50 / page</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Prominent Search Bar */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search packages by name or description..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-12 text-base"
                    autoFocus
                  />
                  {searchQuery && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      {processedPackages.length} result{processedPackages.length !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Dense Package Table */}
          <section className="w-full py-6">
            <div className="container mx-auto max-w-7xl px-4 md:px-8 lg:px-12">
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50 dark:bg-gray-900">
                      <TableHead className="w-[250px]">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 -ml-3 font-semibold hover:bg-transparent"
                          onClick={() => handleSort('name')}
                        >
                          Package
                          {getSortIcon('name')}
                        </Button>
                      </TableHead>
                      <TableHead className="font-semibold">Description</TableHead>
                      <TableHead className="w-[140px]">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 -ml-3 font-semibold hover:bg-transparent"
                          onClick={() => handleSort('version')}
                        >
                          Version
                          {getSortIcon('version')}
                        </Button>
                      </TableHead>
                      <TableHead className="w-[140px]">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 -ml-3 font-semibold hover:bg-transparent"
                          onClick={() => handleSort('updated')}
                        >
                          Updated
                          {getSortIcon('updated')}
                        </Button>
                      </TableHead>
                      <TableHead className="w-[80px] text-center font-semibold">Copy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedPackages.map((pkg) => (
                      <React.Fragment key={pkg.name}>
                        <TableRow
                          className="hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer"
                          onClick={() => togglePackage(pkg.name)}
                        >
                          <TableCell className="font-mono font-medium">
                            <div className="flex items-center gap-2">
                              {expandedPackage === pkg.name ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                              {pkg.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-md truncate">
                            {pkg.description}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-xs">
                              {pkg.latestVersion}-{pkg.latestRelease}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(pkg.releases[0].publishDate)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      copyToClipboard(
                                        `apk add ${pkg.name}@${pkg.latestVersion}-${pkg.latestRelease}`,
                                        `${pkg.name}-copy`
                                      )
                                    }}
                                  >
                                    {copiedItems.has(`${pkg.name}-copy`) ? (
                                      <Check className="h-4 w-4 text-green-600" />
                                    ) : (
                                      <Copy className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Copy install command</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </TableCell>
                        </TableRow>

                        {/* Expanded Content */}
                        {expandedPackage === pkg.name && (
                          <TableRow>
                            <TableCell colSpan={5} className="bg-gray-50 dark:bg-gray-900 p-0">
                              <div className="p-4 space-y-4">
                                {/* Package Details */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                  <div>
                                    <span className="text-muted-foreground">License:</span>
                                    <span className="ml-2 font-medium">{pkg.license}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Architectures:</span>
                                    <span className="ml-2 font-medium">{pkg.releases[0].architecture}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Size:</span>
                                    <span className="ml-2 font-medium">{pkg.releases[0].size}</span>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">Maintainer:</span>
                                    <span className="ml-2 font-medium">{pkg.maintainer}</span>
                                  </div>
                                </div>

                                {/* Install Command */}
                                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                                  <div className="flex items-center justify-between">
                                    <code className="text-sm font-mono">
                                      apk add {pkg.name}@{pkg.latestVersion}-{pkg.latestRelease}
                                    </code>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => copyToClipboard(
                                        `apk add ${pkg.name}@${pkg.latestVersion}-${pkg.latestRelease}`,
                                        `${pkg.name}-install-expanded`
                                      )}
                                    >
                                      {copiedItems.has(`${pkg.name}-install-expanded`) ? (
                                        <Check className="h-4 w-4 text-green-600" />
                                      ) : (
                                        <Copy className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </div>
                                </div>

                                {/* Version History */}
                                {pkg.releases.length > 1 && (
                                  <div>
                                    <h4 className="text-sm font-semibold mb-2">Version History</h4>
                                    <div className="space-y-1">
                                      {pkg.releases.map((release, idx) => (
                                        <div key={`${release.version}-${release.release}`}
                                             className="flex items-center justify-between text-sm py-1">
                                          <div className="flex items-center gap-4">
                                            <span className="font-mono">
                                              {release.version}-{release.release}
                                            </span>
                                            {idx === 0 && (
                                              <Badge variant="default" className="text-xs">Latest</Badge>
                                            )}
                                            <span className="text-muted-foreground">
                                              {formatDate(release.publishDate)}
                                            </span>
                                            <span className="text-muted-foreground">
                                              {release.architecture}
                                            </span>
                                          </div>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 px-2"
                                            onClick={() => copyToClipboard(
                                              `apk add ${pkg.name}@${release.version}-${release.release}`,
                                              `${pkg.name}-${release.version}-${release.release}-expanded`
                                            )}
                                          >
                                            {copiedItems.has(`${pkg.name}-${release.version}-${release.release}-expanded`) ? (
                                              <Check className="h-3 w-3 text-green-600" />
                                            ) : (
                                              <Copy className="h-3 w-3" />
                                            )}
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>

                {processedPackages.length === 0 && (
                  <div className="text-center py-12">
                    <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No packages found</h3>
                    <p className="text-sm text-muted-foreground">
                      Try adjusting your search
                    </p>
                  </div>
                )}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, processedPackages.length)} of {processedPackages.length} packages
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>

                    {/* Page numbers */}
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum
                        if (totalPages <= 5) {
                          pageNum = i + 1
                        } else if (currentPage <= 3) {
                          pageNum = i + 1
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i
                        } else {
                          pageNum = currentPage - 2 + i
                        }

                        return (
                          <Button
                            key={i}
                            variant={currentPage === pageNum ? "default" : "outline"}
                            size="sm"
                            className="w-8 h-8 p-0"
                            onClick={() => setCurrentPage(pageNum)}
                          >
                            {pageNum}
                          </Button>
                        )
                      })}
                      {totalPages > 5 && currentPage < totalPages - 2 && (
                        <>
                          <span className="px-1">...</span>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-8 h-8 p-0"
                            onClick={() => setCurrentPage(totalPages)}
                          >
                            {totalPages}
                          </Button>
                        </>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Quick Help */}
              <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <h3 className="text-sm font-semibold mb-2">Quick Start</h3>
                <div className="grid md:grid-cols-2 gap-4 text-sm text-muted-foreground">
                  <div>
                    <p className="mb-1">Add to your Dockerfile:</p>
                    <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs">
                      RUN apk add --no-cache package@version-release
                    </code>
                  </div>
                  <div>
                    <p className="mb-1">Add SecureBuild repository:</p>
                    <code className="bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs">
                      RUN echo &quot;https://packages.securebuild.dev/alpine/v3.19/main&quot; &gt;&gt; /etc/apk/repositories
                    </code>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </TooltipProvider>
  )
}
