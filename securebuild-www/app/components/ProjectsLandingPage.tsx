"use client"

import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import { Check, ChevronRight, Github, DollarSign } from "lucide-react"
import { useEffect, useState } from "react"
import Navbar from "@/components/navbar"
import { CatalogItem } from "@/lib/types/catalog"
import { listFeaturedCatalogItemsAction } from "@/lib/catalog/actions/list-featured-catalog-items"
import { CatalogItemCard } from "./CatalogItemCard"
import { CatalogItemCardSkeleton } from "./CatalogItemCardSkeleton"
import { LaunchVideosToggle } from "@/components/launch-videos-toggle"

interface ProjectsLandingPageProps {
  activePath: "vendors" | "projects"
  setActivePath: (path: "vendors" | "projects") => void
}

export default function ProjectsLandingPage({ activePath, setActivePath }: ProjectsLandingPageProps) {
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
      <Navbar pageType="oss" />

      <main className="flex-1">
        {/* Hero Section */}
        <section className="w-full py-6 md:py-12 lg:py-12 xl:py-16 bg-linear-to-b from-gray-50 to-white dark:from-gray-900 dark:to-gray-800">
          <div className="container mx-auto max-w-6xl px-4 md:px-6 lg:px-8 xl:px-12">
            <div className="grid gap-8 lg:grid-cols-[1fr_600px] lg:gap-12 items-center">
              <div className="flex flex-col justify-center space-y-6">
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
                <div className="space-y-4">
                  <h1 className="text-2xl font-bold tracking-tighter xs:text-3xl sm:text-4xl md:text-5xl xl:text-6xl/none">
                    Secure, Sustainable Open Source
                  </h1>
                  <p className="max-w-[600px] text-muted-foreground text-base sm:text-lg md:text-xl leading-relaxed">
                    Partner with SecureBuild to offer secure, vulnerability-free builds of your open source project
                    while generating recurring software revenue, no support contracts required.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <Button className="bg-teal-600 hover:bg-teal-700 h-11 px-6" asChild>
                    <Link href="/partner">
                      Partner With Us
                      <ChevronRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                  <Button variant="outline" className="h-11 px-6" asChild>
                    <Link href="/enterprise">Contact Sales</Link>
                  </Button>
                </div>
              </div>
              <div className="flex justify-center lg:justify-end order-first lg:order-last">
                <div className="relative w-full max-w-md sm:max-w-lg lg:max-w-[600px] rounded-xl shadow-lg overflow-hidden">
                  <div style={{ position: 'relative', paddingBottom: '73.36956521739131%', height: 0 }}>
                    <iframe
                      src="https://www.loom.com/embed/cf23a2e63d884b2e860d17ad8563e156?sid=21524648-ffb9-4eee-a902-7476deebab9d"
                      frameBorder="0"
                      allowFullScreen
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Partner Logos */}
            <div className="mt-12 lg:mt-16">
              <div className="text-center mb-6">
                <p className="text-sm text-muted-foreground">
                  <span className="block sm:inline">Trusted by leading open source projects</span>
                  <span className="block sm:inline sm:ml-1">
                    with +200k <Github className="h-4 w-4 inline mx-1" /> stars
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap md:flex-nowrap items-center justify-center gap-4 md:gap-6 lg:gap-8 opacity-60 hover:opacity-80 transition-opacity">
                <div className="flex items-center justify-center h-8 sm:h-10">
                  <Image
                    src="/images/partners/weaviate-gray.png"
                    alt="Weaviate"
                    width={100}
                    height={32}
                    className="h-full w-auto object-contain filter grayscale hover:grayscale-0 transition-all duration-300"
                  />
                </div>
                <div className="flex items-center justify-center h-8 sm:h-10">
                  <Image
                    src="/images/partners/timescale-gray.png"
                    alt="Timescale"
                    width={100}
                    height={32}
                    className="h-full w-auto object-contain filter grayscale hover:grayscale-0 transition-all duration-300"
                  />
                </div>
                <div className="flex items-center justify-center h-8 sm:h-10">
                  <Image
                    src="/images/partners/rclone.png"
                    alt="Rclone"
                    width={100}
                    height={32}
                    className="h-full w-auto object-contain filter grayscale hover:grayscale-0 transition-all duration-300"
                  />
                </div>
                <div className="flex items-center justify-center h-8 sm:h-10">
                  <Image
                    src="/images/partners/opencost.png"
                    alt="OpenCost"
                    width={100}
                    height={32}
                    className="h-full w-auto object-contain filter grayscale hover:grayscale-0 transition-all duration-300"
                  />
                </div>
                <div className="flex items-center justify-center h-8 sm:h-10">
                  <Image
                    src="/images/partners/ex-secrets.png"
                    alt="External Secrets"
                    width={100}
                    height={32}
                    className="h-full w-auto object-contain filter grayscale hover:grayscale-0 transition-all duration-300"
                  />
                </div>
                <div className="flex items-center justify-center h-8 sm:h-10">
                  <Image
                    src="/images/partners/coder.png"
                    alt="Coder"
                    width={100}
                    height={32}
                    className="h-full w-auto object-contain filter grayscale hover:grayscale-0 transition-all duration-300"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section id="how-it-works" className="w-full py-8 md:py-12 lg:py-16 bg-gray-50 dark:bg-gray-900">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="flex flex-col items-center justify-center space-y-4 text-center mb-6">
              <div className="space-y-2">
                <div className="inline-block rounded-lg bg-teal-100 dark:bg-teal-900 px-3 py-1 text-sm text-teal-600 dark:text-teal-300">
                  How It Works
                </div>
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">
                  No support contracts. No sales calls. No code changes.
                </h2>
                <p className="max-w-[900px] text-muted-foreground md:text-xl">
                  Offer secure, stable releases and get recurring software revenue.
                </p>
              </div>
            </div>

            <div className="mx-auto max-w-6xl">
              {/* Two-path diagram */}
              <div className="relative">
                {/* Center line - Desktop only */}
                <div
                  className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700 hidden md:block"
                  style={{ transform: "translateX(-50%)" }}
                ></div>

                {/* Headers */}
                <div className="hidden md:grid md:grid-cols-2 gap-8 mb-8">
                  <div className="text-center">
                    <div className="inline-flex items-center justify-center p-3 bg-teal-100 dark:bg-teal-900 rounded-full mb-4">
                      <Github className="h-6 w-6 text-teal-600 dark:text-teal-300" />
                    </div>
                    <h3 className="text-xl sm:text-2xl font-bold text-teal-700 dark:text-teal-300">Open Source Projects</h3>
                    <p className="text-muted-foreground mt-2">What you do</p>
                  </div>
                  <div className="text-center">
                    <div className="inline-flex items-center justify-center p-3 bg-blue-100 dark:bg-blue-900 rounded-full mb-4">
                      <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
                    </div>
                    <h3 className="text-xl sm:text-2xl font-bold text-blue-700 dark:text-blue-300">SecureBuild</h3>
                    <p className="text-muted-foreground mt-2">What we do</p>
                  </div>
                </div>

                {/* Mobile Layout - Sequential */}
                <div className="md:hidden space-y-8">
                  {/* OSS Steps */}
                  <div className="space-y-6">
                    <h4 className="text-lg font-semibold text-teal-700 dark:text-teal-300 text-center mb-6">Open Source Projects - What you do</h4>

                    {/* OSS Step 1 */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-teal-100 dark:border-teal-900">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                          1
                        </div>
                        <div>
                          <h5 className="text-lg font-medium text-teal-700 dark:text-teal-300">
                            Become an Official Partner
                          </h5>
                          <p className="text-muted-foreground mt-2">
                            Get in touch with our team to set up the agreement, supply payment details, and validate your SecureBuild.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* OSS Step 2 */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-teal-100 dark:border-teal-900">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                          2
                        </div>
                        <div>
                          <h5 className="text-lg font-medium text-teal-700 dark:text-teal-300">
                            Inform Your Community
                          </h5>
                          <p className="text-muted-foreground mt-2">
                            Communicate the benefits of SecureBuild to your community and enterprise users.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* OSS Step 3 */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-teal-100 dark:border-teal-900">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                          3
                        </div>
                        <div>
                          <h5 className="text-lg font-medium text-teal-700 dark:text-teal-300">
                            Keep Shipping Great OSS
                          </h5>
                          <p className="text-muted-foreground mt-2">
                            Continue developing your open source project as usual, focusing on features and innovation.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SecureBuild Steps */}
                  <div className="space-y-6">
                    <h4 className="text-lg font-semibold text-blue-700 dark:text-blue-300 text-center mb-6">SecureBuild - What we do</h4>

                    {/* SecureBuild Step 1 */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-blue-100 dark:border-blue-900">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                          1
                        </div>
                        <div>
                          <h5 className="text-lg font-medium text-blue-700 dark:text-blue-300">
                            Map and Secure Dependencies
                          </h5>
                          <p className="text-muted-foreground mt-2">
                            We map and secure your entire dependency graph, identifying and fixing vulnerabilities.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* SecureBuild Step 2 */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-blue-100 dark:border-blue-900">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                          2
                        </div>
                        <div>
                          <h5 className="text-lg font-medium text-blue-700 dark:text-blue-300">Create SecureBuilds</h5>
                          <p className="text-muted-foreground mt-2">
                            New SecureBuilds are created whenever upstream CVEs are addressed, with a 6-day SLA for
                            critical vulnerabilities.
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* SecureBuild Step 3 */}
                    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-blue-100 dark:border-blue-900">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                          3
                        </div>
                        <div>
                          <h5 className="text-lg font-medium text-blue-700 dark:text-blue-300">
                            Handle Commercials & Distribution
                          </h5>
                          <p className="text-muted-foreground mt-2">
                            We provide customers with commercial agreements and access to secure images.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Desktop Layout - Side by Side */}
                <div className="hidden md:block">
                  {/* Steps */}
                  <div className="space-y-16">
                    {/* Step 1 */}
                    <div className="grid md:grid-cols-2 gap-8 relative">
                      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-teal-100 dark:border-teal-900">
                        <div className="flex items-start gap-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                            1
                          </div>
                          <div>
                            <h4 className="text-xl font-medium text-teal-700 dark:text-teal-300">
                              Become an Official Partner
                            </h4>
                            <p className="text-muted-foreground mt-2">
                              Get in touch with our team to set up the agreement, supply payment details, and validate your SecureBuild.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-blue-100 dark:border-blue-900">
                        <div className="flex items-start gap-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                            1
                          </div>
                          <div>
                            <h4 className="text-xl font-medium text-blue-700 dark:text-blue-300">
                              Map and Secure Dependencies
                            </h4>
                            <p className="text-muted-foreground mt-2">
                              We map and secure your entire dependency graph, identifying and fixing vulnerabilities.
                            </p>
                          </div>
                        </div>
                      </div>
                      {/* Connection dot */}
                      <div
                        className="absolute left-1/2 top-1/2 w-4 h-4 bg-gray-300 dark:bg-gray-600 rounded-full hidden md:block"
                        style={{ transform: "translate(-50%, -50%)" }}
                      ></div>
                    </div>

                    {/* Step 2 */}
                    <div className="grid md:grid-cols-2 gap-8 relative">
                      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-teal-100 dark:border-teal-900">
                        <div className="flex items-start gap-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                            2
                          </div>
                          <div>
                            <h4 className="text-xl font-medium text-teal-700 dark:text-teal-300">
                              Inform Your Community
                            </h4>
                            <p className="text-muted-foreground mt-2">
                              Communicate the benefits of SecureBuild to your community and enterprise users.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-blue-100 dark:border-blue-900">
                        <div className="flex items-start gap-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                            2
                          </div>
                          <div>
                            <h4 className="text-xl font-medium text-blue-700 dark:text-blue-300">Create SecureBuilds</h4>
                            <p className="text-muted-foreground mt-2">
                              New SecureBuilds are created whenever upstream CVEs are addressed, with a 6-day SLA for
                              critical vulnerabilities.
                            </p>
                          </div>
                        </div>
                      </div>
                      {/* Connection dot */}
                      <div
                        className="absolute left-1/2 top-1/2 w-4 h-4 bg-gray-300 dark:bg-gray-600 rounded-full hidden md:block"
                        style={{ transform: "translate(-50%, -50%)" }}
                      ></div>
                    </div>

                    {/* Step 3 */}
                    <div className="grid md:grid-cols-2 gap-8 relative">
                      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-teal-100 dark:border-teal-900">
                        <div className="flex items-start gap-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900 dark:text-teal-300">
                            3
                          </div>
                          <div>
                            <h4 className="text-xl font-medium text-teal-700 dark:text-teal-300">
                              Keep Shipping Great OSS
                            </h4>
                            <p className="text-muted-foreground mt-2">
                              Continue developing your open source project as usual, focusing on features and innovation.
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border-2 border-blue-100 dark:border-blue-900">
                        <div className="flex items-start gap-4">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300">
                            3
                          </div>
                          <div>
                            <h4 className="text-xl font-medium text-blue-700 dark:text-blue-300">
                              Handle Commercials & Distribution
                            </h4>
                            <p className="text-muted-foreground mt-2">
                              We provide customers with commercial agreements and access to secure images.
                            </p>
                          </div>
                        </div>
                      </div>
                      {/* Connection dot */}
                      <div
                        className="absolute left-1/2 top-1/2 w-4 h-4 bg-gray-300 dark:bg-gray-600 rounded-full hidden md:block"
                        style={{ transform: "translate(-50%, -50%)" }}
                      ></div>
                    </div>
                  </div>
                </div>

                {/* Revenue Sharing - Convergence Point */}
                <div className="relative mt-12 md:mt-16">
                  <div className="mx-auto max-w-2xl bg-linear-to-r from-teal-50 via-purple-50 to-blue-50 dark:from-teal-900/30 dark:via-purple-900/30 dark:to-blue-900/30 p-6 sm:p-8 rounded-xl shadow-sm border border-purple-100 dark:border-purple-800">
                    <div className="flex flex-col items-center text-center">
                      <div className="flex h-12 w-12 sm:h-16 sm:w-16 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300 mb-4">
                        <DollarSign className="h-6 w-6 sm:h-8 sm:w-8" />
                      </div>
                      <h3 className="text-xl sm:text-2xl font-bold mb-2 text-purple-700 dark:text-purple-300">
                        Revenue Sharing
                      </h3>
                      <p className="text-muted-foreground max-w-xl text-sm sm:text-base">
                        We share subscription revenue with your project maintainers or foundation, creating a
                        sustainable funding source for your open source work. 70% of revenue goes to maintainers,
                        while 30% goes to SecureBuild.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-center mt-12 md:mt-16">
                <Button className="bg-teal-600 hover:bg-teal-700" asChild>
                  <Link href="/partner">
                    Partner With Us
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
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
                        src="https://www.youtube.com/embed/IrHDKJWExGk"
                        title="Partner Overview"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="rounded-t-lg"
                      ></iframe>
                    </div>
                    <div className="p-4">
                      <h3 className="font-semibold text-lg mb-2">Partner Overview</h3>
                      <p className="text-sm text-muted-foreground">
                        A quick overview of the SecureBuild partnership program and what it means for your project.
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

        {/* Benefits Section */}
        <section id="benefits" className="w-full py-8 md:py-12 lg:py-16">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="flex flex-col items-center justify-center space-y-4 text-center mb-6">
              <div className="space-y-2">
                <div className="inline-block rounded-lg bg-teal-100 dark:bg-teal-900 px-3 py-1 text-sm text-teal-600 dark:text-teal-300">
                  Benefits
                </div>
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Value for the entire ecosystem</h2>
                <p className="max-w-[900px] text-muted-foreground md:text-xl">
                  Our partnership creates value for open source projects, maintainers, and users.
                </p>
              </div>
            </div>

            <div className="mx-auto max-w-5xl">
              <div className="grid gap-12 md:grid-cols-2">
                <div>
                  <h3 className="text-2xl font-bold mb-6">For Open Source Projects</h3>
                  <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                      <Check className="h-6 w-6 text-teal-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">Sustainable Revenue</span>
                        <p className="text-muted-foreground mt-1">
                          Generate consistent funding to support ongoing development and maintenance.
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="h-6 w-6 text-teal-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">Maintain License Control</span>
                        <p className="text-muted-foreground mt-1">
                          Keep your core project under its existing open source license.
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="h-6 w-6 text-teal-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">Focus on Innovation</span>
                        <p className="text-muted-foreground mt-1">
                          Spend less time on security fixes and more time on new features.
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="h-6 w-6 text-teal-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">Expanded User Base</span>
                        <p className="text-muted-foreground mt-1">
                          Attract security-conscious organizations that might otherwise avoid open source.
                        </p>
                      </div>
                    </li>
                  </ul>
                  <div className="mt-8 flex justify-center md:justify-start">
                    <Button className="bg-teal-600 hover:bg-teal-700 text-white" size="lg" asChild>
                      <Link href="/partner">Partner With Us</Link>
                    </Button>
                  </div>
                </div>

                <div>
                  <h3 className="text-2xl font-bold mb-6">For Enterprise Users</h3>
                  <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                      <Check className="h-6 w-6 text-teal-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">0 CVE SLA</span>
                        <p className="text-muted-foreground mt-1">
                          6-day SLA for Critical CVEs, 13-day for High, Medium & Low CVEs.
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="h-6 w-6 text-teal-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">Enhanced Security</span>
                        <p className="text-muted-foreground mt-1">
                          Use software with minimal security risks and daily vulnerability removal.
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="h-6 w-6 text-teal-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">Support Open Source</span>
                        <p className="text-muted-foreground mt-1">
                          Contribute to the sustainability of the open source projects you rely on.
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3">
                      <Check className="h-6 w-6 text-teal-600 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-medium">Simplified Compliance</span>
                        <p className="text-muted-foreground mt-1">
                          Meet security requirements with certified zero-CVE builds.
                        </p>
                      </div>
                    </li>
                  </ul>
                  <div className="mt-8 flex justify-center md:justify-start">
                    <Button className="bg-gray-900 hover:bg-gray-800 text-white" size="lg" asChild>
                      <Link href="/enterprise">Contact Enterprise Sales</Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Enterprise CTA Section */}
        <section className="w-full py-12 md:py-16 lg:py-20 bg-linear-to-r from-gray-900 via-gray-800 to-gray-900 text-white">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="grid gap-8 md:grid-cols-2 items-center">
              <div className="space-y-6">
                <div className="inline-block rounded-lg bg-gray-800 px-3 py-1 text-sm text-teal-400">
                  Enterprise Security
                </div>
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl lg:text-5xl">
                  SecureBuild<br />Enterprise Catalog
                </h2>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-900 text-teal-400">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-gray-300">A custom catalog of selected SecureBuilds</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-900 text-teal-400">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-gray-300">Volume discounts for 5 or more images</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-900 text-teal-400">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-gray-300">Custom builds for your specific requirements</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-900 text-teal-400">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-gray-300">Redistribution rights</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-900 text-teal-400">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-gray-300">Drop in replacement for standard images</span>
                  </div>
                </div>
                <Button className="bg-teal-600 hover:bg-teal-700 text-white" size="lg" asChild>
                  <Link href="/enterprise">Contact Enterprise Sales</Link>
                </Button>
              </div>
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-linear-to-r from-teal-500 to-blue-500 opacity-30 blur-lg"></div>
                <div className="relative rounded-lg bg-gray-800 p-6 md:p-8">
                  <div className="space-y-6">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-700">
                        <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
                      </div>
                      <div>
                        <h3 className="text-xl font-semibold">Enterprise Security Program</h3>
                        <p className="text-sm text-gray-300">Comprehensive security for your entire stack</p>
                      </div>
                    </div>
                    <div className="text-center space-y-4">
                      <h4 className="text-2xl font-bold text-teal-400">Secure your entire infrastructure</h4>
                      <p className="text-gray-300">
                        Get enterprise access to our complete catalog of secure, vulnerability-free builds for all your
                        critical open source dependencies.
                      </p>
                      <p className="text-gray-300">
                        Simplify compliance, reduce risk, and support open source sustainability with a single subscription.
                      </p>
                    </div>
                    <div className="pt-2">
                      <Button
                        variant="outline"
                        className="w-full border-gray-600 text-teal-400 hover:bg-gray-700 hover:text-teal-300"
                        asChild
                      >
                        <Link href="/enterprise">Request Custom Quote</Link>
                      </Button>
                    </div>
                  </div>
                </div>
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
                  Common questions about our open source partnership model.
                </p>
              </div>
            </div>

            <div className="mx-auto max-w-3xl">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger>How does the revenue sharing work?</AccordionTrigger>
                  <AccordionContent>
                    We collect subscription fees from organizations who use the SecureBuild of your project. We then
                    share this revenue with your project maintainers or foundation based on the terms agreed upon in our
                    partnership agreement. This is 70% for Direct Subscriptions and 50% of the average price per image
                    when organizations do Catalog Subscriptions that includes access to your SecureBuild. Existing Direct
                    Subscription commisions are never reduced as long as Users retain access to your image through
                    SecureBuild (including if they upgrade to a Catalog Subscription).
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-2">
                  <AccordionTrigger>Does this change my project&apos;s open source license?</AccordionTrigger>
                  <AccordionContent>
                    No. Your core project maintains its existing open source license. The commercial license only
                    applies to the secure builds that SecureBuild provides. This dual licensing approach allows you to
                    maintain your open source community while also generating revenue from larger organizations.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-4">
                  <AccordionTrigger>How do you create the secure builds?</AccordionTrigger>
                  <AccordionContent>
                    We rebuild your project regularly using our secure build pipeline. This process identifies and
                    removes vulnerabilities in your dependencies and applies security patches. The result is a zero-CVE
                    version of your software that organizations can trust.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-5">
                  <AccordionTrigger>What&apos;s required from our project team?</AccordionTrigger>
                  <AccordionContent>
                    Very little! We handle the security scanning, rebuilding, and distribution of the SecureBuild. We
                    also manage all customer relationships and licensing. Your team can continue focusing on developing
                    great features for your project.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-6">
                  <AccordionTrigger>How do we get started?</AccordionTrigger>
                  <AccordionContent>
                    Contact us to schedule an initial consultation. We&apos;ll discuss your project&apos;s needs, explain our
                    partnership model in detail, and work get things rolling quickly. Once the partnership is
                    established, we can typically have SecureBuilds available within a few days.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="w-full py-8 md:py-12 lg:py-16 bg-teal-600 text-white">
          <div className="container mx-auto max-w-6xl px-4 md:px-8 lg:px-12">
            <div className="flex flex-col items-center justify-center space-y-4 text-center">
              <div className="space-y-2">
                <h2 className="text-3xl font-bold tracking-tighter md:text-4xl">Ready to partner with us?</h2>
                <p className="max-w-[600px] md:text-xl">
                  Join other open source projects already generating sustainable revenue through SecureBuild
                  partnerships.
                </p>
              </div>
              <div className="flex flex-col gap-2 min-[400px]:flex-row">
                <Button className="bg-white text-teal-600 hover:bg-gray-100" asChild>
                  <Link href="/partner">
                    Partner With Us
                    <ChevronRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button className="bg-gray-900 hover:bg-gray-800 text-white" asChild>
                  <Link href="/enterprise">Contact Sales</Link>
                </Button>
              </div>
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
                <Image src="/sb-192x192.png" alt="SecureBuild Logo" width={24} height={24} />
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
