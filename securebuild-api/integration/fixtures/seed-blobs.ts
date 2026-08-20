/**
 * Blob data for MinIO seed uploads.
 *
 * This data was previously stored in the DB seed YAML (raw_result,
 * parsed_results_details, sbom columns) but is now stored only in the
 * object store. The DB seed YAMLs contain metadata only.
 */

const EXISTING_DIGEST = 'sha256:abc123def456789012345678901234567890123456789012345678901234';
const STALE_SCAN_DIGEST = 'sha256:stale1234567890123456789012345678901234567890123456789012345';

const PARSED_RESULTS_DETAILS = JSON.stringify({
  descriptor: { name: 'grype', version: '0.95.0' },
  counts: { critical: 0, high: 1, medium: 0, low: 0, total: 1, fixable: 0 },
  fixed_counts: { critical: 0, high: 0, medium: 0, low: 0, total: 0, fixable: 0 },
  created_at: '2026-01-12T15:57:01.425731Z',
  critical: {},
  high: {
    'CVE-2025-9086': '1. A cookie is set using the `secure` keyword for `https://target`   2. curl is redirected to or otherwise made to speak with `http://target` (same     hostname, but using clear text HTTP) using the same cookie set   3. The same cookie name is set - but with just a slash as path (`path="/",`).    Since this site is not secure, the cookie *should* just be ignored. 4. A bug in the path comparison logic makes curl read outside a heap buffer    boundary  The bug either causes a crash or it potentially makes the comparison come to the wrong conclusion and lets the clear-text site override the contents of the secure cookie, contrary to expectations and depending on the memory contents immediately following the single-byte allocation that holds the path.  The presumed and correct behavior would be to plainly ignore the second set of the cookie since it was already set as secure on a secure host so overriding it on an insecure host should not be okay.',
  },
  medium: {},
  low: {},
  vulnerability_details: [
    {
      cve: 'CVE-2025-9086',
      description: '1. A cookie is set using the `secure` keyword for `https://target`   2. curl is redirected to or otherwise made to speak with `http://target` (same     hostname, but using clear text HTTP) using the same cookie set   3. The same cookie name is set - but with just a slash as path (`path="/",`).    Since this site is not secure, the cookie *should* just be ignored. 4. A bug in the path comparison logic makes curl read outside a heap buffer    boundary  The bug either causes a crash or it potentially makes the comparison come to the wrong conclusion and lets the clear-text site override the contents of the secure cookie, contrary to expectations and depending on the memory contents immediately following the single-byte allocation that holds the path.  The presumed and correct behavior would be to plainly ignore the second set of the cookie since it was already set as secure on a secure host so overriding it on an insecure host should not be okay.',
      artifact_id: 'Package-deb-curl-61f95e16aafc9e56',
      artifact_type: 'deb',
      artifact_name: 'curl',
      artifact_version: '7.88.1-10+deb12u14',
      artifact_path: '',
      fix_state: 'wont-fix',
      fix_versions: [],
      severity: 'high',
      epss_percentile: 0.06919,
      risk: 0.020249999999999997,
    },
  ],
});

const RAW_RESULT = JSON.stringify({
  descriptor: {
    name: 'grype',
    version: '0.95.0',
    configuration: { output: ['json'], 'fail-on-severity': 'medium' },
    timestamp: '2024-01-01T00:00:00Z',
  },
  distro: { name: 'debian', version: '12', idLike: [] },
  matches: [
    {
      vulnerability: {
        id: 'CVE-2025-9086',
        dataSource: 'https://nvd.nist.gov/vuln/detail/CVE-2025-9086',
        namespace: 'nvd:cpe',
        severity: 'High',
        urls: ['https://curl.se/docs/CVE-2025-9086.html'],
        description: '1. A cookie is set using the `secure` keyword for `https://target`\n2. curl is redirected to or otherwise made to speak with `http://target` (same\n   hostname, but using clear text HTTP) using the same cookie set\n3. The same cookie name is set - but with just a slash as path (`path=\'/\'`).\n   Since this site is not secure, the cookie *should* just be ignored.\n4. A bug in the path comparison logic makes curl read outside a heap buffer\n   boundary\n\nThe bug either causes a crash or it potentially makes the comparison come to\nthe wrong conclusion and lets the clear-text site override the contents of the\nsecure cookie, contrary to expectations and depending on the memory contents\nimmediately following the single-byte allocation that holds the path.\n\nThe presumed and correct behavior would be to plainly ignore the second set of\nthe cookie since it was already set as secure on a secure host so overriding\nit on an insecure host should not be okay.',
        cvss: [],
        epss: [{ cve: 'CVE-2025-9086', epss: 0.00071, percentile: 0.06919, date: '2024-01-01' }],
        fix: { versions: [], state: 'wont-fix' },
        advisories: [],
        risk: 0.020249999999999997,
      },
      relatedVulnerabilities: [],
      matchDetails: [
        {
          type: 'cpe-match',
          matcher: 'apk-matcher',
          searchedBy: {
            namespace: 'nvd:cpe',
            cpes: ['cpe:2.3:a:haxx:curl:7.88.1:*:*:*:*:*:*:*'],
            package: { name: 'curl', version: '7.88.1-10+deb12u14' },
          },
          found: {
            vulnerabilityID: 'CVE-2025-9086',
            versionConstraint: '>= 7.31.0, < 8.16.0 (wont-fix)',
            cpes: ['cpe:2.3:a:haxx:curl:*:*:*:*:*:*:*:*'],
          },
        },
      ],
      artifact: {
        id: 'Package-deb-curl-61f95e16aafc9e56',
        name: 'curl',
        version: '7.88.1-10+deb12u14',
        type: 'deb',
        locations: [{ path: '/usr/lib/dpkg/status', layerID: 'sha256:abc123def456', accessPath: '/usr/lib/dpkg/status' }],
        language: '',
        licenses: [],
        cpes: ['cpe:2.3:a:haxx:curl:7.88.1:*:*:*:*:*:*:*'],
        purl: 'pkg:deb/debian/curl@7.88.1-10+deb12u14?arch=amd64&distro=debian-12',
        upstreams: [],
      },
    },
  ],
  source: {
    type: 'image',
    target: {
      userInput: 'test-registry.example.com/test-org/test-image:latest',
      imageID: EXISTING_DIGEST,
      manifestDigest: EXISTING_DIGEST,
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      tags: ['test-registry.example.com/test-org/test-image:latest'],
      imageSize: 1024000,
      layers: [],
      manifest: '',
      config: '',
      repoDigests: [],
      architecture: 'amd64',
      os: 'linux',
    },
  },
});

const SBOM = JSON.stringify({
  SPDXID: 'SPDXRef-DOCUMENT',
  spdxVersion: 'SPDX-2.3',
  name: 'test-image',
  dataLicense: 'CC0-1.0',
  documentNamespace: 'https://securebuild.io/test/image',
  creationInfo: { created: '2024-01-01T00:00:00Z', creators: ['Tool: SecureBuild test'] },
  packages: [
    {
      SPDXID: 'SPDXRef-package-test',
      name: 'test-pkg',
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
    },
  ],
  relationships: [
    {
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: 'SPDXRef-package-test',
    },
  ],
});

export interface SeedBlob {
  digest: string;
  arch: string;
  rawResult?: string;
  parsedResultsDetails?: string;
  sbom?: string;
}

export const SEED_BLOBS: SeedBlob[] = [
  // Existing image — succeeded scans with both arches
  {
    digest: EXISTING_DIGEST,
    arch: 'x86_64',
    rawResult: RAW_RESULT,
    parsedResultsDetails: PARSED_RESULTS_DETAILS,
    sbom: SBOM,
  },
  {
    digest: EXISTING_DIGEST,
    arch: 'aarch64',
    rawResult: RAW_RESULT,
    parsedResultsDetails: PARSED_RESULTS_DETAILS,
    sbom: SBOM,
  },
  // Stale scan — its DB row still points at the last successful result while
  // the on-demand scan tests transition the current status back to queued.
  {
    digest: STALE_SCAN_DIGEST,
    arch: 'x86_64',
    rawResult: RAW_RESULT,
    parsedResultsDetails: PARSED_RESULTS_DETAILS,
    sbom: SBOM,
  },
  // Other digests — SBOMs only (no scan results)
  { digest: 'sha256:queued123456789012345678901234567890123456789012345678901234', arch: 'x86_64', sbom: SBOM },
  { digest: 'sha256:running123456789012345678901234567890123456789012345678901234', arch: 'x86_64', sbom: SBOM },
  { digest: 'sha256:failed123456789012345678901234567890123456789012345678901234', arch: 'x86_64', sbom: SBOM },
];
