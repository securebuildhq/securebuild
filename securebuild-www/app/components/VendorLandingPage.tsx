"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import Navbar from "@/components/navbar"
import { useEffect, useState } from "react"
import { CatalogItem } from "@/lib/types/catalog"
import { listFeaturedCatalogItemsAction } from "@/lib/catalog/actions/list-featured-catalog-items"
import { CatalogItemCard } from "./CatalogItemCard"
import { CatalogItemCardSkeleton } from "./CatalogItemCardSkeleton"
import { LaunchVideosToggle } from "@/components/launch-videos-toggle"
import {
  Shield,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Lock,
  Zap,
  Code,
  Package,
  Bell,
  Webhook,
  ChevronRight,
} from "lucide-react"

interface VendorLandingPageProps {
  activePath: "vendors" | "projects"
  setActivePath: (path: "vendors" | "projects") => void
}

export default function VendorLandingPage({ activePath, setActivePath }: VendorLandingPageProps) {
  const [featuredItems, setFeaturedItems] = useState<CatalogItem[]>([]);
  const [loadingFeaturedItems, setLoadingFeaturedItems] = useState(true);

  useEffect(() => {
    const fetchFeaturedItems = async () => {
      const featuredItems = await listFeaturedCatalogItemsAction();
      setFeaturedItems(featuredItems);
      setLoadingFeaturedItems(false);
    }
    fetchFeaturedItems();
  }, []);
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar pageType="vendor" />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="w-full py-6 md:py-12 lg:py-12 xl:py-16 bg-linear-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
          <div className="container mx-auto max-w-6xl px-4 md:px-6 lg:px-8 xl:px-12">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div className="space-y-6">
                <div className="flex items-center justify-start gap-2 mb-4">
                  <Button
                    variant={activePath === "vendors" ? "default" : "outline"}
                    onClick={() => setActivePath("vendors")}
                    size="sm"
                    className={
                      activePath === "vendors"
                        ? "bg-teal-600 hover:bg-teal-700 text-white"
                        : "hover:bg-teal-50 dark:hover:bg-teal-950"
                    }
                  >
                    For Software Vendors
                  </Button>
                  <Button
                    variant={activePath === "projects" ? "default" : "outline"}
                    onClick={() => setActivePath("projects")}
                    size="sm"
                    className={
                      activePath === "projects"
                        ? "bg-teal-600 hover:bg-teal-700 text-white"
                        : "hover:bg-teal-50 dark:hover:bg-teal-950"
                    }
                  >
                    For Open Source Projects
                  </Button>
                </div>
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-balance">
                  Develop Secure Software with <span className="text-teal-600">Zero-CVE Images</span>
                </h1>
                <p className="text-lg md:text-xl text-muted-foreground text-pretty">
                  Package your applications with vulnerability-free container images. SecureBuild automatically rebuilds
                  from source whenever CVEs are resolved in upstream dependencies, ensuring your customers always run secure
                  infrastructure.
                </p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Button asChild size="lg" className="bg-teal-600 hover:bg-teal-700 text-base">
                    <Link href="/enterprise">
                      Request a Demo <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" className="text-base bg-transparent">
                    <Link href="#how-it-works">See How It Works</Link>
                  </Button>
                </div>
              </div>

              {/* CVE Report Card */}
              <div className="relative">
                <div className="absolute inset-0 bg-linear-to-r from-teal-500/20 to-blue-500/20 blur-3xl" />
                <Card className="relative border-2 shadow-xl">
                  <CardHeader className="bg-slate-900 text-white">
                    <CardTitle className="text-center text-2xl">CVE REPORT</CardTitle>
                  </CardHeader>
                  <CardContent className="p-8 space-y-6">
                    <div className="flex items-center justify-center gap-4">
                      <div className="h-20 w-20 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                        <CheckCircle2 className="h-10 w-10 text-teal-600" />
                      </div>
                      <div>
                        <div className="text-4xl font-bold">0 CVEs</div>
                        <div className="text-muted-foreground">Found</div>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Image:</span>
                        <span className="font-mono">postgres:16.2</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Scanned:</span>
                        <span>1 hr ago</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Build Source:</span>
                        <span className="font-mono">Verified</span>
                      </div>
                    </div>
                    <div className="h-2 bg-linear-to-r from-teal-500 to-blue-500 rounded-full" />
                    <div className="text-center font-semibold text-teal-600">Scan Complete</div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="w-full py-8 md:py-12 lg:py-16 bg-gray-50 dark:bg-gray-900">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">How It Works</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
              SecureBuild continuously monitors upstream dependencies and rebuilds images from source whenever
              vulnerabilities are patched
            </p>
          </div>

            <div className="grid md:grid-cols-3 gap-8 mb-12">
              <Card className="border-2">
                <CardHeader>
                  <div className="h-12 w-12 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mb-4">
                    <RefreshCw className="h-6 w-6 text-teal-600" />
                  </div>
                  <CardTitle>1. Continuous Monitoring</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    We monitor all upstream dependencies for CVE disclosures and security patches in real-time across
                    thousands of open source projects.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader>
                  <div className="h-12 w-12 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mb-4">
                    <Code className="h-6 w-6 text-teal-600" />
                  </div>
                  <CardTitle>2. Rebuild from Source</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    When a CVE is resolved, we automatically rebuild affected images from source on trusted hardware with
                    full attestations and SBOMs.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-2">
                <CardHeader>
                  <div className="h-12 w-12 rounded-lg bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mb-4">
                    <Package className="h-6 w-6 text-teal-600" />
                  </div>
                  <CardTitle>3. Zero-CVE Delivery</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">
                    Produces vulnerability-free images that can be packaged with your software, reducing
                    critical application infrastructure risk.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Visual Flow Diagram */}
            <div className="bg-white dark:bg-slate-800 rounded-lg p-8 border-2">
              <div className="grid md:grid-cols-5 gap-4 items-center">
                <div className="text-center">
                  <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-2">
                    <span className="text-2xl font-bold text-red-600">!</span>
                  </div>
                  <p className="text-sm font-medium">CVE Disclosed</p>
                </div>
                <div className="hidden md:block text-center">
                  <ArrowRight className="h-6 w-6 mx-auto text-muted-foreground" />
                </div>
                <div className="text-center">
                  <div className="h-16 w-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-2">
                    <RefreshCw className="h-8 w-8 text-blue-600" />
                  </div>
                  <p className="text-sm font-medium">Auto Rebuild</p>
                </div>
                <div className="hidden md:block text-center">
                  <ArrowRight className="h-6 w-6 mx-auto text-muted-foreground" />
                </div>
                <div className="text-center">
                  <div className="h-16 w-16 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mx-auto mb-2">
                    <CheckCircle2 className="h-8 w-8 text-teal-600" />
                  </div>
                  <p className="text-sm font-medium">0 CVE Image</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Notifications & Integration Section */}
        <section className="w-full py-6 md:py-10">
          <div className="container mx-auto max-w-6xl px-4 md:px-6 lg:px-8 xl:px-12">
            <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Integrate with Your Pipeline</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
              Get notified when images are updated and automatically trigger rebuilds in your CI/CD pipeline
            </p>
          </div>

            <div className="grid md:grid-cols-2 gap-8 items-start">
              <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Bell className="h-6 w-6 text-teal-600 shrink-0" />
                  <span>Real-Time Notifications</span>
                </CardTitle>
                <CardDescription>Stay informed when base images are updated with new security patches</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Webhook Integration</p>
                      <p className="text-sm text-muted-foreground">
                        Trigger automated rebuilds in GitHub Actions, GitLab CI, or any CI/CD platform
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Email Alerts</p>
                      <p className="text-sm text-muted-foreground">
                        Get notified about critical security updates that affect your images
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium">Slack/Teams Integration</p>
                      <p className="text-sm text-muted-foreground">
                        Keep your team informed with real-time updates in your communication tools
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Webhook className="h-6 w-6 text-teal-600 shrink-0" />
                  <span>Automated Pipeline Integration</span>
                </CardTitle>
                <CardDescription>
                  Seamlessly integrate SecureBuild into your existing build and deployment workflows
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-slate-900 text-slate-50 p-4 rounded-lg font-mono text-xs overflow-x-auto">
                  <div className="text-slate-400"># GitHub Actions Example</div>
                  <div className="mt-2">on:</div>
                  <div className="ml-2">repository_dispatch:</div>
                  <div className="ml-4">types: [base-image-updated]</div>
                  <div className="mt-2">jobs:</div>
                  <div className="ml-2">rebuild:</div>
                  <div className="ml-4">runs-on: ubuntu-latest</div>
                  <div className="ml-4">steps:</div>
                  <div className="ml-6">- uses: actions/checkout@v4</div>
                  <div className="ml-6">- name: Rebuild with new base</div>
                  <div className="ml-8">run: docker build -t app .</div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Configure webhooks to automatically trigger rebuilds when SecureBuild updates your base images with
                  security patches. Works with any CI/CD platform that supports webhooks.
                </p>
              </CardContent>
            </Card>
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section id="benefits" className="w-full py-8 md:py-12 lg:py-16 bg-gray-50 dark:bg-gray-900">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Why Software Vendors Choose SecureBuild</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
              Deliver secure software without the overhead of managing container security
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Lock className="h-6 w-6 text-teal-600 shrink-0" />
                  <span>Enterprise-Grade Security</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">
                    Zero-CVE guarantee for all images with continuous vulnerability monitoring
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">
                    Built from source on trusted hardware with full supply chain attestations
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">
                    Comprehensive SBOMs (Software Bill of Materials) for compliance and auditing
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Zap className="h-6 w-6 text-teal-600 shrink-0" />
                  <span>Reduce Operational Overhead</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">
                    No need to maintain your own container security infrastructure
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">Automatic rebuilds when upstream dependencies are patched</p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">Focus on your product while we handle container security</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Shield className="h-6 w-6 text-teal-600 shrink-0" />
                  <span>Customer Trust & Compliance</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">
                    Meet enterprise security requirements and pass security audits
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">
                    Demonstrate commitment to security with verifiable zero-CVE images
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">Reduce customer security concerns and accelerate sales cycles</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Package className="h-6 w-6 text-teal-600 shrink-0" />
                  <span>Flexible Integration</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">Drop-in replacement for standard container images</p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">Compatible with all major container orchestration platforms</p>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-5 w-5 text-teal-600 mt-0.5 shrink-0" />
                  <p className="text-muted-foreground">Integrate with your existing CI/CD and deployment workflows</p>
                </div>
              </CardContent>
            </Card>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="w-full py-8 md:py-12 lg:py-16">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
          <Card className="border-2 bg-linear-to-br from-teal-50 to-blue-50 dark:from-teal-950/30 dark:to-blue-950/30">
            <CardContent className="p-8 md:p-12 text-center space-y-6">
              <h2 className="text-3xl md:text-4xl font-bold text-balance">
                Ready to Deliver Zero-CVE Images to Your Customers?
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
                Join leading software vendors who trust SecureBuild to secure their applications. Schedule a demo to see
                how we can help you reduce infrastructure vulnerabilities.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button asChild size="lg" className="bg-teal-600 hover:bg-teal-700 text-base">
                  <Link href="/enterprise">
                    Request a Demo <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="text-base bg-transparent">
                  <Link href="/images">Browse Available Images</Link>
                </Button>
              </div>
            </CardContent>
            </Card>
          </div>
        </section>

        {/* Featured Projects Section */}
        <section id="featured-projects" className="w-full py-6 md:py-10">
          <div className="container mx-auto max-w-6xl px-4 md:px-6 lg:px-8 xl:px-12">
            <div className="flex flex-col items-center justify-center space-y-4 text-center mb-6">
              <div className="space-y-2">
                <div className="inline-block rounded-lg bg-teal-100 dark:bg-teal-900 px-3 py-1 text-sm text-teal-600 dark:text-teal-300">
                  Featured Projects
                </div>
                <h2 className="text-2xl font-bold tracking-tighter sm:text-3xl md:text-4xl">Popular Secure Builds</h2>
                <p className="max-w-[900px] text-muted-foreground text-sm sm:text-base md:text-xl">
                  Explore some of our most popular secure builds for open source projects.
                </p>
              </div>
            </div>

            <Carousel
              opts={{
                align: "start",
                loop: true,
              }}
              className="w-full max-w-5xl mx-auto"
            >
              <CarouselContent className="-ml-2 md:-ml-4">
                {loadingFeaturedItems ? (
                  <>
                    <CarouselItem className="pl-2 md:pl-4 basis-1/2 sm:basis-1/2 lg:basis-1/3">
                      <CatalogItemCardSkeleton />
                    </CarouselItem>
                    <CarouselItem className="pl-2 md:pl-4 basis-1/2 sm:basis-1/2 lg:basis-1/3">
                      <CatalogItemCardSkeleton />
                    </CarouselItem>
                    <CarouselItem className="pl-2 md:pl-4 basis-1/2 sm:basis-1/2 lg:basis-1/3">
                      <CatalogItemCardSkeleton />
                    </CarouselItem>
                  </>
                ) : (
                  featuredItems.map((item) => (
                    <CarouselItem key={item.id} className="pl-2 md:pl-4 basis-1/2 sm:basis-1/2 lg:basis-1/3">
                      <CatalogItemCard project={item} />
                    </CarouselItem>
                  ))
                )}
              </CarouselContent>
              <CarouselPrevious className="hidden sm:flex -left-8 lg:-left-12" />
              <CarouselNext className="hidden sm:flex -right-8 lg:-right-12" />
            </Carousel>

            <div className="flex justify-center mt-6 sm:mt-8">
              <Button asChild variant="outline" className="text-sm sm:text-base">
                <Link href="/images">
                  View All Secure Builds
                  <ChevronRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>

        {/* Launch Videos Section */}
        <section id="launch-videos" className="w-full py-6 md:py-10 lg:py-14 bg-gray-50 dark:bg-gray-900">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="flex flex-col items-center justify-center space-y-4 text-center">
              <div className="space-y-2">
                <div className="inline-block rounded-lg bg-teal-100 dark:bg-teal-900 px-3 py-1 text-sm text-teal-600 dark:text-teal-300">
                  Launch Videos
                </div>
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Our odd mix of explainer videos</h2>
                <p className="max-w-[900px] text-muted-foreground md:text-xl">
                  (If you&apos;re as weird as we are, you&apos;ll love them!)
                </p>
              </div>
            </div>

            {/* Initial videos */}
            <div className="mx-auto grid max-w-6xl gap-6 py-6 grid-cols-2 md:grid-cols-3">
              <Card className="transition-all duration-200 hover:shadow-md overflow-hidden">
                <CardContent className="p-0">
                  <div className="aspect-video">
                    <iframe
                      width="100%"
                      height="100%"
                      src="https://www.youtube.com/embed/qI5ZKQQFS-U"
                      title="Enterprise Factory Tour"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="rounded-t-lg"
                    ></iframe>
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-lg mb-2">Enterprise Factory Tour</h3>
                    <p className="text-sm text-muted-foreground">
                      Take a behind-the-scenes tour of how SecureBuild creates enterprise-grade secure builds at scale.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="transition-all duration-200 hover:shadow-md overflow-hidden">
                <CardContent className="p-0">
                  <div className="aspect-video">
                    <iframe
                      width="100%"
                      height="100%"
                      src="https://www.youtube.com/embed/5suOV6FYRtg"
                      title="Solving CVE Wack-a-Mole"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="rounded-t-lg"
                    ></iframe>
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-lg mb-2">Solving CVE Wack-a-Mole</h3>
                    <p className="text-sm text-muted-foreground">
                      How enterprises can stop playing CVE whack-a-mole and achieve sustainable security with SecureBuild.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="hidden md:block transition-all duration-200 hover:shadow-md overflow-hidden">
                <CardContent className="p-0">
                  <div className="aspect-video">
                    <iframe
                      width="100%"
                      height="100%"
                      src="https://www.youtube.com/embed/RFcT5vfuQss"
                      title="Jazzy Launch Jingle"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="rounded-t-lg"
                    ></iframe>
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-lg mb-2">Jazzy Launch Jingle</h3>
                    <p className="text-sm text-muted-foreground">
                      A fun, musical celebration of SecureBuild partnerships and the joy of secure, sustainable open source.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* View All Videos Button */}
            <LaunchVideosToggle />

            {/* Expanded Videos Section (Hidden by Default) */}
            <div id="expanded-videos" className="hidden">
              <div className="mx-auto grid max-w-6xl gap-6 py-6 md:grid-cols-3">
                {/* Row 1 */}
                <Card className="transition-all duration-200 hover:shadow-md overflow-hidden">
                  <CardContent className="p-0">
                    <div className="aspect-video">
                      <iframe
                        width="100%"
                        height="100%"
                        src="https://www.youtube.com/embed/SeAonKQcOeU"
                        title="SecureBuild Partner Intro"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="rounded-t-lg"
                      ></iframe>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-lg mb-2">SecureBuild Partner Intro</h3>
                      <p className="text-sm text-muted-foreground">
                        Your friendly introduction to becoming a SecureBuild partner and how it benefits your open source project.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="transition-all duration-200 hover:shadow-md overflow-hidden">
                  <CardContent className="p-0">
                    <div className="aspect-video">
                      <iframe
                        width="100%"
                        height="100%"
                        src="https://www.youtube.com/embed/qmqB8FazZFc"
                        title="SecureBuild Slaps!"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="rounded-t-lg"
                      ></iframe>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-lg mb-2">SecureBuild Slaps!</h3>
                      <p className="text-sm text-muted-foreground">
                        An energetic showcase of why SecureBuild is awesome and how it&apos;s changing the open source security game.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="transition-all duration-200 hover:shadow-md overflow-hidden">
                  <CardContent className="p-0">
                    <div className="aspect-video">
                      <iframe
                        width="100%"
                        height="100%"
                        src="https://www.youtube.com/embed/-OV5nhzGXsA"
                        title="Open Source Monetization"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="rounded-t-lg"
                      ></iframe>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-lg mb-2">Open Source Monetization</h3>
                      <p className="text-sm text-muted-foreground">
                        Exploring sustainable monetization strategies for open source projects through security partnerships.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Row 2 */}
                <Card className="transition-all duration-200 hover:shadow-md overflow-hidden">
                  <CardContent className="p-0">
                    <div className="aspect-video">
                      <iframe
                        width="100%"
                        height="100%"
                        src="https://www.youtube.com/embed/TVn3WKOmxnM"
                        title="Profiting on Open Source"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="rounded-t-lg"
                      ></iframe>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-lg mb-2">Profiting on Open Source</h3>
                      <p className="text-sm text-muted-foreground">
                        How maintainers can ethically profit from their open source work while keeping their projects free.
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <Card className="transition-all duration-200 hover:shadow-md overflow-hidden">
                  <CardContent className="p-0">
                    <div className="aspect-video">
                      <iframe
                        width="100%"
                        height="100%"
                        src="https://www.youtube.com/embed/c7K_Nc79V8M"
                        title="What&apos;s a CVE?"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="rounded-t-lg"
                      ></iframe>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-lg mb-2">What&apos;s a CVE?</h3>
                      <p className="text-sm text-muted-foreground">
                        A beginner-friendly introduction to CVEs (Common Vulnerabilities and Exposures) and why they matter.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="w-full py-8 md:py-12 lg:py-16">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="flex flex-col items-center justify-center space-y-4 text-center mb-6">
              <div className="space-y-2">
                <div className="inline-block rounded-lg bg-teal-100 dark:bg-teal-900 px-3 py-1 text-sm text-teal-600 dark:text-teal-300">
                  FAQ
                </div>
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Frequently Asked Questions</h2>
                <p className="max-w-[900px] text-muted-foreground md:text-xl">
                  Common questions about using SecureBuild for your software products.
                </p>
              </div>
            </div>

            <div className="mx-auto max-w-3xl">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger>How do I integrate SecureBuild images into my product?</AccordionTrigger>
                  <AccordionContent>
                    SecureBuild images are drop-in replacements for standard container images. Simply update your 
                    Dockerfile or deployment manifests to reference our registry instead of Docker Hub or other registries. 
                    Our images maintain compatibility with the original images while providing zero-CVE guarantees.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-2">
                  <AccordionTrigger>What&apos;s included in the pricing?</AccordionTrigger>
                  <AccordionContent>
                    Pricing includes access to continuously updated zero-CVE images, automatic rebuilds when vulnerabilities 
                    are patched, webhook notifications, SBOMs, and full attestations. Enterprise plans include volume 
                    discounts, custom builds, and redistribution rights for packaging with your products.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-3">
                  <AccordionTrigger>Can I redistribute SecureBuild images with my product?</AccordionTrigger>
                  <AccordionContent>
                    Yes! Enterprise customers receive redistribution rights, allowing you to package and distribute 
                    SecureBuild images alongside your software products. Contact our sales team to discuss licensing 
                    options that fit your distribution model.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-4">
                  <AccordionTrigger>How quickly are CVEs addressed?</AccordionTrigger>
                  <AccordionContent>
                    We provide a 6-day SLA for Critical CVEs and 13-day SLA for High, Medium, and Low severity 
                    vulnerabilities. Once a patch is available upstream, we automatically rebuild affected images and 
                    notify you via webhook or email so you can update your deployments.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-5">
                  <AccordionTrigger>Do you support custom images or private packages?</AccordionTrigger>
                  <AccordionContent>
                    Yes, enterprise customers can request custom builds for specific versions or configurations, and we 
                    support building images with your private packages and dependencies. Contact our sales team to discuss 
                    your specific requirements.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full py-6 md:py-12 bg-gray-100 dark:bg-gray-800">
        <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-teal-600" />
                <span className="text-xl font-bold">SecureBuild</span>
              </div>
              <p className="text-sm text-muted-foreground">Secure builds. Sustainable open source.</p>
              <div className="flex gap-4">
                <Link href="https://www.youtube.com/@securebuild" className="text-muted-foreground hover:text-teal-600">
                  <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                  </svg>
                  <span className="sr-only">YouTube</span>
                </Link>
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Company</h3>
              <ul className="space-y-2">
                <li>
                  <Link href="/about" className="text-sm text-muted-foreground hover:text-teal-600">
                    About
                  </Link>
                </li>
                <li>
                  <Link href="/blog" className="text-sm text-muted-foreground hover:text-teal-600">
                    Blog
                  </Link>
                </li>
                <li>
                  <Link href="https://replicated.com/careers" className="text-sm text-muted-foreground hover:text-teal-600">
                    Careers
                  </Link>
                </li>
              </ul>
            </div>
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Resources</h3>
              <ul className="space-y-2">
                <li>
                  <Link href="/images" className="text-sm text-muted-foreground hover:text-teal-600">
                    Secure Images Catalog
                  </Link>
                </li>
                <li>
                  <Link href="https://trust.replicated.com/" className="text-sm text-muted-foreground hover:text-teal-600">
                    Security
                  </Link>
                </li>
              </ul>
            </div>
            <div className="space-y-4">
              <h3 className="text-sm font-medium">Legal</h3>
              <ul className="space-y-2">
                <li>
                  <Link href="/terms" className="text-sm text-muted-foreground hover:text-teal-600">
                    Terms
                  </Link>
                </li>
                <li>
                  <Link href="/privacy" className="text-sm text-muted-foreground hover:text-teal-600">
                    Privacy
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-8 border-t pt-8 text-center text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Replicated, Inc. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  )
}

