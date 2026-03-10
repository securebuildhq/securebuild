"use client"

import { createContext, useContext, ReactNode, useState, useEffect } from "react"
import { usePathname } from "next/navigation"
import { Image as SBImage } from "@/lib/types/image"

interface InspectContextType {
  image: SBImage | null
  selectedTag: string
  setSelectedTag: (tag: string) => void
  selectedArchitecture: string
  setSelectedArchitecture: (arch: string) => void
  hasImageAccess: boolean | null
  hasReadme: boolean
  tagVulnerabilityCounts: Record<string, number>
}

const InspectContext = createContext<InspectContextType | undefined>(undefined)

interface InspectProviderProps {
  children: ReactNode
  image: SBImage | null
  defaultTag: string
  defaultArchitecture?: string
  hasImageAccess: boolean | null
  hasReadme: boolean
  tagVulnerabilityCounts?: Record<string, number>
}

export function InspectProvider({
  children,
  image,
  defaultTag,
  defaultArchitecture = "x86_64",
  hasImageAccess,
  hasReadme,
  tagVulnerabilityCounts = {}
}: InspectProviderProps) {
  const pathname = usePathname()
  const [selectedTag, setSelectedTag] = useState(defaultTag)
  const [selectedArchitecture, setSelectedArchitecture] = useState(defaultArchitecture)

  // Sync state with URL params when pathname changes
  // Only pathname in deps to avoid race condition with dropdown selection
  useEffect(() => {
    const pathParts = pathname.split('/')
    const inspectIndex = pathParts.indexOf('inspect')
    
    // Check if we're on a page with tag/arch in URL (security, sbom, provenance)
    if (inspectIndex >= 0 && pathParts.length > inspectIndex + 3) {
      const currentTab = pathParts[inspectIndex + 1]
      if (currentTab === 'security' || currentTab === 'sbom' || currentTab === 'provenance') {
        const urlTag = pathParts[inspectIndex + 2]
        const urlArch = pathParts[inspectIndex + 3]
        
        if (urlTag) {
          setSelectedTag(urlTag)
        }
        if (urlArch) {
          setSelectedArchitecture(urlArch)
        }
      }
    }
  }, [pathname])

  const value: InspectContextType = {
    image,
    selectedTag,
    setSelectedTag,
    selectedArchitecture,
    setSelectedArchitecture,
    hasImageAccess,
    hasReadme,
    tagVulnerabilityCounts
  }

  return (
    <InspectContext.Provider value={value}>
      {children}
    </InspectContext.Provider>
  )
}

export function useInspect() {
  const context = useContext(InspectContext)
  if (context === undefined) {
    throw new Error('useInspect must be used within an InspectProvider')
  }
  return context
}
