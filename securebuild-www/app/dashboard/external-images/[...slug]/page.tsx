"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Download,
  Hash,
  Bug,
  Package,
  Eye,
  Copy,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { useSession } from "@/app/hooks/use-session"
import { getExternalImageSbomAction } from "@/lib/externalimage/actions/get-external-image-sbom"
import { getExternalImageScanAction } from "@/lib/externalimage/actions/get-external-image-scan"
import { getExternalImageAction } from "@/lib/externalimage/actions/get-external-image"
import { TrackedExternalImage } from "@/lib/types/externalimage"
import { listCatalogItemsAction } from "@/lib/catalog/actions/list-catalog-items"
import { CatalogMatchBannerWithVulnCounts } from "../components/CatalogMatchBannerWithVulnCounts"
import { triggerRescanAction, getScanStatusAction, ScanStatusResult } from "@/lib/externalimage/actions/trigger-rescan"
import { ScanStatusEntry } from "@/lib/externalimage/externalimage"
import { toast } from "@/hooks/use-toast"

interface SBOMComponent {
  name: string
  version: string
  type: string
  license: string
  supplier?: string
  description?: string
}

interface Vulnerability {
  cve: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  description: string;
}

export default function ExternalImageDetailPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { session } = useSession()
  const [showRawSBOM, setShowRawSBOM] = useState(false)
  // Initialize selectedTag from URL query param, fallback to "latest"
  const [selectedTag, setSelectedTag] = useState(searchParams.get('tag') || "latest")
  const [selectedArch, setSelectedArch] = useState("amd64")
  const [sbomData, setSbomData] = useState<string | null>(null)
  const [sbomComponents, setSbomComponents] = useState<SBOMComponent[]>([])
  const [sbomLoading, setSbomLoading] = useState(false)
  const [sbomError, setSbomError] = useState<string | null>(null)
  const [numCriticalVulnerabilities, setNumCriticalVulnerabilities] = useState<number | null>(null)
  const [numHighVulnerabilities, setNumHighVulnerabilities] = useState<number | null>(null)
  const [numMediumVulnerabilities, setNumMediumVulnerabilities] = useState<number | null>(null)
  const [numLowVulnerabilities, setNumLowVulnerabilities] = useState<number | null>(null)
  const [rawVulnerabilities, setRawVulnerabilities] = useState<Vulnerability[]>([])
  const [vulnLoading, setVulnLoading] = useState(false)
  const [vulnError, setVulnError] = useState<string | null>(null)
  const [externalImageData, setExternalImageData] = useState<TrackedExternalImage | null>(null)
  // Add severity filter state
  const [selectedSeverity, setSelectedSeverity] = useState<string>("all")
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 10

  // Pagination state for SBOM
  const [sbomCurrentPage, setSbomCurrentPage] = useState(1)
  const sbomPageSize = 10

  // Flexible catalog match state
  interface CatalogImage {
    id: string;
    name: string;
    catalogSlug: string;
  }
  const [matchingCatalogImages, setMatchingCatalogImages] = useState<CatalogImage[]>([])

  // Rescan state
  const [rescanLoading, setRescanLoading] = useState(false)
  const [scanStatus, setScanStatus] = useState<ScanStatusEntry[]>([])
  const [scanStatusLoading, setScanStatusLoading] = useState(false)
  const [scanAttemptedAt, setScanAttemptedAt] = useState<Date | null>(null)

  // Copy feedback state
  const [showCopied, setShowCopied] = useState(false)
  const [showTagDigestCopied, setShowTagDigestCopied] = useState(false)

  // Helper function to safely access tag completion status
  const getTagCompletionStatus = useCallback((tag: string) => {
    if (!externalImageData?.tagCompletionStatus || 
        typeof externalImageData.tagCompletionStatus !== 'object' ||
        !(tag in externalImageData.tagCompletionStatus)) {
      return null
    }
    return (externalImageData.tagCompletionStatus as Record<string, unknown>)[tag]
  }, [externalImageData?.tagCompletionStatus])

  // Helper function to infer component type from package information
  const inferComponentType = useCallback((pkg: Record<string, unknown>): string => {
    const name = (typeof pkg.name === 'string' ? pkg.name : '').toLowerCase()
    const fileName = (typeof pkg.fileName === 'string' ? pkg.fileName : '').toLowerCase()
    const downloadLocation = (typeof pkg.downloadLocation === 'string' ? pkg.downloadLocation : '').toLowerCase()

    // Check for explicit type information
    if (typeof pkg.primaryPurpose === 'string') return pkg.primaryPurpose
    if (typeof pkg.packageType === 'string') return pkg.packageType
    if (typeof pkg.type === 'string') return pkg.type

    // Check external references for package manager hints
    if (pkg.externalRefs && Array.isArray(pkg.externalRefs)) {
      for (const ref of pkg.externalRefs) {
        if (typeof ref !== 'object' || ref === null) continue
        const refObj = ref as Record<string, unknown>
        const locator = (typeof refObj.referenceLocator === 'string' ? refObj.referenceLocator : '').toLowerCase()
        if (locator.includes('pkg:apk')) return 'application'
        if (locator.includes('pkg:npm')) return 'library'
        if (locator.includes('pkg:pypi')) return 'library'
        if (locator.includes('pkg:maven')) return 'library'
        if (locator.includes('pkg:nuget')) return 'library'
        if (locator.includes('pkg:cargo')) return 'library'
        if (locator.includes('pkg:gem')) return 'library'
        if (locator.includes('pkg:go')) return 'library'
        if (locator.includes('pkg:deb')) return 'application'
        if (locator.includes('pkg:rpm')) return 'application'
        if (locator.includes('pkg:docker')) return 'container'
        if (locator.includes('pkg:oci')) return 'container'
      }
    }

    // Infer from name patterns
    if (name.includes('kernel') || name.includes('linux-') || name.includes('glibc') || name.includes('musl')) {
      return 'operating-system'
    }
    if (name.includes('lib') || name.includes('shared') || name.includes('static')) {
      return 'library'
    }
    if (name.includes('tool') || name.includes('util') || name.includes('bin')) {
      return 'application'
    }
    if (name.includes('framework') || name.includes('runtime')) {
      return 'framework'
    }
    if (name.includes('driver') || name.includes('firmware')) {
      return 'device'
    }
    if (name.includes('config') || name.includes('conf') || name.includes('settings')) {
      return 'file'
    }
    if (name.includes('doc') || name.includes('man') || name.includes('help')) {
      return 'documentation'
    }
    if (name.includes('test') || name.includes('spec') || name.includes('mock')) {
      return 'test'
    }
    if (name.includes('data') || name.includes('asset') || name.includes('resource')) {
      return 'data'
    }

    // Check file extensions if available
    if (fileName) {
      if (fileName.endsWith('.so') || fileName.endsWith('.dylib') || fileName.endsWith('.dll')) {
        return 'library'
      }
      if (fileName.endsWith('.jar') || fileName.endsWith('.war') || fileName.endsWith('.ear')) {
        return 'application'
      }
      if (fileName.endsWith('.deb') || fileName.endsWith('.rpm') || fileName.endsWith('.pkg')) {
        return 'application'
      }
    }

    // Check download location patterns
    if (downloadLocation) {
      if (downloadLocation.includes('archive') || downloadLocation.includes('tar.gz') || downloadLocation.includes('zip')) {
        return 'archive'
      }
      if (downloadLocation.includes('registry') || downloadLocation.includes('repository')) {
        return 'library'
      }
    }

    // Default fallback - still use library but now it's more intentional
    return 'library'
  }, [])

  // Helper function to parse SBOM and extract components
  const parseSBOMComponents = useCallback((sbomJson: string): SBOMComponent[] => {
    try {
      const sbom = JSON.parse(sbomJson)

      // Handle different SBOM formats (SPDX, CycloneDX, etc.)
      if (sbom.packages && Array.isArray(sbom.packages)) {
        // SPDX format
        return sbom.packages.map((pkg: Record<string, unknown>) => ({
          name: pkg.name || 'Unknown',
          version: pkg.versionInfo || pkg.version || 'Unknown',
          type: inferComponentType(pkg),
          license: pkg.licenseConcluded || pkg.licenseDeclared || 'Unknown',
          supplier: pkg.supplier && typeof pkg.supplier === 'string' ? pkg.supplier.replace('Organization: ', '') : undefined,
          description: pkg.description || pkg.summary || undefined
        }))
      } else if (sbom.components && Array.isArray(sbom.components)) {
        // CycloneDX format
        return sbom.components.map((comp: Record<string, unknown>) => ({
          name: comp.name || 'Unknown',
          version: comp.version || 'Unknown',
          type: comp.type || inferComponentType(comp),
          license: 'Unknown',
          supplier: (comp.supplier && typeof comp.supplier === 'object' && 'name' in comp.supplier ? comp.supplier.name : comp.publisher) || undefined,
          description: comp.description || undefined
        }))
      }

      return []
    } catch (error) {
      console.error("Failed to parse SBOM:", error)
      return []
    }
  }, [inferComponentType])

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-100 text-red-800 border-red-200"
      case "high":
        return "bg-orange-100 text-orange-800 border-orange-200"
      case "medium":
        return "bg-yellow-100 text-yellow-800 border-yellow-200"
      case "low":
        return "bg-blue-100 text-blue-800 border-blue-200"
      default:
        return "bg-gray-100 text-gray-800 border-gray-200"
    }
  }

  // Define a mapping for criticality levels to sort order
  const criticalityOrder: Record<Vulnerability["severity"], number> = {
    'critical': 1,
    'high': 2,
    'medium': 3,
    'low': 4,
    'info': 5
  };

  // Sort the rawVulnerabilities array by criticality (create a new array to avoid mutating state)
  const sortedVulnerabilities = [...rawVulnerabilities].sort((a, b) => {
    // Convert to lowercase to handle case variations
    const severityA = a.severity?.toLowerCase() || 'unknown';
    const severityB = b.severity?.toLowerCase() || 'unknown';

    const orderA = criticalityOrder[severityA as Vulnerability["severity"]] || 999; // Default to 999 if severity not found
    const orderB = criticalityOrder[severityB as Vulnerability["severity"]] || 999;
    return orderA - orderB;
  });

  // Filter vulnerabilities by selected severity
  const filteredVulnerabilities = selectedSeverity === "all"
    ? sortedVulnerabilities
    : sortedVulnerabilities.filter(vuln => vuln.severity.toLowerCase() === selectedSeverity)

  // Filter out library types from SBOM components
  const filteredSbomComponents = sbomComponents.filter(component => component.type !== 'library');

  // Pagination logic for vulnerabilities
  const totalPages = Math.ceil(filteredVulnerabilities.length / pageSize)
  const pagedVulnerabilities = filteredVulnerabilities.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  // Pagination logic for SBOM
  const sbomTotalPages = Math.ceil(filteredSbomComponents.length / sbomPageSize)
  const pagedSbomComponents = filteredSbomComponents.slice((sbomCurrentPage - 1) * sbomPageSize, sbomCurrentPage * sbomPageSize)

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1)
  }, [selectedSeverity])

  // Reset SBOM page when SBOM data changes
  useEffect(() => {
    setSbomCurrentPage(1)
  }, [filteredSbomComponents.length])

  // Track previous completion states to detect changes
  const prevScanComplete = useRef<boolean | undefined>(undefined)
  const prevSbomComplete = useRef<boolean | undefined>(undefined)

  // Mock data for available architectures
  const availableArchitectures = ["amd64", "arm64"]

  // Get available tags from external image data, fallback to default if not available
  const availableTags = externalImageData?.imageTags || ["latest"]

  // Reconstruct the full image name from the slug
  const imageName = Array.isArray(params.slug) ? params.slug.join('/') : params.slug || ''
  const decodedImageName = imageName

  // Mock data for the specific image - update counts to match mock vulnerabilities
  const mockImageData = {
    url: `${decodedImageName}:${selectedTag}`,
    name: decodedImageName.split("/").pop() || decodedImageName,
    digest: "sha256:4c0fdaa8b6341bfdeca5f18f7837462c80cff90527ee35ef185571e1c327beac",
    lastScanned: "2024-01-15T10:30:00Z",
    scanStatus: "complete" as const,
    vulnerabilities: {
      critical: 1,
      high: 1,
      medium: 3,
      low: 0,
    },
    sbomGenerated: true,
    hasCredentials: true,
    addedAt: "2024-01-10T14:20:00Z",
    size: 256789123,
    architecture: selectedArch,
    os: "linux",
  }

  // Load SBOM data when component mounts or when tag/arch changes
  useEffect(() => {
    const tagStatus = getTagCompletionStatus(selectedTag)
    if (!session || !tagStatus || typeof tagStatus !== 'object' || !(tagStatus as Record<string, unknown>).isSbomComplete) {
      return
    }

    const loadSBOMData = async () => {
      setSbomLoading(true)
      setSbomError(null)

      try {
        // Call action with separate parameters
        const result = await getExternalImageSbomAction(session, decodedImageName, selectedTag, selectedArch)

        if (typeof result === 'string') {
          setSbomData(result)
          // Parse SBOM to extract components
          const components = parseSBOMComponents(result)
          setSbomComponents(components)
        } else if (result && typeof result === 'object' && 'error' in result) {
          setSbomError(result.error)
          setSbomData(null)
          setSbomComponents([])
        } else {
          setSbomData(null)
          setSbomComponents([])
        }
      } catch (error) {
        console.error("Failed to load SBOM data:", error)
        setSbomError("Failed to load SBOM data")
        setSbomData(null)
        setSbomComponents([])
      } finally {
        setSbomLoading(false)
      }
    }

    loadSBOMData()
  }, [session, decodedImageName, selectedTag, selectedArch, getTagCompletionStatus, parseSBOMComponents])

  // Load external image data when component mounts
  useEffect(() => {
    if (!session) {
      return
    }

    const loadExternalImageData = async () => {
      try {
        const result = await getExternalImageAction(session, decodedImageName)
        if ('error' in result) {
          console.error("Failed to load external image data:", result.error)
          setExternalImageData(null)
        } else {
          setExternalImageData(result)
        }
      } catch (error) {
        console.error("Failed to load external image data:", error)
        setExternalImageData(null)
      }
    }

    loadExternalImageData()
  }, [session, decodedImageName, selectedTag])

  // Update selectedTag when external image data loads
  useEffect(() => {
    if (externalImageData?.imageTags && externalImageData.imageTags.length > 0) {
      // If current selectedTag is not in the available tags, update to first available tag
      if (!externalImageData.imageTags.includes(selectedTag)) {
        setSelectedTag(externalImageData.imageTags[0])
      }
    }
  }, [externalImageData?.imageTags, selectedTag])

  // Polling effect for incomplete scans/sboms or pending rescans
  useEffect(() => {
    if (!session || !externalImageData) {
      return
    }

    // Check if any scan status is queued or running
    const hasPendingScan = scanStatus.some(s => s.status === 'queued' || s.status === 'running')

    // Check if the scan has reached a terminal state (succeeded or failed)
    const tagStatus = externalImageData.tagCompletionStatus?.[selectedTag]
    const isScanTerminal = tagStatus?.isScanComplete || tagStatus?.scanStatus === 'failed'

    // Poll if: scan not terminal OR SBOM not complete OR there are pending scans
    const shouldPoll = !isScanTerminal ||
                       !tagStatus?.isSbomComplete ||
                       hasPendingScan

    if (!shouldPoll) {
      return
    }

    const interval = setInterval(async () => {
      try {
        // Poll both external image data and scan status
        const [imageResult, statusResult] = await Promise.all([
          getExternalImageAction(session, decodedImageName),
          getScanStatusAction(session, decodedImageName, selectedTag)
        ])

        if (!('error' in imageResult)) {
          setExternalImageData(imageResult)
        }

        if (!('error' in statusResult)) {
          setScanStatus(statusResult.scans)
          setScanAttemptedAt(statusResult.scanAttemptedAt)
        }
      } catch (error) {
        console.error("Failed to poll data:", error)
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [session, decodedImageName, selectedTag, externalImageData, scanStatus])

  // Watch for completion state changes and trigger appropriate actions
  useEffect(() => {
    if (!externalImageData || !session) {
      return
    }

    // Check if scan just completed
    if (prevScanComplete.current === false && externalImageData.tagCompletionStatus?.[selectedTag]?.isScanComplete === true) {
      console.log("Scan completed, loading vulnerabilities...")
      // The vulnerability loading will be triggered by the existing useEffect
    }

    // Check if SBOM just completed
    if (prevSbomComplete.current === false && externalImageData.tagCompletionStatus?.[selectedTag]?.isSbomComplete === true) {
      console.log("SBOM completed, loading SBOM data...")
      // The SBOM loading will be triggered by the existing useEffect
    }

    // Update previous values
    prevScanComplete.current = externalImageData.tagCompletionStatus?.[selectedTag]?.isScanComplete
    prevSbomComplete.current = externalImageData.tagCompletionStatus?.[selectedTag]?.isSbomComplete
  }, [externalImageData, selectedTag, session])

  // Load vulnerabilities when component mounts or when tag/arch changes
  useEffect(() => {
    if (!session || !externalImageData?.tagCompletionStatus?.[selectedTag]?.isScanComplete) {
      return
    }

    const loadVulnerabilities = async () => {
      // Only show loading state on initial load, not on refreshes
      const isInitialLoad = numCriticalVulnerabilities === null
      if (isInitialLoad) {
        setVulnLoading(true)
      }
      setVulnError(null)

      try {
        const result = await getExternalImageScanAction(session, decodedImageName, selectedTag, selectedArch)

        if (result && typeof result === 'object' && !('error' in result)) {
          setNumCriticalVulnerabilities(result.critical)
          setNumHighVulnerabilities(result.high)
          setNumMediumVulnerabilities(result.medium)
          setNumLowVulnerabilities(result.low)
          setRawVulnerabilities(result.cves.map((cve): Vulnerability => ({
            ...cve,
            severity: cve.severity as "critical" | "high" | "medium" | "low" | "info"
          })))
        } else if (result && typeof result === 'object' && 'error' in result) {
          setVulnError(result.error)
        }
      } catch (error) {
        console.error("Failed to load vulnerabilities:", error)
        setVulnError("Failed to load vulnerabilities")
        setNumCriticalVulnerabilities(null)
        setNumHighVulnerabilities(null)
        setNumMediumVulnerabilities(null)
        setNumLowVulnerabilities(null)
        setRawVulnerabilities([])
      } finally {
        setVulnLoading(false)
      }
    }

    loadVulnerabilities()
  }, [session, decodedImageName, selectedTag, selectedArch, externalImageData])

  // Flexible: Check if this image exists in the SecureBuild catalog by base name (search all catalog images)
  useEffect(() => {
    if (!session || !decodedImageName) return;
    let cancelled = false;
    const checkCatalogFlexible = async () => {
      try {
        // 1. Get all catalog items (global)
        const catalogItems = await listCatalogItemsAction(session);
        // 2. Flatten all images from all catalog items, but keep reference to parent catalog item
        const allImagesWithCatalog = catalogItems.flatMap(item =>
          (item.images || []).map(img => ({ ...img, catalogSlug: item.slug, catalogName: item.name }))
        );
        // 3. Extract base name from external image
        const parts = decodedImageName.split('/');
        const baseName = parts[parts.length - 1].split(':')[0];
        // 4. Find all matches
        const matches = allImagesWithCatalog.filter(img =>
          img.name.toLowerCase().includes(baseName.toLowerCase())
        );
        if (!cancelled) {
          setMatchingCatalogImages(matches);
        }
      } catch {
        if (!cancelled) setMatchingCatalogImages([]);
      }
    };
    checkCatalogFlexible();
    return () => { cancelled = true; };
  }, [session, decodedImageName]);

  // Load scan status when component mounts or when tag changes
  useEffect(() => {
    if (!session || !decodedImageName || !selectedTag) {
      return
    }

    const loadScanStatus = async () => {
      setScanStatusLoading(true)
      try {
        const result = await getScanStatusAction(session, decodedImageName, selectedTag)
        if ('error' in result) {
          console.error("Failed to load scan status:", result.error)
          setScanStatus([])
          setScanAttemptedAt(null)
        } else {
          setScanStatus(result.scans)
          setScanAttemptedAt(result.scanAttemptedAt)
        }
      } catch (error) {
        console.error("Failed to load scan status:", error)
        setScanStatus([])
        setScanAttemptedAt(null)
      } finally {
        setScanStatusLoading(false)
      }
    }

    loadScanStatus()
  }, [session, decodedImageName, selectedTag])

  // Handle rescan button click
  const handleRescan = async () => {
    if (!session || rescanLoading) return

    setRescanLoading(true)
    try {
      const result = await triggerRescanAction(session, decodedImageName, selectedTag)
      if ('error' in result) {
        console.error("Failed to trigger rescan:", result.error)
        // Show error toast to user
        toast({
          title: "Rescan Failed",
          description: result.error,
          variant: "destructive",
        })
      } else {
        console.log("Rescan triggered successfully:", result.message)
        // Show success toast (rescan was queued successfully)
        toast({
          title: "Rescan Started",
          description: "The image rescan has been queued and will begin shortly.",
        })
        // Refresh scan status and image data in a separate try-catch so failures
        // don't overwrite the success toast with "Rescan Failed"
        try {
          const statusResult = await getScanStatusAction(session, decodedImageName, selectedTag)
          if (!('error' in statusResult)) {
            setScanStatus(statusResult.scans)
            setScanAttemptedAt(statusResult.scanAttemptedAt)
          }
          const imageResult = await getExternalImageAction(session, decodedImageName)
          if (!('error' in imageResult)) {
            setExternalImageData(imageResult)
          }
        } catch (refreshError) {
          console.error("Failed to refresh status after rescan (rescan was queued):", refreshError)
          // Do not show "Rescan Failed" — the rescan was successfully queued
        }
      }
    } catch (error) {
      console.error("Failed to trigger rescan:", error)
      // Show generic error toast
      toast({
        title: "Rescan Failed",
        description: "An unexpected error occurred while triggering the rescan.",
        variant: "destructive",
      })
    } finally {
      setRescanLoading(false)
    }
  }

  // Helper to determine if scan has failed
  // Checks if ANY architecture has failed - failure takes priority over other statuses
  const hasScanFailed = useCallback(() => {
    return scanStatus.some(s => s.status === 'failed')
  }, [scanStatus])

  // Helper to get the first failed scan status (for displaying error message)
  const getFailedScanStatus = useCallback(() => {
    return scanStatus.find(s => s.status === 'failed')
  }, [scanStatus])

  // Helper to get the overall scan status for display
  // Priority: failed > running > queued > succeeded > null
  // Note: SBOM status is tracked separately now
  const getOverallScanStatus = useCallback((): 'failed' | 'running' | 'queued' | 'succeeded' | null => {
    if (scanStatus.some(s => s.status === 'failed')) return 'failed'
    if (scanStatus.some(s => s.status === 'running')) return 'running'
    if (scanStatus.some(s => s.status === 'queued')) return 'queued'
    if (scanStatus.some(s => s.status === 'succeeded')) return 'succeeded'
    return null
  }, [scanStatus])

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6">
        {/* Catalog Match Banner */}
        {matchingCatalogImages.length > 0 && (
          <div className="mb-4 p-4 bg-green-100 border border-green-300 rounded">
            <span className="font-semibold">Good news!</span> This image is also available in the{' '}
            <a href={`/images/${matchingCatalogImages[0].name}`} className="underline text-green-700" target="_blank" rel="noopener noreferrer">
              SecureBuild catalog
            </a>.
          </div>
        )}
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{mockImageData.name}</h1>
            <p className="text-muted-foreground">{mockImageData.url}</p>
          </div>
          <div className="flex gap-4 items-end">
            <div className="flex flex-col gap-2">
              <Label htmlFor="tag-select" className="text-sm font-medium">Tag</Label>
              <Select value={selectedTag} onValueChange={setSelectedTag}>
                <SelectTrigger className="w-[150px]" id="tag-select">
                  <SelectValue placeholder="Select tag" />
                </SelectTrigger>
                <SelectContent>
                  {availableTags.map((tag: string) => (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="arch-select" className="text-sm font-medium">Architecture</Label>
              <Select value={selectedArch} onValueChange={setSelectedArch}>
                <SelectTrigger className="w-[120px]" id="arch-select">
                  <SelectValue placeholder="Select arch" />
                </SelectTrigger>
                <SelectContent>
                  {availableArchitectures.map((arch) => (
                    <SelectItem key={arch} value={arch}>
                      {arch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              onClick={handleRescan}
              disabled={rescanLoading}
              className="self-end h-10"
            >
              {rescanLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {rescanLoading ? "Rescanning..." : "Rescan"}
            </Button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Bug className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-sm text-muted-foreground">Total Vulnerabilities</p>
                  <p className="text-2xl font-bold">
                    {!externalImageData?.tagCompletionStatus?.[selectedTag]?.isScanComplete || vulnLoading || numCriticalVulnerabilities === null ? (
                      <span className="animate-pulse">--</span>
                    ) : (
                      (numCriticalVulnerabilities || 0) + (numHighVulnerabilities || 0) + (numMediumVulnerabilities || 0) + (numLowVulnerabilities || 0)
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                {(() => {
                  const status = getOverallScanStatus()
                  const tagStatus = externalImageData?.tagCompletionStatus?.[selectedTag]
                  const sbomStatus = tagStatus?.sbomStatus

                  // Show scan status if available
                  if (status === 'failed') return <XCircle className="h-5 w-5 text-red-500" />
                  if (status === 'running') return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                  if (status === 'succeeded') return <Shield className="h-5 w-5 text-green-500" />
                  if (status === 'queued') return <Loader2 className="h-5 w-5 text-yellow-500 animate-spin" />

                  // If no scan status, check SBOM status
                  if (sbomStatus === 'generating') return <Loader2 className="h-5 w-5 text-purple-500 animate-spin" />
                  if (sbomStatus === 'pending') return <Clock className="h-5 w-5 text-orange-500" />
                  if (sbomStatus === 'failed') return <XCircle className="h-5 w-5 text-red-500" />

                  // null - no scan or SBOM record exists yet
                  return <Clock className="h-5 w-5 text-gray-400" />
                })()}
                <div>
                  <p className="text-sm text-muted-foreground">Scan Status</p>
                  {(() => {
                    const status = getOverallScanStatus()
                    const tagStatus = externalImageData?.tagCompletionStatus?.[selectedTag]
                    const sbomStatus = tagStatus?.sbomStatus

                    // Show scan status if available
                    if (status === 'failed') return <Badge variant="destructive" className="mt-1">Scan Failed</Badge>
                    if (status === 'running') return <Badge variant="secondary" className="mt-1">Scanning</Badge>
                    if (status === 'succeeded') return <Badge variant="default" className="mt-1">Complete</Badge>
                    if (status === 'queued') return <Badge variant="secondary" className="mt-1 bg-yellow-100 text-yellow-800">Scan Queued</Badge>

                    // If no scan status, check SBOM status (scan can't start until SBOM is complete)
                    if (sbomStatus === 'generating') return <Badge variant="secondary" className="mt-1 bg-purple-100 text-purple-800">Generating SBOM</Badge>
                    if (sbomStatus === 'pending') return <Badge variant="secondary" className="mt-1 bg-orange-100 text-orange-800">SBOM Pending</Badge>
                    if (sbomStatus === 'failed') return <Badge variant="destructive" className="mt-1">SBOM Failed</Badge>

                    // null - no scan or SBOM record exists yet
                    return <Badge variant="secondary" className="mt-1">Not Started</Badge>
                  })()}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-gray-500" />
                <div>
                  <p className="text-sm text-muted-foreground">Last Scanned</p>
                  <p className="text-sm font-medium">
                    {scanStatus.length > 0 && scanStatus[0].scanCompletedAt ?
                      new Date(scanStatus[0].scanCompletedAt).toLocaleString() :
                      "Not scanned"
                    }
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* SBOM Failed Banner */}
        {externalImageData?.tagCompletionStatus?.[selectedTag]?.sbomStatus === 'failed' && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h4 className="font-medium text-red-800">SBOM Generation Failed</h4>
                <p className="text-sm text-red-700 mt-1">
                  The Software Bill of Materials could not be generated for this image.
                </p>
                <p className="text-xs text-red-600 mt-2">
                  The scan cannot proceed until the SBOM is successfully generated. Click the &quot;Rescan&quot; button to retry.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Scan Failed Banner */}
        {hasScanFailed() && getFailedScanStatus()?.scanStatusMessage && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <h4 className="font-medium text-red-800">Scan Failed</h4>
                <p className="text-sm text-red-700 mt-1">
                  {getFailedScanStatus()?.scanStatusMessage}
                </p>
                <p className="text-xs text-red-600 mt-2">
                  Click the &quot;Rescan&quot; button to retry the security scan.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Main Content */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hash className="h-5 w-5" />
              Image Details
            </CardTitle>
            <CardDescription>
              Detailed information about this external image
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Column 1 */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Digest</label>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded break-all">
                      {(() => {
                        // Get per-architecture image digest from scan status
                        const archKey = selectedArch === "amd64" ? "x86_64" : "aarch64"
                        const archStatus = scanStatus.find(s => s.arch === archKey)
                        return archStatus?.imageDigest || externalImageData?.tagCompletionStatus?.[selectedTag]?.digest || "Loading..."
                      })()}
                    </span>
                    <div className="relative">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const archKey = selectedArch === "amd64" ? "x86_64" : "aarch64"
                          const archStatus = scanStatus.find(s => s.arch === archKey)
                          const digest = archStatus?.imageDigest || externalImageData?.tagCompletionStatus?.[selectedTag]?.digest
                          if (digest) {
                            navigator.clipboard.writeText(digest)
                            setShowCopied(true)
                            setTimeout(() => setShowCopied(false), 1500)
                          }
                        }}
                        className="h-5 w-5 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
                        disabled={!scanStatus.find(s => s.arch === (selectedArch === "amd64" ? "x86_64" : "aarch64"))?.imageDigest && !externalImageData?.tagCompletionStatus?.[selectedTag]?.digest}
                      >
                        {showCopied ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                      </Button>
                      {showCopied && (
                        <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                          Copied!
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Name</label>
                  <p className="font-mono text-sm">{mockImageData.name}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Alternate Image</label>
                  <p className="font-mono text-sm">{mockImageData.url}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Tag</label>
                  <p className="font-mono text-sm">{selectedTag}</p>
                  {externalImageData?.tagCompletionStatus?.[selectedTag]?.digest && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded break-all">
                        {externalImageData.tagCompletionStatus[selectedTag].digest}
                      </span>
                      <div className="relative">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const digest = externalImageData?.tagCompletionStatus?.[selectedTag]?.digest
                            if (digest) {
                              navigator.clipboard.writeText(digest)
                              setShowTagDigestCopied(true)
                              setTimeout(() => setShowTagDigestCopied(false), 1500)
                            }
                          }}
                          className="h-5 w-5 p-0 hover:bg-gray-200 dark:hover:bg-gray-700"
                        >
                          {showTagDigestCopied ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
                        </Button>
                        {showTagDigestCopied && (
                          <span className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                            Copied!
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Column 2 */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Created At</label>
                  <p className="text-sm">
                    {externalImageData?.createdAt ?
                      new Date(externalImageData.createdAt).toLocaleString() :
                      "Not available"
                    }
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Last Scan Attempted</label>
                  <p className="text-sm">
                    {scanAttemptedAt ?
                      new Date(scanAttemptedAt).toLocaleString() :
                      "Not attempted"
                    }
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">Last Scan Completed</label>
                  <p className="text-sm">
                    {scanStatus.length > 0 && scanStatus[0].scanCompletedAt ?
                      new Date(scanStatus[0].scanCompletedAt).toLocaleString() :
                      "Not completed"
                    }
                  </p>
                </div>
              </div>
            </div>

            {/* Additional Details */}
            <div className="border-t pt-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Architecture:</span>
                    <span>{mockImageData.architecture}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">OS:</span>
                    <span>{mockImageData.os}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Registry Access:</span>
                    <Badge variant="outline" className="text-xs">Unknown</Badge>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">SBOM Available:</span>
                    {externalImageData?.tagCompletionStatus?.[selectedTag]?.isSbomComplete ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : (
                      <Clock className="h-4 w-4 text-gray-500" />
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Security Summary</h4>
              <div className="grid grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {!externalImageData?.tagCompletionStatus?.[selectedTag]?.isScanComplete || vulnLoading || numCriticalVulnerabilities === null ? (
                      <span className="animate-pulse">--</span>
                    ) : (
                      numCriticalVulnerabilities
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">Critical</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">
                    {!externalImageData?.tagCompletionStatus?.[selectedTag]?.isScanComplete || vulnLoading || numHighVulnerabilities === null ? (
                      <span className="animate-pulse">--</span>
                    ) : (
                      numHighVulnerabilities
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">High</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-600">
                    {!externalImageData?.tagCompletionStatus?.[selectedTag]?.isScanComplete || vulnLoading || numMediumVulnerabilities === null ? (
                      <span className="animate-pulse">--</span>
                    ) : (
                      numMediumVulnerabilities
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">Medium</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {!externalImageData?.tagCompletionStatus?.[selectedTag]?.isScanComplete || vulnLoading || numLowVulnerabilities === null ? (
                      <span className="animate-pulse">--</span>
                    ) : (
                      numLowVulnerabilities
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">Low</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Vulnerabilities Section */}
        <Card>
          <CardHeader className="relative">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Vulnerabilities
            </CardTitle>
            <CardDescription>
              Security vulnerabilities found in this image
            </CardDescription>
            {/* Catalog Match Compact Banner (top right) */}
            {matchingCatalogImages.length > 0 && (
              <CatalogMatchBannerWithVulnCounts images={matchingCatalogImages} />
            )}
          </CardHeader>
          <CardContent>
            {/* Severity Filter Widget */}
            <div className="mb-4 flex flex-wrap gap-2 items-center">
              <span className="text-sm font-medium mr-2">Filter by Severity:</span>
              {[
                { label: "All", value: "all", color: "bg-gray-200 text-gray-800" },
                { label: "Critical", value: "critical", color: "bg-red-100 text-red-800" },
                { label: "High", value: "high", color: "bg-orange-100 text-orange-800" },
                { label: "Medium", value: "medium", color: "bg-yellow-100 text-yellow-800" },
                { label: "Low", value: "low", color: "bg-blue-100 text-blue-800" },
                { label: "Info", value: "info", color: "bg-gray-100 text-gray-800" },
              ].map(option => (
                <Button
                  key={option.value}
                  variant={selectedSeverity === option.value ? "default" : "outline"}
                  className={`h-8 px-3 text-xs ${option.color}`}
                  onClick={() => setSelectedSeverity(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {!externalImageData?.tagCompletionStatus?.[selectedTag]?.isScanComplete ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">Scanning in progress...</p>
                  <p className="text-xs text-muted-foreground mt-1">Vulnerability data will be available once the scan completes</p>
                </div>
              </div>
            ) : vulnLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">Loading vulnerabilities...</p>
                </div>
              </div>
            ) : vulnError ? (
              <div className="text-center py-8">
                {vulnError === "Scan result not found" ? (
                  <>
                    <Package className="h-8 w-8 text-gray-400 mx-auto mb-4" />
                    <p className="text-sm font-medium text-muted-foreground mb-2">Scan Result Not Available</p>
                    <p className="text-xs text-muted-foreground">
                      No scan results found for the <span className="font-mono">{selectedArch}</span> architecture.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      This image may not support this architecture, or the scan hasn&apos;t completed yet.
                    </p>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto mb-4" />
                    <p className="text-sm font-medium text-muted-foreground mb-2">Failed to Load Vulnerabilities</p>
                    <p className="text-xs text-red-500">{vulnError}</p>
                  </>
                )}
              </div>
            ) : filteredVulnerabilities.length === 0 ? (
              <div className="text-center py-8">
                <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
                {selectedSeverity === "all" ? (
                  <>
                    <h3 className="text-lg font-medium">No Vulnerabilities Found</h3>
                    <p className="text-muted-foreground">This image appears to be clean of known security vulnerabilities.</p>
                  </>
                ) : (
                  <h3 className="text-lg font-medium">No {selectedSeverity.charAt(0).toUpperCase() + selectedSeverity.slice(1)} Vulnerabilities Found</h3>
                )}
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CVE ID</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                   {pagedVulnerabilities.map((vuln, index) => (
                     <TableRow key={index}>
                       <TableCell className="font-mono text-sm min-w-[140px] whitespace-nowrap">{vuln.cve}</TableCell>
                       <TableCell>
                         <Badge className={getSeverityColor(vuln.severity)}>
                           {vuln.severity}
                         </Badge>
                       </TableCell>
                       <TableCell className="font-medium">{vuln.description}</TableCell>
                     </TableRow>
                   ))}
                  </TableBody>
                </Table>
               {/* Pagination Controls */}
               {totalPages > 1 && (
                 <div className="flex justify-between items-center mt-4">
                   <Button
                     variant="outline"
                     size="sm"
                     disabled={currentPage === 1}
                     onClick={() => setCurrentPage(currentPage - 1)}
                   >
                     Prev
                   </Button>
                   <span className="text-sm text-muted-foreground">
                     Page {currentPage} of {totalPages}
                   </span>
                   <Button
                     variant="outline"
                     size="sm"
                     disabled={currentPage === totalPages}
                     onClick={() => setCurrentPage(currentPage + 1)}
                   >
                     Next
                   </Button>
                 </div>
               )}
              </>
            )}
          </CardContent>
        </Card>

        {/* SBOM Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Software Bill of Materials (SBOM)
            </CardTitle>
            <CardDescription>
              Complete inventory of software components in this image (libraries excluded)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-sm font-medium">
                    Components Found: {!externalImageData?.tagCompletionStatus?.[selectedTag]?.isSbomComplete ? "Generating..." : sbomLoading ? "Loading..." : filteredSbomComponents.length}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {!externalImageData?.tagCompletionStatus?.[selectedTag]?.isSbomComplete ? "SBOM generation in progress..." : sbomLoading ? "Loading SBOM..." : sbomData ? "SBOM Available" : "No SBOM available"}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Dialog open={showRawSBOM} onOpenChange={setShowRawSBOM}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!externalImageData?.tagCompletionStatus?.[selectedTag]?.isSbomComplete || !sbomData || sbomLoading}>
                      <Eye className="h-4 w-4 mr-2" />
                      View Raw
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl max-h-[80vh]">
                    <DialogHeader>
                      <DialogTitle>Raw SBOM JSON</DialogTitle>
                      <DialogDescription>
                        Software Bill of Materials in JSON format
                      </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="h-[60vh] w-full">
                      <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded-lg overflow-x-auto">
                        {sbomData ? JSON.stringify(JSON.parse(sbomData), null, 2) : "No SBOM data available"}
                      </pre>
                    </ScrollArea>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => {
                        if (sbomData) {
                          navigator.clipboard.writeText(JSON.stringify(JSON.parse(sbomData), null, 2))
                        }
                      }} disabled={!externalImageData?.tagCompletionStatus?.[selectedTag]?.isSbomComplete || !sbomData}>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy to Clipboard
                      </Button>
                      <Button onClick={() => setShowRawSBOM(false)}>
                        Close
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button variant="outline" size="sm" disabled={!externalImageData?.tagCompletionStatus?.[selectedTag]?.isSbomComplete || !sbomData || sbomLoading}>
                  <Download className="h-4 w-4 mr-2" />
                  Download JSON
                </Button>
                <Button variant="outline" size="sm" disabled={!externalImageData?.tagCompletionStatus?.[selectedTag]?.isSbomComplete || !sbomData || sbomLoading}>
                  <Download className="h-4 w-4 mr-2" />
                  Download SPDX
                </Button>
              </div>
            </div>

            {!externalImageData?.tagCompletionStatus?.[selectedTag]?.isSbomComplete ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">SBOM generation in progress...</p>
                  <p className="text-xs text-muted-foreground mt-1">SBOM data will be available once generation completes</p>
                </div>
              </div>
            ) : sbomLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">Loading SBOM data...</p>
                </div>
              </div>
            ) : sbomError ? (
              <div className="text-center py-8">
                <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto mb-4" />
                <p className="text-sm text-muted-foreground mb-2">Failed to load SBOM data</p>
                <p className="text-xs text-red-500">{sbomError}</p>
              </div>
            ) : filteredSbomComponents.length === 0 ? (
              <div className="text-center py-8">
                <Package className="h-8 w-8 text-gray-400 mx-auto mb-4" />
                <p className="text-sm text-muted-foreground">No SBOM data available for this image</p>
              </div>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>License</TableHead>
                      <TableHead>Supplier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedSbomComponents.map((component, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{component.name}</div>
                            {component.description && (
                              <div className="text-xs text-muted-foreground max-w-md truncate" title={component.description}>
                                {component.description}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm">{component.version}</TableCell>
                        <TableCell className="font-mono text-sm">{component.license}</TableCell>
                        <TableCell className="text-sm">{component.supplier || "N/A"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {/* Pagination Controls for SBOM */}
                {sbomTotalPages > 1 && (
                  <div className="flex justify-between items-center mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={sbomCurrentPage === 1}
                      onClick={() => setSbomCurrentPage(sbomCurrentPage - 1)}
                    >
                      Prev
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Page {sbomCurrentPage} of {sbomTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={sbomCurrentPage === sbomTotalPages}
                      onClick={() => setSbomCurrentPage(sbomCurrentPage + 1)}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>


      </div>
    </div>
  )
}
