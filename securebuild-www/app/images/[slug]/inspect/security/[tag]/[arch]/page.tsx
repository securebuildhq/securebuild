import { getSession } from "@/lib/auth/session"
import { getScanResultsAction } from "@/lib/image/actions/get-scan-results"
import { VulnerabilityDashboard } from "./vulnerability-dashboard"
import { VulnerabilityTables } from "./vulnerability-tables"

export { generateMetadata } from "./metadata"

export const dynamic = 'force-dynamic'
export const dynamicParams = true
export const revalidate = 0

interface Vulnerability {
  id: string
  severity: string
  description: string
  dataSource?: string
  namespace?: string
  cvss?: Array<{
    metrics?: { baseScore?: number }
    vector?: string
  }>
  urls?: string[]
}

interface Artifact {
  name?: string
  version?: string
}

interface VulnerabilityMatch {
  vulnerability: Vulnerability
  artifact?: Artifact
}

interface ScanResults {
  matches?: VulnerabilityMatch[]
}

interface SecurityPageProps {
  params: Promise<{
    slug: string
    tag: string
    arch: string
  }>
}

export default async function SecurityPage({ params }: SecurityPageProps) {
  const { slug, tag, arch } = await params
  const session = await getSession()

  // Server-side data fetching
  let scanResults: unknown = null
  let parsedScanResultsSecurebuild: ScanResults | null = null
  let parsedScanResultsAlternate: ScanResults | null = null
  let error: string | null = null

  try {
    scanResults = await getScanResultsAction(session ?? undefined, slug, tag, arch)

    if (scanResults && typeof scanResults === 'object' && 'secureBuild' in scanResults && scanResults.secureBuild) {
      const parsed = JSON.parse(scanResults.secureBuild as string) as ScanResults
      // Filter to only include CVE vulnerabilities
      if (parsed.matches) {
        parsed.matches = parsed.matches.filter((match: VulnerabilityMatch) => match.vulnerability.id.startsWith("CVE-"))
      }
      parsedScanResultsSecurebuild = parsed
    }

    if (scanResults && typeof scanResults === 'object' && 'alternate' in scanResults && scanResults.alternate) {
      parsedScanResultsAlternate = JSON.parse(scanResults.alternate as string) as ScanResults
    }
  } catch (err) {
    console.error('Error loading security scan results:', err)
    error = 'Failed to load security scan data'
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    )
  }

  if (!parsedScanResultsSecurebuild) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No security scan data available for {slug}:{tag} ({arch})
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <VulnerabilityDashboard scanResults={parsedScanResultsSecurebuild} />
      <VulnerabilityTables
        currentScanResults={parsedScanResultsSecurebuild}
        alternateScanResults={parsedScanResultsAlternate}
      />
    </div>
  )
}