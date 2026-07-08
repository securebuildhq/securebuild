/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Pin the file-tracing and Turbopack root to this package directory so that
  // stray lockfiles elsewhere on the machine don't mis-root the standalone
  // bundle (monorepo-safe).
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
