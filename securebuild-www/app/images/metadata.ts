import { Metadata } from "next"

export const metadata: Metadata = {
  title: "Secure Container Images Catalog | SecureBuild",
  description: "Browse our catalog of hardened, zero-CVE container images for popular open source projects. Each image is continuously scanned and rebuilt to eliminate vulnerabilities.",
  openGraph: {
    title: "Secure Container Images Catalog | SecureBuild",
    description: "Browse our catalog of hardened, zero-CVE container images for popular open source projects. Each image is continuously scanned and rebuilt to eliminate vulnerabilities.",
    type: "website",
    images: [
      {
        url: "/og-image-catalog.png",
        width: 1200,
        height: 630,
        alt: "SecureBuild Container Images Catalog",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Secure Container Images Catalog | SecureBuild",
    description: "Browse our catalog of hardened, zero-CVE container images for popular open source projects. Each image is continuously scanned and rebuilt to eliminate vulnerabilities.",
    images: ["/og-image-catalog.png"],
  },
}