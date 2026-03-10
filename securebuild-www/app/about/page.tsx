import Link from "next/link"
import Navbar from "@/components/navbar"

export default function About() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />

      <main className="flex-1">
        <div className="container mx-auto max-w-4xl px-4 md:px-6 lg:px-8 py-12 md:py-16">
          <div className="space-y-8">
            {/* Header */}
            <div className="space-y-4">
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight">
                About SecureBuild
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
                SecureBuild helps open source projects deliver trusted, hardened container images with zero known vulnerabilities (0 CVEs), and get paid for it.
              </p>
            </div>

            {/* Main Content */}
            <div className="prose prose-lg max-w-none space-y-8">
              <div className="space-y-4">
                <p className="text-base md:text-lg leading-relaxed">
                  We work directly with the maintainers of popular OSS projects to produce high-integrity builds from source, track dependencies with full SBOMs, and proactively patch images as CVEs emerge. Enterprises get secure, stable software they can rely on. Maintainers receive 70% of direct image subscription revenue.
                </p>
              </div>

              {/* Built by Replicated Section */}
              <div className="space-y-6 bg-gray-50 dark:bg-gray-900 rounded-xl p-6 md:p-8">
                <h2 className="text-2xl md:text-3xl font-bold">
                  Built by the Team Behind Replicated
                </h2>
                
                <div className="space-y-4">
                  <p className="text-base md:text-lg leading-relaxed">
                    SecureBuild is a new initiative from Replicated, the platform trusted by leading commercial and open source vendors to distribute and support their enterprise software. Over the past decade, we have helped companies like HashiCorp, TravisCI, Knime, H2O.ai, and many others (<Link href="https://replicated.com/customers" className="text-teal-600 hover:text-teal-700 underline">replicated.com/customers</Link>) commercialize their software and grow sustainably.
                  </p>

                  <p className="text-base md:text-lg leading-relaxed">
                    Our leadership team has deep experience in cloud-native infrastructure, secure software delivery, and open source business models. We have seen what works and what doesn&apos;t when trying to scale security across both community and enterprise environments.
                  </p>

                  <p className="text-base md:text-lg leading-relaxed">
                    SecureBuild is built on top of the core Replicated technologies for building, securing, and distributing containerized applications to the most secure environments.
                  </p>
                </div>
              </div>

              {/* Our Mission Section */}
              <div className="space-y-6">
                <div className="space-y-4">
                  <p className="text-base md:text-lg leading-relaxed">
                    We started SecureBuild because we believe there is a better way. Open source maintainers should not have to choose between sustainability and security. Enterprises have shown they are willing to pay for high-assurance software. SecureBuild connects these two needs.
                  </p>

                  <p className="text-base md:text-lg leading-relaxed">
                    We believe that commercial success can strengthen the open source ecosystem without changing licenses or locking in users. By realigning incentives, we are building a system that rewards creators, satisfies enterprises, and improves supply chain security across the board.
                  </p>
                </div>

                {/* CTA */}
                <div className="bg-teal-50 dark:bg-teal-900/20 rounded-xl p-6 md:p-8 border border-teal-100 dark:border-teal-800">
                  <div className="space-y-4">
                    <h3 className="text-xl font-semibold text-teal-800 dark:text-teal-200">
                      Want to learn more?
                    </h3>
                    <p className="text-teal-700 dark:text-teal-300">
                      Explore how to{" "}
                      <Link href="/partner" className="font-medium underline hover:no-underline">
                        partner with us
                      </Link>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
} 