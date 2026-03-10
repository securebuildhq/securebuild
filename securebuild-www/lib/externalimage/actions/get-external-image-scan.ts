"use server"

import { requireValidSession } from "@/lib/utils/session-validation"
import { getExternalImageDigestForTag, getExternalImageScan } from "../externalimage"
import { Session } from "@/lib/types/session"
import { parseImageRef } from "../registry";
import { traceServerAction } from "@/lib/observability/tracing";


export interface CVE {
  cve: string;
  severity: string;
  description: string;
}

interface ExternalImageScanResult {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  cves: CVE[];
  createdAt: string;
}

async function getExternalImageScanActionImpl(sess: Session, imageName: string, imageTag: string, imageArch: string): Promise<ExternalImageScanResult | { error: string }> {
  const validatedSession = await requireValidSession(sess)

  const parsedImage = parseImageRef(imageName)

  let arch: string = "";
  if (imageArch === "amd64") {
    arch = "x86_64"
  } else if (imageArch === "arm64") {
    arch = "aarch64"
  } else {
    return {
      error: "Invalid architecture",
    }
  }

  const digest = await getExternalImageDigestForTag(validatedSession.selectedTeamId, parsedImage.registry, parsedImage.repository, imageTag)
  if (!digest) {
    return {
      error: "Digest not found for the specified tag",
    }
  }

  try {
    // Fetch both raw and parsed results in parallel using the unified function
    const [parsedScanResult, rawScanResult] = await Promise.all([
      getExternalImageScan(digest, arch, 'parsed'),
      getExternalImageScan(digest, arch, 'raw'),
    ])

    const parsedData = parsedScanResult
    const rawData = rawScanResult
    if (!parsedData || !parsedData.scanResult) {
      return { error: "Scan result not found" }
    }
    if (!rawData || !rawData.scanResult) {
      return { error: "Raw scan result not found" }
    }

    // DB may return json/jsonb as string or already-parsed object
    const parsedResult =
      typeof parsedData.scanResult === 'string'
        ? JSON.parse(parsedData.scanResult)
        : parsedData.scanResult
    const rawResult =
      typeof rawData.scanResult === 'string'
        ? JSON.parse(rawData.scanResult)
        : rawData.scanResult

    // parsed_results_details has counts under .counts; support both shapes for compatibility
    const counts = parsedResult.counts ?? parsedResult

    // Extract CVE details from rawResult (matches may be null/empty when no vulnerabilities found)
    const cves = (rawResult.matches || []).map((match: { vulnerability: { id: string; description: string; severity?: string } }) => {
      return {
        cve: match.vulnerability.id,
        description: match.vulnerability.description,
        severity: match.vulnerability.severity?.toLowerCase() || 'unknown', // Ensure lowercase for consistency
        // Add more fields as needed
      }
    })

    return {
      critical: counts.critical ?? 0,
      high: counts.high ?? 0,
      medium: counts.medium ?? 0,
      low: counts.low ?? 0,
      total: counts.total ?? 0,
      cves: cves,
      createdAt: parsedData.scanCreatedAt,
    }
  } catch (error) {
    console.error('getExternalImageScan error:', error)
    return {
      error: 'Failed to retrieve scan results',
    }
  }
}

export const getExternalImageScanAction = traceServerAction('getExternalImageScanAction', getExternalImageScanActionImpl);
