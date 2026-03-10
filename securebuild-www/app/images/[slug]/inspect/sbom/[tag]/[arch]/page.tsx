import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { getSession } from "@/lib/auth/session"
import { getSbomAction } from "@/lib/image/actions/get-sbom"
import { getScanResults } from "@/lib/image/scan"
import { renderLicenseSummaryBadge } from "@/lib/utils/license-utils"
import { SbomComponentsTable } from "./sbom-components-table"

export { generateMetadata } from "./metadata"

export const dynamic = 'force-dynamic'
export const dynamicParams = true
export const revalidate = 0

interface SBOMCreationInfo {
  created?: string
  creators?: string[]
}

interface SBOMPackage {
  SPDXID: string
  name: string
  versionInfo?: string
  licenseDeclared?: string
  supplier?: string
  originator?: string
  vulnerabilities?: number
  externalRefs?: Array<{
    referenceLocator?: string
  }>
}

interface ParsedSBOM {
  name: string
  spdxVersion?: string
  packages?: SBOMPackage[]
  creationInfo?: SBOMCreationInfo
  dataLicense?: string
}

interface ScanMatch {
  artifact?: {
    name?: string
  }
}

interface ParsedScan {
  matches?: ScanMatch[]
}

interface SBOMPageProps {
  params: Promise<{
    slug: string
    tag: string
    arch: string
  }>
}

export default async function SBOMPage({ params }: SBOMPageProps) {
  const { slug, tag, arch } = await params
  const session = await getSession()

  // Server-side data fetching
  let sbom: unknown = null
  let parsedSbom: ParsedSBOM | null = null
  let error: string | null = null

  try {
    sbom = await getSbomAction(session ?? undefined, slug, tag, arch)
    if (sbom) {
      parsedSbom = typeof sbom === 'string' ? JSON.parse(sbom) : sbom
      
      // Enrich packages with vulnerability counts
      if (parsedSbom?.packages) {
        const imageName = slug // assuming slug is the image name
        const scanResults = await getScanResults(imageName, tag, arch)
        
        // Create a map of package vulnerabilities
        const packageVulns = new Map()
        if (scanResults?.secureBuild) {
          try {
            const parsedScan = JSON.parse(scanResults.secureBuild) as ParsedScan
            if (parsedScan?.matches) {
              for (const match of parsedScan.matches) {
                const pkgName = match.artifact?.name
                if (pkgName) {
                  const count = packageVulns.get(pkgName) || 0
                  packageVulns.set(pkgName, count + 1)
                }
              }
            }
          } catch (parseErr) {
            console.error('Error parsing scan results:', parseErr)
          }
        }
        
        // Add vulnerability counts to packages
        parsedSbom.packages = parsedSbom.packages.map((pkg: SBOMPackage) => ({
          ...pkg,
          vulnerabilities: packageVulns.get(pkg.name) || 0
        }))
      }
    }
  } catch (err) {
    console.error('Error loading SBOM:', err)
    error = 'Failed to load SBOM data'
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    )
  }

  if (!parsedSbom) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No SBOM data available for {slug}:{tag} ({arch})
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>SBOM Summary</CardTitle>
          <CardDescription>
            Software Bill of Materials for {slug}:{tag}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* SBOM Name - Full Width */}
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">SBOM Name</h4>
              <p className="text-sm break-all font-mono bg-gray-50 dark:bg-gray-800 px-4 py-3 rounded-lg border" title={parsedSbom.name}>
                {parsedSbom.name}
              </p>
            </div>

            {/* Main SBOM Info - 4 Column Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Format</h4>
                <p className="text-sm font-medium">SPDX {parsedSbom.spdxVersion}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Components</h4>
                <p className="text-sm font-medium">{parsedSbom.packages?.length || 0}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Created</h4>
                <p className="text-sm font-medium">{parsedSbom.creationInfo?.created ? new Date(parsedSbom.creationInfo.created).toLocaleDateString() : 'N/A'}</p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-2">Data License</h4>
                <p className="text-sm font-medium">{parsedSbom.dataLicense}</p>
              </div>
            </div>

            {/* Creators and Licenses - 2 Column Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">Creators</h4>
                <div className="flex flex-wrap gap-2">
                  {(parsedSbom.creationInfo?.creators && Array.isArray(parsedSbom.creationInfo.creators) && parsedSbom.creationInfo.creators.length > 0) ? parsedSbom.creationInfo.creators.map((creator: string, index: number) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {creator}
                    </Badge>
                  )) : (
                    <span className="text-sm text-muted-foreground">No creators specified</span>
                  )}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-muted-foreground mb-3">License Types</h4>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const licenses = parsedSbom.packages?.map((pkg: SBOMPackage) => pkg.licenseDeclared)
                      .filter((license): license is string => Boolean(license) && license !== "NOASSERTION") || []
                    const uniqueLicenses = [...new Set(licenses)]
                    return (
                      <>
                        {uniqueLicenses
                          .slice(0, 12)
                          .map((license: string, index: number) => renderLicenseSummaryBadge(license, index))}
                        {uniqueLicenses.length > 12 && (
                          <Badge variant="outline" className="text-xs">
                            +{uniqueLicenses.length - 12} more
                          </Badge>
                        )}
                      </>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <SbomComponentsTable packages={parsedSbom.packages || []} />
    </div>
  )
}