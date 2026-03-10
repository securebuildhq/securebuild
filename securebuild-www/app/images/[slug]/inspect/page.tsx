import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/session'
import { getImageByNameAction } from '@/lib/image/actions/get-image-by-name'

interface PageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function InspectPage({ params }: PageProps) {
  const session = await getSession()
  const { slug } = await params

  // Get the image to determine default tag
  let defaultTag = "latest"
  try {
    const image = await getImageByNameAction(session ?? undefined, slug)
    if (image?.defaultTag) {
      defaultTag = image.defaultTag
    }
  } catch {
    // Use latest as fallback if image fetch fails
  }

  redirect(`/images/${slug}/inspect/sbom/${defaultTag}/x86_64`)
}
