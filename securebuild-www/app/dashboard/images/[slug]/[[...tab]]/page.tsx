"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import Image from "next/image"
import { useParams } from "next/navigation"
import {
  Tag,
  Clock,
  ArrowLeft,
  Copy,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Package,
  Lock,
  ExternalLink,
  Cpu,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  Shield,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import Editor from '@monaco-editor/react'

import { useSession } from "@/app/hooks/use-session"
import { Image as SBImage } from "@/lib/types/image"
import { getImageByNameAction } from "@/lib/image/actions/get-image-by-name"
import { getSbomAction } from "@/lib/image/actions/get-sbom"
import { getScanResultsAction } from "@/lib/image/actions/get-scan-results"
import { listTeamSubscriptionsAction } from "@/lib/team/actions/list-subscriptions"
import { Subscription } from "@/lib/types/subscription"

// Type definitions for vulnerability matches
interface VulnerabilityMatch {
  vulnerability: {
    id: string;
    severity: string;
    description: string;
    dataSource?: string;
    namespace?: string;
    urls?: string[];
    fix?: {
      state?: string;
    };
    cvss?: Array<{
      metrics?: {
        baseScore?: number;
      };
      vector?: string;
    }>;
  };
  artifact?: {
    name: string;
    version: string;
  };
}

// Type definitions for SBOM packages
interface SbomPackage {
  SPDXID: string;
  name: string;
  versionInfo: string;
  licenseDeclared: string;
  supplier?: string;
  originator?: string;
  vulnerabilities: number;
}
import { renderLicenseLinks, renderLicenseSummaryBadge } from "@/lib/utils/license-utils"


export default function RepositoryDetailPage() {
  const params = useParams()
  const slug = params.slug as string
  const tabParam = params.tab as string[] | undefined
  const [selectedTag, setSelectedTag] = useState("latest")
  const [selectedArchitecture, setSelectedArchitecture] = useState("x86_64")
  const { session } = useSession();
  const [image, setImage] = useState<SBImage | null>(null)
  const [sbom, setSbom] = useState<Record<string, unknown> | null>(null)
  const [parsedSbom, setParsedSbom] = useState<Record<string, unknown> | null>(null)
  const [parsedScanResultsSecurebuild, setParsedScanResultsSecurebuild] = useState<Record<string, unknown> | null>({})
  const [parsedScanResultsAlternate, setParsedScanResultsAlternate] = useState<Record<string, unknown> | null>({})
  const [showRawSbom, setShowRawSbom] = useState(false)
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [copied, setCopied] = useState(false)

  // SBOM table sorting state
  const [sortColumn, setSortColumn] = useState<string>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  // Check if user has access to this image
  const hasImageAccess = subscriptions.some((sub) => sub.catalogItem?.id === image?.catalogItem?.id);

  // Pull command for display and copying
  const pullCommand = image ? `docker pull cve0.io/${image.name}:${selectedTag}` : '';

  // Copy function for pull command
  const handleCopy = async () => {
    if (!pullCommand) return;
    
    try {
      await navigator.clipboard.writeText(pullCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  // Sorting functions for SBOM table
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const getSortedPackages = (packages: Record<string, unknown>[]) => {
    if (!packages) return []

    // Filter for APK packages only and exclude SHA256/YAML files
    const filtered = packages.filter((pkg: Record<string, unknown>) => {
      if (typeof pkg.name !== 'string') return false;
      if (pkg.name.includes("sha256") || pkg.name.includes(".yaml")) return false;
      
      // Check externalRefs with proper type guards
      const externalRefs = pkg.externalRefs;
      if (!Array.isArray(externalRefs) || externalRefs.length === 0) return false;
      
      const firstRef = externalRefs[0];
      if (!firstRef || typeof firstRef !== 'object') return false;
      
      const referenceLocator = (firstRef as Record<string, unknown>).referenceLocator;
      return typeof referenceLocator === 'string' && referenceLocator.includes("pkg:apk");
    })

    return [...filtered].sort((a, b) => {
      let aValue = ''
      let bValue = ''

      switch (sortColumn) {
        case 'name':
          aValue = (typeof a.name === 'string' ? a.name.toLowerCase() : '')
          bValue = (typeof b.name === 'string' ? b.name.toLowerCase() : '')
          break
        case 'version':
          aValue = (typeof a.versionInfo === 'string' ? a.versionInfo.toLowerCase() : '')
          bValue = (typeof b.versionInfo === 'string' ? b.versionInfo.toLowerCase() : '')
          break
        case 'license':
          const aLicense = typeof a.licenseDeclared === 'string' && a.licenseDeclared !== "NOASSERTION" ? a.licenseDeclared : ''
          const bLicense = typeof b.licenseDeclared === 'string' && b.licenseDeclared !== "NOASSERTION" ? b.licenseDeclared : ''
          aValue = aLicense.toLowerCase()
          bValue = bLicense.toLowerCase()
          break
        case 'supplier':
          const aSupplier = typeof a.supplier === 'string' ? a.supplier.replace("Organization: ", "") : 
                           (typeof a.originator === 'string' ? a.originator.replace("Organization: ", "") : "Unknown")
          const bSupplier = typeof b.supplier === 'string' ? b.supplier.replace("Organization: ", "") : 
                           (typeof b.originator === 'string' ? b.originator.replace("Organization: ", "") : "Unknown")
          aValue = aSupplier.toLowerCase()
          bValue = bSupplier.toLowerCase()
          break
        default:
          return 0
      }

      if (sortDirection === 'asc') {
        return aValue.localeCompare(bValue)
      } else {
        return bValue.localeCompare(aValue)
      }
    })
  }

  const getSortIcon = (column: string) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-4 w-4" />
    }
    return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />
  }

  // Determine current tab from URL route parameters
  const getCurrentTab = useCallback(() => {
    // tabParam will be undefined for /dashboard/images/[slug] (tags default)
    // tabParam will be ['security'] for /dashboard/images/[slug]/security
    const tab = tabParam?.[0]
    if (tab && ['security', 'sbom'].includes(tab)) {
      return tab
    }
    return 'tags' // default
  }, [tabParam])

  const [currentTab, setCurrentTab] = useState(getCurrentTab())
  const [isClientNavigation, setIsClientNavigation] = useState(false)

  // Handle tab changes
  const handleTabChange = (value: string) => {
    setIsClientNavigation(true) // Mark as client-side navigation
    setCurrentTab(value)
    const basePath = `/dashboard/images/${slug}`
    const newPath = value === 'tags' ? basePath : `${basePath}/${value}`

    // Update URL without page reload using browser History API
    window.history.pushState(null, '', newPath)
  }

  // Update current tab when route params change (only for initial load or page refresh)
  useEffect(() => {
    if (!isClientNavigation) {
      setCurrentTab(getCurrentTab())
    }
  }, [tabParam, isClientNavigation, getCurrentTab])

  // Set initial tab state on component mount
  useEffect(() => {
    setCurrentTab(getCurrentTab())
    setIsClientNavigation(false) // Ensure we start with route-based navigation
  }, []) // Only run on mount

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      setIsClientNavigation(false) // Reset client navigation flag
      // Extract tab from current URL path
      const currentPath = window.location.pathname
      const pathSegments = currentPath.split('/')
      const lastSegment = pathSegments[pathSegments.length - 1]

      if (['security', 'sbom'].includes(lastSegment)) {
        setCurrentTab(lastSegment)
      } else {
        setCurrentTab('tags')
      }
    }

    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  useEffect(() => {
    if (!session) {
      return;
    }

    const fetchSbom = async () => {
      const sbom = await getSbomAction(session, slug, selectedTag, selectedArchitecture);
      setSbom(sbom);
    }

    fetchSbom();

  }, [session, slug, selectedTag, selectedArchitecture])

  useEffect(() => {
    if (!session) {
      return;
    }

    const fetchImage = async () => {
      const image = await getImageByNameAction(session, slug);
      setImage(image);
      setSelectedTag(image.defaultTag);
    }

    fetchImage();
  }, [session, slug]);

  useEffect(() => {
    if (!session) {
      return;
    }

    const fetchSubscriptions = async () => {
      const subs = await listTeamSubscriptionsAction(session);
      setSubscriptions(subs);
    }

    fetchSubscriptions();
  }, [session]);

  // Fetch scan results
  useEffect(() => {
    if (!session) {
      return;
    }

    const fetchScanResults = async () => {
      const scanResults = await getScanResultsAction(session, slug, selectedTag, selectedArchitecture);

      // Handle empty or invalid scan results
      if (scanResults.secureBuild && scanResults.secureBuild.trim()) {
        try {
          const parsed = JSON.parse(scanResults.secureBuild);
          // remove anything that the ID doesn't start with "CVE-"
          parsed.matches = parsed.matches.filter((match: Record<string, unknown>) => 
            (match.vulnerability as Record<string, unknown>)?.id?.toString().startsWith("CVE-")
          );
          setParsedScanResultsSecurebuild(parsed);
        } catch (error) {
          console.warn("Failed to parse secureBuild scan results:", error);
          setParsedScanResultsSecurebuild({ matches: [] });
        }
      } else {
        setParsedScanResultsSecurebuild({ matches: [] });
      }

      if (scanResults.alternate && scanResults.alternate.trim()) {
        try {
          setParsedScanResultsAlternate(JSON.parse(scanResults.alternate));
        } catch (error) {
          console.warn("Failed to parse alternate scan results:", error);
          setParsedScanResultsAlternate({});
        }
      } else {
        setParsedScanResultsAlternate({});
      }
    }

    fetchScanResults();

  }, [session, slug, selectedTag, selectedArchitecture])

  // Parse SBOM data when it changes
  useEffect(() => {
    if (sbom) {
      try {
        // If sbom is a string, parse it
        const parsed = typeof sbom === 'string' ? JSON.parse(sbom) : sbom;
        setParsedSbom(parsed);
      } catch (error) {
        console.error('Error parsing SBOM:', error);
        setParsedSbom(null);
      }
    } else {
      setParsedSbom(null);
    }
  }, [sbom]);


  // Reset raw SBOM view when tab changes
  useEffect(() => {
    setShowRawSbom(false);
  }, [currentTab]);

  // Parse scan results to get vulnerability counts by severity
  const getVulnCounts = () => {
    if (!parsedScanResultsSecurebuild || !parsedScanResultsSecurebuild.matches || !Array.isArray(parsedScanResultsSecurebuild.matches)) {
      return { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
    }

    const counts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };

    parsedScanResultsSecurebuild.matches.forEach((match: Record<string, unknown>) => {
      const severity = ((match.vulnerability as Record<string, unknown>)?.severity as string)?.toLowerCase();
      switch (severity) {
        case 'critical':
          counts.critical++;
          break;
        case 'high':
          counts.high++;
          break;
        case 'medium':
          counts.medium++;
          break;
        case 'low':
          counts.low++;
          break;
      }
      counts.total++;
    });

    return counts;
  };

  const vulnCounts = getVulnCounts();

  // Get fixed vulnerabilities (alternate scan results excluding those still present in current scan)
  const getFixedVulnerabilities = () => {
    if (!parsedScanResultsAlternate?.matches || !Array.isArray(parsedScanResultsAlternate.matches)) {
      return [];
    }

    if (!parsedScanResultsSecurebuild?.matches || !Array.isArray(parsedScanResultsSecurebuild.matches)) {
      return parsedScanResultsAlternate.matches;
    }

    // Create a set of current vulnerability keys (CVE ID + package name)
    const currentVulnKeys = new Set(
      parsedScanResultsSecurebuild.matches.map((match: Record<string, unknown>) =>
        `${((match.vulnerability as Record<string, unknown>)?.id as string)}:${((match.artifact as Record<string, unknown>)?.name as string)}`
      )
    );

    // Filter alternate results to exclude vulnerabilities that are still present
    // (same CVE ID AND same package)
    return parsedScanResultsAlternate.matches.filter((match: Record<string, unknown>) => {
      const vulnKey = `${((match.vulnerability as Record<string, unknown>)?.id as string)}:${((match.artifact as Record<string, unknown>)?.name as string)}`;
      return !currentVulnKeys.has(vulnKey);
    });
  };

  const fixedVulnerabilities = getFixedVulnerabilities();

  // If repository data is not loaded yet, show loading state
  if (!image) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          <div className="h-6 w-48 bg-gray-200 animate-pulse rounded"></div>
          <div className="h-24 bg-gray-200 animate-pulse rounded"></div>
          <div className="h-12 bg-gray-200 animate-pulse rounded"></div>
          <div className="h-64 bg-gray-200 animate-pulse rounded"></div>
        </div>
      </div>
    )
  }

  // Get severity color
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "Critical":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
      case "High":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300"
      case "Medium":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
      case "Low":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300"
    }
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        {/* Breadcrumb and back button */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Button variant="ghost" size="sm" asChild className="gap-1 p-0 h-auto">
            <Link href="/dashboard/images">
              <ArrowLeft className="h-4 w-4" />
              Back to Images
            </Link>
          </Button>
          <span>/</span>
          <span>Images</span>
          <span>/</span>
          <span className="text-foreground font-medium">{slug}</span>
        </div>

        {/* Repository Header */}
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="shrink-0 w-16 h-16 md:w-24 md:h-24 bg-white dark:bg-gray-800 rounded-lg shadow-sm flex items-center justify-center p-2">
            <Image
              src={image.catalogItem?.imageUrl || "/placeholder.svg?height=80&width=80&query=project%20logo"}
              width={80}
              height={80}
              alt={`${image.catalogItem?.name} logo`}
              className="object-contain"
            />
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h1 className="text-2xl font-bold">{image.catalogItem?.name}</h1>
              {image.catalogItem?.isPartner && (
                <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300 font-semibold">
                  ✓ Official Partner
                </Badge>
              )}
              {hasImageAccess && (
                <Badge className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Subscribed
                </Badge>
              )}
            </div>
            <div className="mb-4">
              {image.catalogItem?.isPartner ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground">{image.catalogItem?.description}</p>
                  <p className="text-sm leading-relaxed">
                    <span className="inline-flex items-baseline gap-1 font-medium text-teal-700 dark:text-teal-300">
                      <Package className="h-4 w-4" />
                      Official Partner Image:
                    </span>
                    {" "}This image is created in partnership with the {image.catalogItem?.name} maintainers, ensuring enterprise-grade security with direct upstream support.
                  </p>
                </div>
              ) : (
                <p className="text-muted-foreground">{image.catalogItem?.description}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-1">
                <Tag className="h-4 w-4 text-muted-foreground" />
                <span>{image.tags.length} tags</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span>
                  {image.catalogItem?.lastBuiltAt
                    ? `Built ${new Date(image.catalogItem.lastBuiltAt).toLocaleString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}`
                    : "Build date unavailable"}
                </span>
              </div>
              {image.catalogItem?.lastScannedAt && (
                <div className="flex items-center gap-1">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span>
                    Scanned {new Date(image.catalogItem.lastScannedAt).toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                <span>{fixedVulnerabilities.length} vulnerabilities fixed</span>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 w-full md:w-auto">

          </div>
        </div>

        {/* Security Score Card */}
        <Card className="bg-linear-to-r from-teal-50 to-blue-50 dark:from-teal-900/30 dark:to-blue-900/30 border-teal-100 dark:border-teal-800">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className={`flex-1 grid grid-cols-2 gap-4 ${image.catalogItem?.isPartner ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
                <div className="flex flex-col items-center p-3 bg-white dark:bg-gray-800 rounded-lg">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300 mb-2">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-medium">{image.vulnerabilitiesFixed} Vulnerabilities Fixed</span>
                </div>
                <div className="flex flex-col items-center p-3 bg-white dark:bg-gray-800 rounded-lg">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300 mb-2">
                    <FileText className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-medium">SBOM Available</span>
                </div>
                <div className="flex flex-col items-center p-3 bg-white dark:bg-gray-800 rounded-lg">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300 mb-2">
                    <Lock className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-medium">Signature Verified</span>
                </div>
                {image.catalogItem?.isPartner && (
                  <div className="flex flex-col items-center p-3 bg-white dark:bg-gray-800 rounded-lg">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300 mb-2">
                      <Package className="h-5 w-5" />
                    </div>
                    <span className="text-sm font-medium">Official Partnership</span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pull Command or Subscribe */}
        {hasImageAccess ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pull Command</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3 flex items-center">
                <code className="text-sm text-muted-foreground flex-1 font-mono">
                  {pullCommand}
                </code>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-linear-to-r from-blue-50 to-teal-50 dark:from-blue-900/30 dark:to-teal-900/30 border-blue-100 dark:border-blue-800 shadow-md">
            <CardContent className="py-8 flex flex-col items-center justify-center text-center gap-4">
              <div className="flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 mb-2">
                <Lock className="h-8 w-8 text-blue-600 dark:text-blue-300" />
              </div>
              <h2 className="text-xl font-bold">Pull Access Restricted</h2>
              <p className="text-muted-foreground text-base max-w-md">Subscribe to unlock access and pull this image from our secure registry. Enjoy up-to-date, verified, and secure container images for your projects.</p>
              <Link href={`/checkout/${slug}`} className="w-full sm:w-auto">
                <Button variant="default" size="lg" className="w-full sm:w-auto transition-transform hover:scale-105">Subscribe to {image?.catalogItem?.name}</Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Main Tabs */}
        <Tabs defaultValue="tags" className="w-full" value={currentTab} onValueChange={handleTabChange}>
          <div className="flex justify-between items-center">
            <TabsList className="grid grid-cols-3 md:w-[400px]">
              <TabsTrigger value="tags">Tags</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="sbom">SBOM</TabsTrigger>
            </TabsList>

            {/* Tag and Architecture dropdowns - show on all tabs except tags */}
            {currentTab !== 'tags' && (
              <div className="flex gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="justify-start min-w-[200px]">
                      <Tag className="mr-2 h-4 w-4" />
                      Tag: {selectedTag}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[200px]">
                    {image.tags.map((tag) => (
                      <DropdownMenuItem key={tag} onClick={() => setSelectedTag(tag)}>
                        {tag}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="justify-start min-w-[160px]">
                      <Cpu className="mr-2 h-4 w-4" />
                      Arch: {selectedArchitecture}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[160px]">
                    <DropdownMenuItem onClick={() => setSelectedArchitecture("x86_64")}>
                      x86_64
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedArchitecture("arm64")}>
                      arm64
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {/* Tags Tab */}
          <TabsContent value="tags" className="space-y-4">

            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tag</TableHead>
                    <TableHead>Last Built</TableHead>
                    <TableHead>Vulnerabilities</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {image.tags.map((tag) => (
                    <TableRow key={tag} className={"bg-muted/50"}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          {tag}
                        </div>
                      </TableCell>
                      <TableCell>{new Date(image.lastBuiltAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}</TableCell>
                      <TableCell>
                        {image.tags.length === 0 ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300">

                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300">
                            {image.vulnerabilitiesFixed} vulnerabilities fixed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant={tag === selectedTag ? "default" : "outline"}
                          size="sm"
                          onClick={() => setSelectedTag(tag)}
                        >
                          {tag === selectedTag ? "Selected" : "Select"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security" className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Vulnerability Summary</CardTitle>
                  <CardDescription>
                    {vulnCounts.total === 0
                      ? "No vulnerabilities found"
                      : `${vulnCounts.total} vulnerabilities found`
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Critical</span>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={vulnCounts.total > 0 ? (vulnCounts.critical / vulnCounts.total) * 100 : 0}
                          max={100}
                          className="h-2 w-40"
                        />
                        <span className="text-sm font-medium min-w-[20px]">{vulnCounts.critical}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">High</span>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={vulnCounts.total > 0 ? (vulnCounts.high / vulnCounts.total) * 100 : 0}
                          max={100}
                          className="h-2 w-40"
                        />
                        <span className="text-sm font-medium min-w-[20px]">{vulnCounts.high}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Medium</span>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={vulnCounts.total > 0 ? (vulnCounts.medium / vulnCounts.total) * 100 : 0}
                          max={100}
                          className="h-2 w-40"
                        />
                        <span className="text-sm font-medium min-w-[20px]">{vulnCounts.medium}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Low</span>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={vulnCounts.total > 0 ? (vulnCounts.low / vulnCounts.total) * 100 : 0}
                          max={100}
                          className="h-2 w-40"
                        />
                        <span className="text-sm font-medium min-w-[20px]">{vulnCounts.low}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

            </div>

            {/* Current Vulnerabilities Table */}
            {(() => {
              if (!parsedScanResultsSecurebuild || !parsedScanResultsSecurebuild.matches || !Array.isArray(parsedScanResultsSecurebuild.matches) || parsedScanResultsSecurebuild.matches.length === 0) {
                return null;
              }
              return (
              <Card>
                <CardHeader>
                  <CardTitle>Current Vulnerabilities</CardTitle>
                  <CardDescription>Vulnerabilities found in the current image version</CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>CVE ID</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Package</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(parsedScanResultsSecurebuild.matches as VulnerabilityMatch[]).map((match: VulnerabilityMatch, index: number) => (
                        <TableRow key={`current-${match.vulnerability.id}-${match.artifact?.name}-${index}`}>
                          <TableCell className="font-medium">{match.vulnerability.id}</TableCell>
                          <TableCell>
                            <Badge className={getSeverityColor(match.vulnerability.severity)}>
                              {match.vulnerability.severity}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-xs truncate">{match.vulnerability.description}</TableCell>
                          <TableCell>{match.artifact?.name}</TableCell>
                          <TableCell>{match.artifact?.version}</TableCell>
                          <TableCell className="text-right">
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  Details
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                  <DialogTitle>
                                    {match.vulnerability.id}
                                  </DialogTitle>
                                  <DialogDescription>
                                    <Badge className={`${getSeverityColor(match.vulnerability.severity)} mt-2`}>
                                      {match.vulnerability.severity}
                                    </Badge>
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4">
                                  <div>
                                    <h4 className="text-sm font-medium mb-1">Description</h4>
                                    <p className="text-sm text-muted-foreground">{match.vulnerability.description}</p>
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div>
                                      <h4 className="text-sm font-medium mb-1">Package</h4>
                                      <p className="text-sm">{match.artifact?.name}</p>
                                    </div>
                                    <div>
                                      <h4 className="text-sm font-medium mb-1">Version</h4>
                                      <p className="text-sm">{match.artifact?.version}</p>
                                    </div>
                                    <div>
                                      <h4 className="text-sm font-medium mb-1">Data Source</h4>
                                      <p className="text-sm">{match.vulnerability.dataSource}</p>
                                    </div>
                                    <div>
                                      <h4 className="text-sm font-medium mb-1">Namespace</h4>
                                      <p className="text-sm">{match.vulnerability.namespace}</p>
                                    </div>
                                  </div>
                                  {match.vulnerability.cvss && match.vulnerability.cvss.length > 0 && (
                                    <div>
                                      <h4 className="text-sm font-medium mb-1">CVSS Score</h4>
                                      <p className="text-sm">
                                        {match.vulnerability.cvss[0]?.metrics?.baseScore}
                                        ({match.vulnerability.cvss[0]?.vector})
                                      </p>
                                    </div>
                                  )}
                                  {match.vulnerability.urls && match.vulnerability.urls.length > 0 && (
                                    <div>
                                      <h4 className="text-sm font-medium mb-1">References</h4>
                                      <div className="space-y-1">
                                        {match.vulnerability.urls.slice(0, 3).map((url: string, urlIndex: number) => (
                                          <div key={urlIndex}>
                                            <Button variant="outline" size="sm" className="gap-1 h-8" asChild>
                                              <Link href={url} target="_blank" className="text-xs">
                                                {new URL(url).hostname}
                                                <ExternalLink className="h-3 w-3" />
                                              </Link>
                                            </Button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div>
                                    <h4 className="text-sm font-medium mb-1">Fix Status</h4>
                                    <p className="text-sm text-muted-foreground">
                                      {match.vulnerability.fix?.state || "No fix available"}
                                    </p>
                                  </div>
                                </div>
                              </DialogContent>
                            </Dialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              );
            })()}

            <Card>
              <CardHeader>
                <CardTitle>Vulnerabilities Fixed in This Build</CardTitle>
                <CardDescription>These vulnerabilities were present in the upstream image but fixed in SecureBuild's version when this image was built.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CVE ID</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Package</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fixedVulnerabilities.map((match: VulnerabilityMatch, index: number) => (
                      <TableRow key={`fixed-${match.vulnerability.id}-${match.artifact?.name}-${index}`}>
                        <TableCell className="font-medium">{match.vulnerability.id}</TableCell>
                        <TableCell>
                          <Badge className={getSeverityColor(match.vulnerability.severity)}>
                            {match.vulnerability.severity}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">{match.vulnerability.description}</TableCell>
                        <TableCell>{match.artifact?.name}</TableCell>
                        <TableCell>{match.artifact?.version}</TableCell>
                        <TableCell className="text-right">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="sm">
                                Details
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>
                                  {match.vulnerability.id}
                                </DialogTitle>
                                <DialogDescription>
                                  <Badge className={`${getSeverityColor(match.vulnerability.severity)} mt-2`}>
                                    {match.vulnerability.severity}
                                  </Badge>
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div>
                                  <h4 className="text-sm font-medium mb-1">Description</h4>
                                  <p className="text-sm text-muted-foreground">{match.vulnerability.description}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                  <div>
                                    <h4 className="text-sm font-medium mb-1">Package</h4>
                                    <p className="text-sm">{match.artifact?.name}</p>
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-medium mb-1">Version</h4>
                                    <p className="text-sm">{match.artifact?.version}</p>
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-medium mb-1">Data Source</h4>
                                    <p className="text-sm">{match.vulnerability.dataSource}</p>
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-medium mb-1">Namespace</h4>
                                    <p className="text-sm">{match.vulnerability.namespace}</p>
                                  </div>
                                </div>
                                {match.vulnerability.cvss && match.vulnerability.cvss.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-medium mb-1">CVSS Score</h4>
                                    <p className="text-sm">
                                      {match.vulnerability.cvss[0]?.metrics?.baseScore}
                                      ({match.vulnerability.cvss[0]?.vector})
                                    </p>
                                  </div>
                                )}
                                {match.vulnerability.urls && match.vulnerability.urls.length > 0 && (
                                  <div>
                                    <h4 className="text-sm font-medium mb-1">References</h4>
                                    <div className="space-y-1">
                                      {match.vulnerability.urls.slice(0, 3).map((url: string, urlIndex: number) => (
                                        <div key={urlIndex}>
                                          <Button variant="outline" size="sm" className="gap-1 h-8" asChild>
                                            <Link href={url} target="_blank" className="text-xs">
                                              {new URL(url).hostname}
                                              <ExternalLink className="h-3 w-3" />
                                            </Link>
                                          </Button>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <h4 className="text-sm font-medium mb-1">Fix Status</h4>
                                  <Badge className="bg-green-100 text-green-800">Fixed</Badge>
                                  <p className="text-sm text-muted-foreground mt-1">
                                    This vulnerability has been fixed in the current version.
                                  </p>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SBOM Tab */}
          <TabsContent value="sbom" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>SBOM Summary</CardTitle>
                <CardDescription>
                  Software Bill of Materials for {image.name}:{selectedTag}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {parsedSbom ? (
                  <div className="space-y-6">
                    {/* SBOM Name - Full Width */}
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">SBOM Name</h4>
                      <p className="text-sm break-all font-mono bg-gray-50 dark:bg-gray-800 px-4 py-3 rounded-lg border" title={typeof parsedSbom.name === 'string' ? parsedSbom.name : undefined}>
                        {typeof parsedSbom.name === 'string' ? parsedSbom.name : 'Unknown SBOM Name'}
                      </p>
                    </div>

                    {/* Main SBOM Info - 4 Column Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">Format</h4>
                        <p className="text-sm font-medium">SPDX {typeof parsedSbom.spdxVersion === 'string' ? parsedSbom.spdxVersion : 'Unknown'}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">Components</h4>
                        <p className="text-sm font-medium">{Array.isArray(parsedSbom.packages) ? parsedSbom.packages.length : 0}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">Created</h4>
                        <p className="text-sm font-medium">
                          {(parsedSbom.creationInfo && 
                            typeof parsedSbom.creationInfo === 'object' && 
                            'created' in parsedSbom.creationInfo && 
                            typeof parsedSbom.creationInfo.created === 'string') ? 
                            new Date(parsedSbom.creationInfo.created).toLocaleDateString() : 'N/A'}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-2">Data License</h4>
                        <p className="text-sm font-medium">{typeof parsedSbom.dataLicense === 'string' ? parsedSbom.dataLicense : 'Unknown'}</p>
                      </div>
                    </div>

                    {/* Creators and Licenses - 2 Column Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-3">Creators</h4>
                        <div className="flex flex-wrap gap-2">
                          {(parsedSbom.creationInfo && 
                            typeof parsedSbom.creationInfo === 'object' && 
                            'creators' in parsedSbom.creationInfo &&
                            Array.isArray(parsedSbom.creationInfo.creators) && 
                            parsedSbom.creationInfo.creators.length > 0) ? 
                            parsedSbom.creationInfo.creators.map((creator: string, index: number) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {creator}
                            </Badge>
                          )) : (
                            <span className="text-sm text-muted-foreground">No creators specified</span>
                          )}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-sm font-medium text-muted-foreground mb-3">License Types ({Array.isArray(parsedSbom.packages) ? [...new Set(parsedSbom.packages.map((pkg: SbomPackage) => pkg.licenseDeclared).filter((license: string) => license && license !== "NOASSERTION"))].length : 0})</h4>
                        <div className="flex flex-wrap gap-2">
                          {Array.isArray(parsedSbom.packages) ? [...new Set(parsedSbom.packages.map((pkg: SbomPackage) => pkg.licenseDeclared).filter((license: string) => license && license !== "NOASSERTION"))]
                            .slice(0, 12)
                            .map((license: unknown, index: number) => renderLicenseSummaryBadge(license as string, index)) : null}
                          {Array.isArray(parsedSbom.packages) && [...new Set(parsedSbom.packages.map((pkg: SbomPackage) => pkg.licenseDeclared).filter((license: string) => license && license !== "NOASSERTION"))].length > 12 && (
                            <Badge variant="outline" className="text-xs">
                              +{[...new Set(parsedSbom.packages.map((pkg: SbomPackage) => pkg.licenseDeclared).filter((license: string) => license && license !== "NOASSERTION"))].length - 12} more
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">Loading SBOM data...</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>SBOM Components</CardTitle>
                    <CardDescription>Components included in the Software Bill of Materials</CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowRawSbom(!showRawSbom)}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    {showRawSbom ? "View Table" : "View Raw SBOM"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {showRawSbom ? (
                    <div className="border rounded-lg overflow-hidden">
                      <Editor
                        height="600px"
                        defaultLanguage="json"
                        value={parsedSbom ? JSON.stringify(parsedSbom, null, 2) : ''}
                        options={{
                          readOnly: true,
                          minimap: { enabled: false },
                          wordWrap: 'on',
                          lineNumbers: 'on',
                          folding: true,
                          scrollBeyondLastLine: false,
                          automaticLayout: true,
                        }}
                        theme="vs-dark"
                      />
                    </div>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <Button
                                variant="ghost"
                                onClick={() => handleSort('name')}
                                className="h-auto p-0 font-medium hover:bg-transparent justify-start"
                              >
                                Name
                                {getSortIcon('name')}
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                onClick={() => handleSort('version')}
                                className="h-auto p-0 font-medium hover:bg-transparent justify-start"
                              >
                                Version
                                {getSortIcon('version')}
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                onClick={() => handleSort('license')}
                                className="h-auto p-0 font-medium hover:bg-transparent justify-start"
                              >
                                License
                                {getSortIcon('license')}
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                onClick={() => handleSort('supplier')}
                                className="h-auto p-0 font-medium hover:bg-transparent justify-start"
                              >
                                Supplier
                                {getSortIcon('supplier')}
                              </Button>
                            </TableHead>
                            <TableHead>
                              <Button
                                variant="ghost"
                                onClick={() => handleSort('vulnerabilities')}
                                className="h-auto p-0 font-medium hover:bg-transparent justify-start"
                              >
                                Vulnerabilities
                                {getSortIcon('vulnerabilities')}
                              </Button>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(getSortedPackages(Array.isArray(parsedSbom?.packages) ? parsedSbom.packages : []) as unknown as SbomPackage[]).map((pkg: SbomPackage) => (
                            <TableRow key={pkg.SPDXID}>
                              <TableCell className="font-medium">{pkg.name}</TableCell>
                              <TableCell>{pkg.versionInfo}</TableCell>
                              <TableCell>
                                {renderLicenseLinks(pkg.licenseDeclared)}
                              </TableCell>
                              <TableCell>
                                {pkg.supplier?.replace("Organization: ", "") || pkg.originator?.replace("Organization: ", "") || "Unknown"}
                              </TableCell>
                              <TableCell>
                                {pkg.vulnerabilities === 0 ? (
                                  <Badge className="bg-green-100 text-green-800">No vulnerabilities</Badge>
                                ) : (
                                  <Badge className="bg-red-100 text-red-800">{pkg.vulnerabilities} vulnerabilities</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          )) || []}
                          {(!parsedSbom?.packages || !Array.isArray(parsedSbom.packages) || parsedSbom.packages.length === 0) && (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                                No SBOM components available
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>

                      <div className="flex justify-center">
                        <Button variant="outline">View All Components</Button>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
