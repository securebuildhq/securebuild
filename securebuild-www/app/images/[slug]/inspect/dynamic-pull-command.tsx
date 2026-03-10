"use client"

import { usePathname } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CopyButton } from "./copy-button"

interface DynamicPullCommandProps {
  imageName: string
  defaultTag: string
}

export function DynamicPullCommand({ imageName, defaultTag }: DynamicPullCommandProps) {
  const pathname = usePathname()

  // Extract tag from pathname
  // pathname will be like: /images/[slug]/inspect/sbom/[tag]/[arch] or /images/[slug]/inspect/security/[tag]/[arch]
  const pathParts = pathname.split('/').filter(Boolean)
  const inspectIndex = pathParts.indexOf('inspect')

  let currentTag = defaultTag
  if (inspectIndex >= 0 && inspectIndex + 2 < pathParts.length) {
    const pageType = pathParts[inspectIndex + 1] // "sbom" or "security"
    if (pageType === 'sbom' || pageType === 'security') {
      currentTag = pathParts[inspectIndex + 2] // The tag
    }
  }

  const pullCommand = `docker pull cve0.io/${imageName}:${currentTag}`

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pull Command</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-3 flex items-center">
          <code className="text-sm text-muted-foreground flex-1 font-mono">
            {pullCommand}
          </code>
          <CopyButton text={pullCommand} />
        </div>
      </CardContent>
    </Card>
  )
}
