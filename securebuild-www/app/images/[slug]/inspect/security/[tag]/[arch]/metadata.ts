import { Metadata } from "next"
import { getCatalogItemAction } from "@/lib/catalog/actions/get-catalog-item"

export async function generateMetadata({ 
  params 
}: { 
  params: Promise<{ slug: string; tag: string; arch: string }> 
}): Promise<Metadata> {
  const { slug, tag, arch } = await params

  try {
    const catalogItem = await getCatalogItemAction(undefined, slug)
    if (!catalogItem) {
      return {
        title: 'Security Analysis Not Found | SecureBuild',
        description: 'The requested security analysis could not be found.'
      }
    }

    const archDisplay = arch === 'x86_64' ? 'x86_64' : 'ARM64'
    const vulnCount = catalogItem.cvesFixedCount || 0
    const title = `${catalogItem.name} Security Analysis | ${vulnCount} Vulnerabilities Fixed | ${tag} ${archDisplay}`
    const description = `Security vulnerability analysis for ${catalogItem.name}:${tag} (${archDisplay}). ${vulnCount} vulnerabilities fixed compared to upstream. View detailed CVE comparison and security status.`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        images: [{
          url: '/sb-192x192.png',
          width: 192,
          height: 192,
          alt: 'SecureBuild'
        }],
      },
      twitter: {
        card: 'summary',
        title,
        description,
        images: ['/sb-192x192.png'],
      }
    }
  } catch {
    return {
      title: 'Security Analysis | SecureBuild',
      description: 'Security vulnerability analysis for secure container images.'
    }
  }
}