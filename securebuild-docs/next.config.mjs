import nextra from 'nextra'

const withNextra = nextra({
  defaultShowCopyCode: true
})

export default withNextra({
  output: 'standalone',
  webpack: (config, { isServer }) => {
    // Exclude server-only modules from client bundle
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
      };

      // Exclude pg and other database modules from client bundle
      config.externals = config.externals || [];
      config.externals.push({
        'pg': 'commonjs pg',
        'pg-native': 'commonjs pg-native',
      });
    }
    return config;
  },
  serverExternalPackages: ['pg', 'pg-native'],
})
