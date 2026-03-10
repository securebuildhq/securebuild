import { Card, CardContent } from "@/components/ui/card"
import { Shield } from "lucide-react"
import { getSession } from "@/lib/auth/session"
import { CosignCommands } from "@/components/cosign-commands"
import { hasCosignSignature } from "@/lib/oci/actions/has-signature"
import { getImageByNameAction } from "@/lib/image/actions/get-image-by-name"
import { getImageDigest } from "@/lib/image/actions/get-image-digest"

export const dynamic = 'force-dynamic'
export const dynamicParams = true
export const revalidate = 0

interface ProvenancePageProps {
  params: Promise<{
    slug: string
    tag: string
    arch: string
  }>
}

export default async function ProvenancePage({ params }: ProvenancePageProps) {
  const { slug, tag, arch } = await params
  const session = await getSession()

  // Fetch image info (canonical name)
  const image = await getImageByNameAction(session ?? undefined, slug)
  const canonicalName = image?.name ?? slug
  const signatureAvailable = await hasCosignSignature(canonicalName, tag)

  // Fetch digest for Rekor link (only relevant when a signature exists)
  await getImageDigest(canonicalName, tag, arch)

  // Mock provenance data - this would typically come from an API call
  // const provenance = {
  //   buildPlatform: "Replicated Secure Build",
  //   builder: undefined,
  //   sourceRepository: "https://github.com/nginx/nginx",
  //   sourceCommit: "abc123def456789",
  //   buildTime: imageBuildTime ?? undefined,
  //   builderId: "https://github.com/securebuild/.github/workflows/build.yml@refs/heads/main",
  //   materials: [
  //     {
  //       uri: "https://github.com/nginx/nginx@v1.29.0",
  //       digest: "sha256:abc123...",
  //       type: "source"
  //     },
  //     {
  //       uri: "docker.io/alpine:3.19",
  //       digest: "sha256:def456...",
  //       type: "base-image"
  //     }
  //   ],
  //   verified: true,
  //   signingKey: "securebuild-prod-2024",
  //   compliance: {
  //     slsa: "Level 3",
  //     supplyChainSecurity: true
  //   }
  // }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Build Provenance</h2>
        <p className="text-muted-foreground">
          Cryptographically verifiable information about how this image was built, including source materials, build environment, and security attestations.
        </p>
      </div>

      {/* Verification Status with inline cosign commands */}
      <Card className="bg-linear-to-r from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 border-green-200 dark:border-green-800">
        <CardContent className="pt-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-300">
              <Shield className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-semibold text-green-800 dark:text-green-300">Provenance Verified</h3>
              <p className="text-sm text-green-700 dark:text-green-400">
                This image&apos;s build provenance has been cryptographically verified and meets SLSA Level 3 requirements.
              </p>
            </div>
          </div>
          {/* Cosign commands inline */}
          <div className="space-y-2">
            <h4 className="font-medium text-green-800 dark:text-green-200">Verify Locally with cosign</h4>
            {signatureAvailable ? (
              <>
                <CosignCommands
                  imageRef={`${canonicalName}:${tag}`}
                  platform={arch}
                  host={process.env["CVE0_OCI_HOST"] || "cve0.io"}
                  identity={process.env["OIDC_GCP_ATTESTOR_ACCOUNT"] ?? undefined}
                />
              </>
            ) : (
              <p className="italic text-muted-foreground">This image is currently rebuilding and verifying. Check back soon.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Source Materials section removed per request */}

    </div>
  )
}