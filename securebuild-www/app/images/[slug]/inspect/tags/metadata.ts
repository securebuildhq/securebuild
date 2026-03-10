import { Metadata } from "next"
import { getCatalogItemAction } from "@/lib/catalog/actions/get-catalog-item"

export async function generateMetadata({ 
  params 
}: { 
  params: Promise<{ slug: string }> 
}): Promise<Metadata> {
  const { slug } = await params

  try {
    const catalogItem = await getCatalogItemAction(undefined, slug)
    if (!catalogItem) {
      return {
        title: 'Tags Not Found | SecureBuild',
        description: 'The requested image tags could not be found.'
      }
    }

    const title = `${catalogItem.name} Available Tags | SecureBuild`
    const description = `View all available tags and versions for ${catalogItem.name} secure container images. Each tag is hardened, scanned daily, and maintained with zero CVEs.`

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
      title: 'Image Tags | SecureBuild',
      description: 'Available tags for secure container images.'
    }
  }
}