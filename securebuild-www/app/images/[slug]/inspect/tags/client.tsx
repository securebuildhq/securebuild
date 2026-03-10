"use client"

import Link from "next/link"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FileText, Shield, GitCommit } from "lucide-react"
import { useInspect } from "../inspect-context"

interface TagsPageClientProps {
  slug: string
}

export default function TagsPageClient({ slug }: TagsPageClientProps) {
  const { image, tagVulnerabilityCounts } = useInspect()

  if (!image) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No image data available for {slug}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold">Available Tags</h2>
        <p className="text-muted-foreground">
          {image.tags.length} tag{image.tags.length !== 1 ? "s" : ""} available for {image.name}
        </p>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tag</TableHead>
              <TableHead>Last Built</TableHead>
              <TableHead>Vulnerabilities</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {image.tags.map((tag: string) => (
              <TableRow key={tag}>
                <TableCell className="font-medium">
                  <code className="px-2 py-1 rounded-md bg-muted text-sm font-mono">
                    {tag}
                  </code>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(image.lastBuiltAt).toLocaleString(undefined, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZoneName: "short",
                  })}
                </TableCell>
                <TableCell>
                  {tagVulnerabilityCounts[tag] === 0 ? (
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100 hover:text-green-800 dark:bg-green-900 dark:text-green-300 dark:hover:bg-green-900 dark:hover:text-green-300">
                      No vulnerabilities
                    </Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-800 hover:bg-red-100 hover:text-red-800 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-900 dark:hover:text-red-300">
                      {tagVulnerabilityCounts[tag]} vulnerabilities fixed
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" asChild title="View SBOM">
                      <Link href={`/images/${slug}/inspect/sbom/${tag}/x86_64`}>
                        <FileText className="h-4 w-4" />
                        <span className="sr-only">View SBOM for {tag}</span>
                      </Link>
                    </Button>
                    <Button variant="ghost" size="sm" asChild title="View Security">
                      <Link href={`/images/${slug}/inspect/security/${tag}/x86_64`}>
                        <Shield className="h-4 w-4" />
                        <span className="sr-only">View Security for {tag}</span>
                      </Link>
                    </Button>
                    <Button variant="ghost" size="sm" asChild title="View Provenance">
                      <Link href={`/images/${slug}/inspect/provenance/${tag}/x86_64`}>
                        <GitCommit className="h-4 w-4" />
                        <span className="sr-only">View Provenance for {tag}</span>
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
