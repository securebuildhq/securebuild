import type { Metadata } from "next"

interface GenerateMetadataProps {
  params: Promise<{
    slug: string
    tag: string
    arch: string
  }>
}

export async function generateMetadata({ params }: GenerateMetadataProps): Promise<Metadata> {
  const { slug, tag, arch } = await params
  
  return {
    title: `Provenance - ${slug}:${tag} (${arch}) | SecureBuild`,
    description: `View the build provenance and supply chain security information for ${slug}:${tag} on ${arch} architecture. Includes SLSA compliance, source materials, and cryptographic verification.`,
    openGraph: {
      title: `Build Provenance - ${slug}:${tag}`,
      description: `Cryptographically verifiable build provenance for ${slug}:${tag} with SLSA Level 3 compliance.`,
      type: 'website',
      images: [
        {
          url: '/og-image-provenance.png',
          width: 1200,
          height: 630,
          alt: 'SecureBuild Provenance Information',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: `Build Provenance - ${slug}:${tag}`,
      description: `View cryptographically verified build provenance for ${slug}:${tag}`,
    },
    robots: {
      index: true,
      follow: true,
    },
  }
}