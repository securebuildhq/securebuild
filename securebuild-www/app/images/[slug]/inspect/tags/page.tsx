import TagsPageClient from "@/app/images/[slug]/inspect/tags/client"

export { generateMetadata } from "./metadata"

interface TagsPageProps {
  params: Promise<{
    slug: string
  }>
}

export default async function TagsPage({ params }: TagsPageProps) {
  const { slug } = await params
  return <TagsPageClient slug={slug} />
}
