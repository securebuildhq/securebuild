import React, { useEffect, useState } from "react";
import Image from "next/image";

interface CatalogImage {
  id: string;
  name: string;
  version?: string;
  architecture?: string;
  catalogSlug: string;
}

export function CatalogMatchBannerWithVulnCounts({ images }: { images: CatalogImage[] }) {
  const [vulnCounts, setVulnCounts] = useState<Record<string, number | null>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchAllCounts() {
      setLoading(true)
      const counts: Record<string, number | null> = {}
      for (const img of images) {
        try {
          const res = await fetch(`/images/${img.id}/security`)
          if (!res.ok) {
            counts[img.id] = null
            continue
          }
          const data = await res.json()
          let total = 0
          if (data.secureBuild) {
            try {
              const scan = JSON.parse(data.secureBuild)
              if (Array.isArray(scan.matches)) {
                total = scan.matches.length
              } else {
                total = 0
              }
            } catch {
              total = 0
            }
          } else {
            total = 0
          }
          counts[img.id] = total
        } catch {
          counts[img.id] = null
        }
      }
      if (!cancelled) {
        setVulnCounts(counts)
        setLoading(false)
      }
    }
    fetchAllCounts()
    return () => { cancelled = true }
  }, [images])

  if (loading) {
    return (
      <div className="absolute top-4 right-4 bg-blue-50 border border-blue-200 rounded px-3 py-1 text-xs flex flex-row items-start gap-2 shadow-sm">
        <Image
          src="/sb-192x192.png"
          alt="SecureBuild Logo"
          width={24}
          height={24}
          className="inline-block align-top rounded"
          style={{ minWidth: 24, minHeight: 24 }}
        />
        <div className="flex flex-col items-start">
          <span className="text-sm text-muted-foreground font-normal text-left">Compare to SecureBuild Images</span>
          <span className="text-xs text-muted-foreground">Loading vulnerability counts...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="absolute top-4 right-4 bg-blue-50 border border-blue-200 rounded px-3 py-1 text-xs flex flex-row items-start gap-2 shadow-sm">
      <Image
        src="/sb-192x192.png"
        alt="SecureBuild Logo"
        width={24}
        height={24}
        className="inline-block align-top rounded"
        style={{ minWidth: 24, minHeight: 24 }}
      />
      <div className="flex flex-col items-start">
        <span className="text-sm text-muted-foreground font-normal text-left">Compare to SecureBuild Images</span>
        {images.map((img, idx) => (
          <div key={img.id + '-' + idx}>
            <a
              href={`/images/${img.catalogSlug}`}
              className="text-sm text-muted-foreground hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {img.name}
            </a>
            {typeof vulnCounts[img.id] === 'number' ? (
              <span className="ml-2 text-xs text-muted-foreground">
                {vulnCounts[img.id]} vulnerability{vulnCounts[img.id] === 1 ? '' : 'ies'}
              </span>
            ) : (
              <span className="ml-2 text-xs text-muted-foreground">0 vulnerabilities</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
} 