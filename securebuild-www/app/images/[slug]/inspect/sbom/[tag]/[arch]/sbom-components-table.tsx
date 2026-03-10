"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { renderLicenseLinks } from "@/lib/utils/license-utils"

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

interface SbomComponentsTableProps {
  packages: SBOMPackage[]
}

export function SbomComponentsTable({ packages }: SbomComponentsTableProps) {
  const [sortColumn, setSortColumn] = useState<string>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')

  const getSortedPackages = (packages: SBOMPackage[]) => {
    if (!packages) return []
    const filtered = packages.filter((pkg: SBOMPackage) =>
      !pkg.name.includes("sha256") &&
      !pkg.name.includes(".yaml") &&
      pkg.externalRefs?.[0]?.referenceLocator?.includes("pkg:apk")
    )
    return [...filtered].sort((a, b) => {
      let aValue = ''
      let bValue = ''
      switch (sortColumn) {
        case 'name':
          aValue = a.name?.toLowerCase() || ''
          bValue = b.name?.toLowerCase() || ''
          break
        case 'version':
          aValue = a.versionInfo?.toLowerCase() || ''
          bValue = b.versionInfo?.toLowerCase() || ''
          break
        case 'license':
          aValue = (a.licenseDeclared && a.licenseDeclared !== "NOASSERTION" ? a.licenseDeclared : '').toLowerCase()
          bValue = (b.licenseDeclared && b.licenseDeclared !== "NOASSERTION" ? b.licenseDeclared : '').toLowerCase()
          break
        case 'supplier':
          aValue = (a.supplier?.replace("Organization: ", "") || a.originator?.replace("Organization: ", "") || "Unknown").toLowerCase()
          bValue = (b.supplier?.replace("Organization: ", "") || b.originator?.replace("Organization: ", "") || "Unknown").toLowerCase()
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

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const sortedPackages = getSortedPackages(packages)

  return (
    <Card>
      <CardHeader>
        <CardTitle>SBOM Components</CardTitle>
        <CardDescription>Components included in the Software Bill of Materials</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer" onClick={() => handleSort('name')}>
                  Name {sortColumn === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('version')}>
                  Version {sortColumn === 'version' && (sortDirection === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('license')}>
                  License {sortColumn === 'license' && (sortDirection === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('supplier')}>
                  Supplier {sortColumn === 'supplier' && (sortDirection === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead>Vulnerabilities</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPackages.map((pkg: SBOMPackage) => (
                <TableRow key={pkg.SPDXID}>
                  <TableCell className="font-medium">{pkg.name}</TableCell>
                  <TableCell>{pkg.versionInfo}</TableCell>
                  <TableCell>
                    {renderLicenseLinks(pkg.licenseDeclared || '')}
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
              ))}
              {(!packages || packages.length === 0) && (
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
        </div>
      </CardContent>
    </Card>
  )
}
