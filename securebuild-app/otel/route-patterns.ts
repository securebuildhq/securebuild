/**
 * Shared route normalisation used by both the Datadog and OpenTelemetry backends.
 *
 * Converts concrete URL paths into parameterised route patterns so that traces
 * are grouped by route rather than by individual resource IDs.
 */

interface RoutePattern {
  pattern: RegExp;
  replacement: string;
}

const routePatterns: RoutePattern[] = [
  // API routes
  { pattern: /^\/api\/execution-details\/[^/]+$/, replacement: '/api/execution-details/[id]' },
  { pattern: /^\/api\/package-details\/[^/]+$/, replacement: '/api/package-details/[id]' },
  { pattern: /^\/api\/package-executions\/[^/]+$/, replacement: '/api/package-executions/[id]' },
  { pattern: /^\/api\/image-scan\/[^/]+$/, replacement: '/api/image-scan/[id]' },
  { pattern: /^\/api\/image-apko\/[^/]+$/, replacement: '/api/image-apko/[id]' },
  { pattern: /^\/api\/image-test\/[^/]+$/, replacement: '/api/image-test/[id]' },
  { pattern: /^\/api\/v1\/image\/[^/]+\/scan$/, replacement: '/api/v1/image/[id]/scan' },
  // Page routes (capture suffix to preserve sub-routes)
  { pattern: /^\/packages\/[^/]+(.*)$/, replacement: '/packages/[id]$1' },
  { pattern: /^\/builds\/[^/]+(.*)$/, replacement: '/builds/[id]$1' },
  { pattern: /^\/images\/[^/]+(.*)$/, replacement: '/images/[id]$1' },
  { pattern: /^\/executions\/[^/]+(.*)$/, replacement: '/executions/[id]$1' },
  { pattern: /^\/package-families\/[^/]+(.*)$/, replacement: '/package-families/[id]$1' },
  { pattern: /^\/catalog\/[^/]+(.*)$/, replacement: '/catalog/[id]$1' },
];

/**
 * Convert an actual URL path to a normalised route pattern.
 * Returns the original path unchanged if no pattern matches.
 */
export function getRoutePattern(path: string): string {
  for (const { pattern, replacement } of routePatterns) {
    if (pattern.test(path)) {
      return path.replace(pattern, replacement);
    }
  }
  return path;
}
