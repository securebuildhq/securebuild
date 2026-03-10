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
        title: 'SBOM Not Found | SecureBuild',
        description: 'The requested SBOM could not be found.'
      }
    }

    const archDisplay = arch === 'x86_64' ? 'x86_64' : 'ARM64'
    const title = `${catalogItem.name} SBOM | ${tag} ${archDisplay} | SecureBuild`
    const description = `Software Bill of Materials (SBOM) for ${catalogItem.name}:${tag} (${archDisplay}). View all components, dependencies, and licenses included in this secure container image.`

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
      title: 'SBOM | SecureBuild',
      description: 'Software Bill of Materials for secure container images.'
    }
  }
}