export interface CosignCommandOptions {
  /** Image reference slug/tag portion, e.g. securebuild/nginx:1.29 */
  imageRef: string
  /** Optional digest to pin the image */
  digest?: string
  /** linux/amd64, arm64, etc. */
  platform?: string
  /** OCI registry host (e.g. localhost:8888) */
  host?: string
  /** issuer URL for certificate */
  issuer?: string
  /** attestor service-account email */
  identity?: string
}

/**
 * Builds the three common cosign commands (verify, download attestation, verify attestation)
 * using the public environment variables injected by Doppler.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function buildCosignCommands({ imageRef, digest, platform: _platform = "linux/amd64", host = "", issuer = "https://accounts.google.com", identity = "" }: CosignCommandOptions) {
  // Use provided identity, env var, or fall back to default sb-attestor address
  const effectiveIdentity = identity || process.env["OIDC_GCP_ATTESTOR_ACCOUNT"] || "sb-attestor@cve0-issuer.iam.gserviceaccount.com"

  // Ensure we don’t end up with double slashes
  const refBase = host ? `${host}/${imageRef}` : imageRef
  const ref = digest ? `${refBase}@${digest}` : refBase

  return {
    verify: [
      'cosign verify \\',
      `  --certificate-oidc-issuer=${issuer} \\`,
      `  --certificate-identity=${effectiveIdentity} \\`,
      `  ${ref} | jq`,
    ].join('\n'),

    downloadAttestation: [
      'cosign download attestation \\',
      '  --predicate-type=https://spdx.dev/Document \\',
      `  ${ref} | jq -r .payload | base64 -d | jq .predicate`,
    ].join('\n'),

    verifyAttestation: [
      'cosign verify-attestation \\',
      '  --type https://spdx.dev/Document \\',
      `  --certificate-oidc-issuer=${issuer} \\`,
      `  --certificate-identity=${effectiveIdentity} \\`,
      `  ${ref}`,
    ].join('\n'),
  }
} 