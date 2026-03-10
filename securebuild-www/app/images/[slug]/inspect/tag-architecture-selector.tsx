"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Tag, Cpu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Image as SBImage } from "@/lib/types/image"
import { useInspect } from "./inspect-context"

interface TagArchitectureSelectorProps {
  slug: string
  image: SBImage
}

export function TagArchitectureSelector({
  slug,
  image
}: TagArchitectureSelectorProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { selectedTag, setSelectedTag, selectedArchitecture, setSelectedArchitecture, hasReadme } = useInspect()

  // Extract current tab from pathname
  const pathParts = pathname.split('/')
  const inspectIndex = pathParts.indexOf('inspect')
  const currentTab = pathParts[inspectIndex + 1] || 'sbom'

  // Navigate to appropriate URL handling is done in event handlers below

  // Handle tag/arch selection for context update
  const handleTagSelect = (tag: string) => {
    setSelectedTag(tag)
    if (currentTab !== 'tags' && currentTab !== 'readme') {
      router.push(`/images/${slug}/inspect/${currentTab}/${tag}/${selectedArchitecture}`)
    }
  }

  const handleArchSelect = (arch: string) => {
    setSelectedArchitecture(arch)
    if (currentTab !== 'tags' && currentTab !== 'readme') {
      router.push(`/images/${slug}/inspect/${currentTab}/${selectedTag}/${arch}`)
    }
  }

  // Determine grid layout based on whether README tab is shown
  const gridCols = hasReadme ? 'grid-cols-5' : 'grid-cols-4'

  return (
    <div className="flex justify-between items-center">
      <div className={`grid h-10 items-center gap-1 rounded-md bg-muted p-1 text-muted-foreground ${gridCols} md:w-[500px]`}>
        {hasReadme && (
          <Link
            href={`/images/${slug}/inspect/readme`}
            className={`inline-flex w-full items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
              currentTab === 'readme'
                ? 'bg-background text-foreground shadow-sm'
                : 'hover:bg-background/50'
            }`}
          >
            README
          </Link>
        )}
        <Link
          href={`/images/${slug}/inspect/tags`}
          className={`inline-flex w-full items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
            currentTab === 'tags'
              ? 'bg-background text-foreground shadow-sm'
              : 'hover:bg-background/50'
          }`}
        >
          Tags
        </Link>
        <Link
          href={`/images/${slug}/inspect/security/${selectedTag}/${selectedArchitecture}`}
          className={`inline-flex w-full items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
            currentTab === 'security'
              ? 'bg-background text-foreground shadow-sm'
              : 'hover:bg-background/50'
          }`}
        >
          Security
        </Link>
        <Link
          href={`/images/${slug}/inspect/sbom/${selectedTag}/${selectedArchitecture}`}
          className={`inline-flex w-full items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
            currentTab === 'sbom'
              ? 'bg-background text-foreground shadow-sm'
              : 'hover:bg-background/50'
          }`}
        >
          SBOM
        </Link>
        <Link
          href={`/images/${slug}/inspect/provenance/${selectedTag}/${selectedArchitecture}`}
          className={`inline-flex w-full items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 ${
            currentTab === 'provenance'
              ? 'bg-background text-foreground shadow-sm'
              : 'hover:bg-background/50'
          }`}
        >
          Provenance
        </Link>
      </div>
      {currentTab !== 'tags' && currentTab !== 'readme' && (
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
                <DropdownMenuItem
                  key={tag}
                  onClick={() => handleTagSelect(tag)}
                >
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
              <DropdownMenuItem onClick={() => handleArchSelect('x86_64')}>
                x86_64
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleArchSelect('arm64')}>
                arm64
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )
}
