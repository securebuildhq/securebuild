import { notFound } from "next/navigation"
import Image from "next/image"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Check,
  Shield,
  AlertTriangle,
  Clock,
  Server,
  Search,
  CheckCircle2,
  Code2,
  Database,
  LayoutDashboard,
  DollarSign,
  CheckCircle,
  ThumbsUp,
  Layers,
} from "lucide-react"
import { getCatalogItemAction } from "@/lib/catalog/actions/get-catalog-item"
import { CatalogItem } from "@/lib/types/catalog"
import Navbar from "@/components/navbar"

type TestimonialData = {
  avatar?: string;
  author?: string;
  quote?: string;
  role?: string;
  company?: string;
}

type CatalogItemWithTestimonial = CatalogItem & {
  testimonial?: TestimonialData;
}
import { Metadata } from "next"
import { ProjectActions } from "@/components/ProjectActions"

// Generate metadata for SEO
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params

  try {
    const catalogItem = await getCatalogItemAction(undefined, slug)
    if (!catalogItem) {
      return {
        title: 'Project Not Found | SecureBuild',
        description: 'The requested project could not be found.'
      }
    }

    const vulnCount = catalogItem.cvesFixedCount || 0
    
    const title = catalogItem.isPartner 
      ? `${catalogItem.name} Official SecureBuild | ${vulnCount} Vulnerabilities Fixed`
      : `${catalogItem.name} SecureBuild | ${vulnCount} Vulnerabilities Fixed | Zero-CVE Container Image`
    
    const description = catalogItem.isPartner
      ? `The official secure build of ${catalogItem.name}, created in partnership with the ${catalogItem.name} maintainers. ${vulnCount} vulnerabilities fixed. Get enterprise-grade security with zero CVEs while directly supporting the open source project with 70% revenue share.`
      : `A secure, enterprise-grade build of ${catalogItem.name}, redistributed from the official open source release. ${vulnCount} vulnerabilities fixed. Get zero-CVE assurance and timely updates — all with no changes to upstream functionality.`

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: 'website',
        images: catalogItem.imageUrl ? [{
          url: catalogItem.imageUrl,
          width: 1200,
          height: 630,
          alt: `${catalogItem.name} - SecureBuild`
        }] : [{
          url: '/sb-192x192.png',
          width: 192,
          height: 192,
          alt: 'SecureBuild'
        }],
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: catalogItem.imageUrl ? [catalogItem.imageUrl] : ['/sb-192x192.png'],
      }
    }
  } catch {
    return {
      title: 'Project Not Found | SecureBuild',
      description: 'The requested project could not be found.'
    }
  }
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let catalogItem: CatalogItem | null = null

  try {
    catalogItem = await getCatalogItemAction(undefined, slug)
  } catch (error) {
    console.error("Failed to fetch catalog item:", error)
  }

  if (!catalogItem) {
    notFound()
  }

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price)
  }


  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main className="flex-1">
        {/* Project Hero Section */}
        <section className="w-full py-12 md:py-24 bg-linear-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-12 xl:grid-cols-[1fr_500px]">
              <div className="flex flex-col justify-center space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {catalogItem.isPartner && (
                      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900">
                        Official
                      </Badge>
                    )}
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-900">
                      Secure
                    </Badge>
                  </div>
                  <h1 className="text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl">
                    {catalogItem.name} SecureBuild
                  </h1>
                  <p className="max-w-[600px] text-muted-foreground md:text-xl">
                    {catalogItem.isPartner ? (
                      <>
                        The official secure build of {catalogItem.name}, created in partnership with the {catalogItem.name}{" "}
                        maintainers. Get enterprise-grade security with zero CVEs while directly supporting the open source
                        project with 70% of subscription revenue going to maintainers.
                      </>
                    ) : (
                      <>
                        A secure, enterprise-grade build of {catalogItem.name}, redistributed from the official open source
                        release. Get zero-CVE assurance and timely updates — all with no changes to upstream functionality.
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-4 pt-4">
                  <div className="flex items-center gap-2">
                    <Shield className="h-5 w-5 text-teal-600" />
                    <span className="text-sm font-medium">{catalogItem.cvesFixedCount} vulnerabilities fixed</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    <span className="text-sm font-medium">Daily security scans</span>
                  </div>
                </div>
                <ProjectActions catalogItem={catalogItem} slug={slug} />
              </div>
              <div className="flex items-center justify-center lg:justify-end">
                <div className="relative h-[300px] w-[300px] md:h-[400px] md:w-[400px] bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 flex items-center justify-center">
                  <Image
                    src={catalogItem.imageUrl || "/placeholder.svg"}
                    width={300}
                    height={300}
                    alt={`${catalogItem.name} logo`}
                    className="object-contain"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Official Partnership Announcement */}
        <section className="w-full py-8 md:py-12 bg-linear-to-r from-blue-50 via-blue-100 to-blue-50 dark:from-blue-950 dark:via-blue-900 dark:to-blue-950">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="flex flex-col items-center text-center space-y-6">
              <div className="inline-flex items-center justify-center p-2 bg-blue-100 dark:bg-blue-800 rounded-full"></div>
              <div className="space-y-2 max-w-3xl mx-auto">
                {catalogItem.isAlternativeBuild && catalogItem.isPartner && (
                  <>
                    <h2 className="text-2xl md:text-3xl font-bold text-blue-700 dark:text-blue-300">
                      Officially Endorsed Secure Build of {catalogItem.name}
                    </h2>
                    <p className="text-blue-600 dark:text-blue-200 text-lg">
                      This secure build is officially endorsed by the {catalogItem.name} maintainers as an alternative
                      distribution focused on enterprise security. While the open source version continues to evolve
                      rapidly, our SecureBuild provides enhanced security and stability for production environments.
                    </p>
                  </>
                )}
                {!catalogItem.isAlternativeBuild && catalogItem.isPartner && (
                  <>
                    <h2 className="text-2xl md:text-3xl font-bold text-blue-700 dark:text-blue-300">
                      The Only Official Stable Build of {catalogItem.name}
                    </h2>
                    <p className="text-blue-600 dark:text-blue-200 text-lg">
                      This is the only official stable SecureBuild endorsed by the {catalogItem.name} maintainers. While the
                      open source version is constantly evolving, our SecureBuild provides a thoroughly tested, stable
                      release with enterprise-grade security and reliability.
                    </p>
                  </>
                )}
                {catalogItem.isAlternativeBuild && !catalogItem.isPartner && (
                  <>
                    <h2 className="text-2xl md:text-3xl font-bold text-blue-700 dark:text-blue-300">
                      A Secure Build of {catalogItem.name}
                    </h2>
                    <p className="text-blue-600 dark:text-blue-200 text-lg">
                      This is a secure build of {catalogItem.name}, redistributed from the official open source release.
                      Get zero-CVE assurance and timely updates — all with no changes to upstream functionality.
                    </p>
                  </>
                )}
              </div>

              {/* Only show features box for partners */}
              {catalogItem.isPartner && (
              <div className="w-full max-w-4xl bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mt-4">
                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                  {catalogItem.isAlternativeBuild ? (
                    <>
                      <div className="flex items-start gap-3 text-left">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300">
                          <ThumbsUp className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-medium">Maintainer Endorsed</h3>
                          <p className="text-sm text-muted-foreground">
                            Officially endorsed by the {catalogItem.name} maintainers for enterprise use
                          </p>
                        </div>
                      </div>
                      <div className="h-px w-full md:h-16 md:w-px bg-gray-200 dark:bg-gray-700"></div>
                      <div className="flex items-start gap-3 text-left">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                          <Shield className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-medium">Enhanced Security</h3>
                          <p className="text-sm text-muted-foreground">
                            Enterprise-grade security with zero CVEs and daily vulnerability scanning
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-start gap-3 text-left">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300">
                          <CheckCircle className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-medium">Only Stable Release</h3>
                          <p className="text-sm text-muted-foreground">
                            The only {catalogItem.name} build that undergoes rigorous stability testing for production use
                          </p>
                        </div>
                      </div>
                      <div className="h-px w-full md:h-16 md:w-px bg-gray-200 dark:bg-gray-700"></div>
                      <div className="flex items-start gap-3 text-left">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                          <Shield className="h-5 w-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-medium">Official Partnership</h3>
                          <p className="text-sm text-muted-foreground">
                            Created with and endorsed by the core {catalogItem.name} maintainers
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8 pt-4 w-full max-w-3xl">
                <div className="flex flex-col items-center p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                    {catalogItem.cvesFixedCount}
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">Vulnerabilities Fixed</div>
                </div>
                { catalogItem.isPartner && (
                <div className="flex flex-col items-center p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">70%</div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">Revenue to Maintainers</div>
                </div>
                )}
                <div className="flex flex-col items-center p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">Daily</div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">Security Scans</div>
                </div>
                <div className="flex flex-col items-center p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm">
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400">100%</div>
                  <div className="text-sm text-gray-600 dark:text-gray-300">Production Ready</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="w-full py-12 md:py-24 bg-gray-50 dark:bg-gray-900">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="flex flex-col items-center justify-center space-y-4 text-center mb-12">
              <div className="space-y-2">
                <div className="inline-block rounded-lg bg-teal-100 dark:bg-teal-900 px-3 py-1 text-sm text-teal-600 dark:text-teal-300">
                  SecureBuild Benefits
                </div>
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">
                  Comprehensive Security for {catalogItem.name}
                </h2>
                <p className="max-w-[900px] text-muted-foreground md:text-xl">
                  Our secure builds provide enterprise-grade security with direct support for the open source community.
                </p>
              </div>
            </div>

            <div className="mx-auto max-w-6xl">
              {/* Top row with highlighted benefits */}
              <div className="grid gap-6 md:grid-cols-3 mb-8">
                <Card className="transition-all duration-200 hover:shadow-md border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                        <Shield className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-blue-700 dark:text-blue-300">0 CVE Dependency Graph</h3>
                        <p className="mt-2 text-blue-600 dark:text-blue-200">
                          Automatically rebuilt when any upstream projects are patched to maintain zero vulnerabilities
                          in your entire dependency chain.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="transition-all duration-200 hover:shadow-md border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                        <Clock className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-blue-700 dark:text-blue-300">CVE Remediation SLA</h3>
                        <p className="mt-2 text-blue-600 dark:text-blue-200">
                          6 days for Critical CVEs, 13 days for High/Medium/Low vulnerabilities, ensuring your
                          deployments are always protected.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="transition-all duration-200 hover:shadow-md border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                        <Code2 className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-blue-700 dark:text-blue-300">All Stable Versions</h3>
                        <p className="mt-2 text-blue-600 dark:text-blue-200">
                          Support for all stable versions with long-term maintenance and security updates, ensuring
                          compatibility with your existing systems.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Remaining benefits grid */}
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card className="transition-all duration-200 hover:shadow-md">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                        <Server className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">Pure Distroless Images</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Minimal attack surface with pure distroless or minimal container images.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="transition-all duration-200 hover:shadow-md">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                        <Database className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">Build-time SBOMs</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Comprehensive Software Bill of Materials generated at build time for complete transparency.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="transition-all duration-200 hover:shadow-md">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                        <Search className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">Scanner Support</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Compatible with all major security scanners for seamless integration into your security
                          workflow.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="transition-all duration-200 hover:shadow-md">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                        <Layers className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">Drop-in Replacement</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Matching tags, entry points, and configuration - no changes needed to your existing deployments.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="transition-all duration-200 hover:shadow-md">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                        <CheckCircle2 className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">SLSA Level 3 Infrastructure</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Supply chain security with SLSA Level 3 compliant build infrastructure.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="transition-all duration-200 hover:shadow-md">
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                        <LayoutDashboard className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-medium">SecureBuild Console</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Manage images, entitlements, pull tokens, and more through our intuitive console.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Revenue Sharing Card */}
              {catalogItem.isPartner && (
              <Card className="mt-8 border-2 border-teal-200 dark:border-teal-800 transition-all duration-200 hover:shadow-md">
                <CardContent className="p-6">
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                      <DollarSign className="h-6 w-6" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-xl font-medium">Secure, Stable, Sustainable Open Source</h3>
                      <p className="mt-2 text-muted-foreground">
                        <span className="font-semibold text-teal-600 dark:text-teal-400">70%</span> of subscription
                        revenue goes directly to the project maintainers, while
                        <span className="font-semibold text-teal-600 dark:text-teal-400"> 30%</span> goes to SecureBuild
                        for maintaining the secure pipeline & dependency graph and for handling the commercial
                        relationship.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              )}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section className="w-full py-12 md:py-16 border-t border-b">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <h2 className="text-2xl font-bold">Pricing</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Card className="border-2 border-teal-600">
                    <CardHeader>
                      <CardTitle>Monthly Subscription</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">
                        {formatPrice(catalogItem.pricing.monthly)}
                        <span className="text-base font-normal text-muted-foreground">/month</span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">Month-to-month subscription</p>
                      <Button className="mt-4 w-full bg-teal-600 hover:bg-teal-700" asChild>
                        <Link href={`/checkout/${slug}`}>Subscribe Monthly</Link>
                      </Button>
                    </CardContent>
                  </Card>
                  {/* <Card>
                    <CardHeader>
                      <CardTitle>Annual Subscription</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold">
                        {formatPrice(catalogItem.pricing.yearly)}
                        <span className="text-base font-normal text-muted-foreground">/year</span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Save{" "}
                        {Math.round(
                          ((catalogItem.pricing.monthly * 12 - catalogItem.pricing.yearly) / (catalogItem.pricing.monthly * 12)) *
                            100,
                        )}
                        % with annual billing
                      </p>
                      <Button className="mt-4 w-full">Subscribe Annually</Button>
                    </CardContent>
                  </Card> */}
                </div>
              </div>
              <div className="space-y-4">
                <h2 className="text-2xl font-bold">What&apos;s Included</h2>
                <ul className="space-y-2">
                  <li className="flex items-start gap-2">
                    <Check className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                    <span>Daily secure builds with all vulnerabilities fixed</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                    <span>Compliance documentation for security requirements</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                    <span>Email notifications for critical security updates</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                    <span>Email support for security-related questions</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Testimonial Section */}
        {(catalogItem as CatalogItemWithTestimonial).testimonial && (
          <section className="w-full py-12 md:py-16 bg-gray-50 dark:bg-gray-900">
            <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
              <div className="flex flex-col items-center justify-center space-y-4 text-center mb-8">
                <div className="space-y-2">
                  <div className="inline-block rounded-lg bg-teal-100 dark:bg-teal-900 px-3 py-1 text-sm text-teal-600 dark:text-teal-300">
                    From the Maintainers
                  </div>
                  <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Why we partnered with SecureBuild</h2>
                </div>
              </div>

              <div className="mx-auto max-w-4xl">
                <Card className="transition-all duration-200 hover:shadow-md border-2 border-teal-100 dark:border-teal-900">
                  <CardContent className="p-8">
                    <div className="flex flex-col items-center text-center space-y-6">
                      <div className="relative h-20 w-20 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <Image
                          src={(catalogItem as CatalogItemWithTestimonial).testimonial?.avatar || "/placeholder.svg"}
                          alt={(catalogItem as CatalogItemWithTestimonial).testimonial?.author || ""}
                          fill
                          className="object-cover"
                        />
                      </div>
                      <div className="space-y-2">
                        <p className="text-lg md:text-xl italic text-muted-foreground">&quot;{(catalogItem as CatalogItemWithTestimonial).testimonial?.quote}&quot;</p>
                        <div>
                          <p className="font-semibold">{(catalogItem as CatalogItemWithTestimonial).testimonial?.author}</p>
                          <p className="text-sm text-muted-foreground">
                            {(catalogItem as CatalogItemWithTestimonial).testimonial?.role}, {(catalogItem as CatalogItemWithTestimonial).testimonial?.company}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full py-6 md:py-12 bg-gray-100 dark:bg-gray-800">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
          <div className="flex flex-col items-center justify-center space-y-4 text-center">
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-teal-600" />
              <span className="text-xl font-bold">SecureBuild</span>
            </div>
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} SecureBuild. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
