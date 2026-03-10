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
        title: 'README Not Found | SecureBuild',
        description: 'The requested image documentation could not be found.'
      }
    }

    const title = `${catalogItem.name} Documentation | SecureBuild`
    const description = `View documentation and usage information for ${catalogItem.name} secure container images. Learn how to use, configure, and deploy these hardened, vulnerability-free images.`

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
      title: 'Image Documentation | SecureBuild',
      description: 'Documentation for secure container images.'
    }
  }
}
