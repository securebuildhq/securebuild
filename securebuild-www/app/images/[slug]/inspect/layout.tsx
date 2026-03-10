import Link from "next/link"
import Image from "next/image"

import {
  Tag,
  Clock,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Package,
  Lock,
  Shield,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Navbar from "@/components/navbar"
import { getSession } from "@/lib/auth/session"
import { Image as SBImage } from "@/lib/types/image"
import { getImageByNameAction } from "@/lib/image/actions/get-image-by-name"
import { Subscription } from "@/lib/types/subscription"
import { listTeamSubscriptionsAction } from "@/lib/team/actions/list-subscriptions"
import { InspectProvider } from "./inspect-context"
import { TagArchitectureSelector } from "./tag-architecture-selector"
import { DynamicPullCommand } from "./dynamic-pull-command"
import { VulnerabilityCountDisplay } from "./vulnerability-count-display"
import { calculateFixedCVECountForImage } from "@/lib/image/image"

interface InspectLayoutProps {
  children: React.ReactNode
  params: Promise<{
    slug: string
  }>
}

export default async function InspectLayout({
  children,
  params,
}: InspectLayoutProps) {
    const session = await getSession()
  const { slug } = await params

  // Server-side data fetching first to get image default tag
  let image: SBImage | null = null
  let error: string | null = null
  let subscriptions: Subscription[] = []
  let hasImageAccess: boolean | null = null

  try {
    // Always fetch image data (session can be undefined)
    image = await getImageByNameAction(session ?? undefined, slug)

    // Only fetch subscriptions if user is authenticated
    if (session) {
      subscriptions = await listTeamSubscriptionsAction(session)

      if (image && subscriptions.length > 0) {
        hasImageAccess = subscriptions.some((sub) => sub.catalogItem?.id === image?.catalogItem?.id)
      } else {
        hasImageAccess = false
      }
    } else {
      // No session means no access to protected images
      hasImageAccess = false
    }
  } catch (err) {
    console.error("Failed to fetch image:", err)
    error = "Image not found or failed to load. Please check the image name and try again."
  }

  const defaultTag = image?.defaultTag || "latest"

  // Pre-calculate vulnerability counts for all tags (same as Tags page)
  const tagVulnerabilityCounts: Record<string, number> = {}
  if (image?.tags) {
    const vulnerabilityPromises = image.tags.map(async (tag) => {
      try {
        const count = await calculateFixedCVECountForImage(image.id, tag)
        return [tag, count] as const
      } catch (err) {
        console.error(`Error getting vulnerability count for tag ${tag}:`, err)
        return [tag, 0] as const
      }
    })

    const results = await Promise.all(vulnerabilityPromises)
    results.forEach(([tag, count]) => {
      tagVulnerabilityCounts[tag] = count
    })
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 py-8">
            <div className="text-center py-12">
              <div className="flex justify-center mb-4">
                <AlertTriangle className="h-16 w-16 text-red-500" />
              </div>
              <h1 className="text-2xl font-bold mb-4">Image Not Found</h1>
              <p className="text-muted-foreground mb-6">{error}</p>
              <Link href="/images">
                <Button>Browse Available Images</Button>
              </Link>
            </div>
          </div>
        </main>
      </div>
    )
  }

  if (!image || hasImageAccess === null) {
    return (
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 py-8">
            <div className="flex flex-col gap-6">
              <div className="h-6 w-48 bg-gray-200 animate-pulse rounded"></div>
              <div className="h-24 bg-gray-200 animate-pulse rounded"></div>
              <div className="h-12 bg-gray-200 animate-pulse rounded"></div>
              <div className="h-64 bg-gray-200 animate-pulse rounded"></div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12 py-8">
          <InspectProvider
            image={image}
            defaultTag={defaultTag}
            defaultArchitecture="x86_64"
            hasImageAccess={hasImageAccess}
            hasReadme={image.defaultTagReadme !== null}
            tagVulnerabilityCounts={tagVulnerabilityCounts}
          >
          <div className="flex flex-col gap-6">
            {/* Repository Header */}
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="shrink-0 w-16 h-16 md:w-24 md:h-24 bg-white dark:bg-gray-800 rounded-lg shadow-sm flex items-center justify-center p-2">
                <Image
                  src={image.catalogItem?.imageUrl || "/placeholder.svg?height=80&width=80&query=project%20logo"}
                  width={80}
                  height={80}
                  alt={`${image.catalogItem?.name} logo`}
                  className="object-contain"
                />
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h1 className="text-2xl font-bold">{image.catalogItem?.name}</h1>
                  {image.catalogItem?.isPartner && (
                    <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300 font-semibold">
                      ✓ Official Partner
                    </Badge>
                  )}
                </div>
                <div className="mb-4">
                  {image.catalogItem?.isPartner ? (
                    <div className="space-y-2">
                      <p className="text-muted-foreground">{image.catalogItem?.description}</p>
                      <p className="text-sm leading-relaxed">
                        <span className="inline-flex items-baseline gap-1 font-medium text-teal-700 dark:text-teal-300">
                          <Package className="h-4 w-4" />
                          Official Partner Image:
                        </span>
                        {" "}This image is created in partnership with the {image.catalogItem?.name} maintainers, ensuring enterprise-grade security with direct upstream support.
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">{image.catalogItem?.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-4 text-sm">
                  <div className="flex items-center gap-1">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    <span>{image.tags.length} tags</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {image.catalogItem?.lastBuiltAt
                        ? `Built ${new Date(image.catalogItem.lastBuiltAt).toLocaleString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}`
                        : "Build date unavailable"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <span>
                      {image.catalogItem?.lastScannedAt
                        ? `Scanned ${new Date(image.catalogItem.lastScannedAt).toLocaleString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}`
                        : "Scan date unavailable"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    <span><VulnerabilityCountDisplay /> vulnerabilities fixed</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2 w-full md:w-auto"></div>
            </div>

            {/* Security Score Card */}
            <Card className="bg-linear-to-r from-teal-50 to-blue-50 dark:from-teal-900/30 dark:to-blue-900/30 border-teal-100 dark:border-teal-800">
              <CardContent className="p-6">
                <div className="flex flex-col md:flex-row items-center gap-6">
                  <div className={`w-full grid grid-cols-1 sm:grid-cols-2 gap-6 ${image.catalogItem?.isPartner ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
                    <div className="flex flex-col items-center p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300 mb-3">
                        <CheckCircle2 className="h-6 w-6" />
                      </div>
                      <span className="text-base font-semibold"><VulnerabilityCountDisplay /> Vulnerabilities Fixed</span>
                    </div>
                    <div className="flex flex-col items-center p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300 mb-3">
                        <FileText className="h-6 w-6" />
                      </div>
                      <span className="text-base font-semibold">SBOM Available</span>
                    </div>
                    <div className="flex flex-col items-center p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300 mb-3">
                        <Lock className="h-6 w-6" />
                      </div>
                      <span className="text-base font-semibold">Signature Verified</span>
                    </div>
                    {image.catalogItem?.isPartner && (
                      <div className="flex flex-col items-center p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300 mb-3">
                          <Package className="h-6 w-6" />
                        </div>
                        <span className="text-base font-semibold">Official Partnership</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Pull Access / Subscribe Card */}
            {hasImageAccess === true ? (
              <DynamicPullCommand
                imageName={image.name}
                defaultTag={defaultTag}
              />
            ) : (
              <Card className="bg-linear-to-r from-blue-50 to-teal-50 dark:from-blue-900/30 dark:to-teal-900/30 border-blue-100 dark:border-blue-800 shadow-md">
                <CardContent className="py-8 flex flex-col items-center justify-center text-center gap-4">
                  <div className="flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-900 mb-2">
                    <Lock className="h-8 w-8 text-blue-600 dark:text-blue-300" />
                  </div>
                  <h2 className="text-xl font-bold">Pull Access Restricted</h2>
                  <p className="text-muted-foreground text-base max-w-md">Subscribe to unlock access and pull this image from our secure registry. Enjoy up-to-date, verified, and secure container images for your projects.</p>
                  <Link href={`/checkout/${slug}`} className="w-full sm:w-auto">
                    <Button variant="default" size="lg" className="w-full sm:w-auto transition-transform hover:scale-105">Subscribe</Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            {/* Main Tabs and Tag/Architecture Selector */}
            <TagArchitectureSelector
              slug={slug}
              image={image}
            />

            <div className="w-full">
              {children}
            </div>
          </div>
          </InspectProvider>
        </div>
      </main>
      <footer className="w-full py-6 md:py-12 bg-gray-100 dark:bg-gray-800">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
          <div className="flex flex-col items-center justify-center space-y-4 text-center">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
              <span className="text-xl font-bold">SecureBuild</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} SecureBuild. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
