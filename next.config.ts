import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // CryptoVault is 100% client-side: every private key operation happens in the
  // browser. Nothing is rendered on a server that could ever observe a secret.
  typescript: { ignoreBuildErrors: false },
  // Some chain SDKs (xrpl, @ton, @solana/web3.js) still reach for Node built-ins.
  // We shim `Buffer`/`process` at runtime in src/lib/polyfills.ts; these aliases
  // stop the bundler from trying to pull in the real Node modules.
  turbopack: {
    resolveAlias: {
      fs: { browser: './src/lib/shims/empty.ts' },
      net: { browser: './src/lib/shims/empty.ts' },
      tls: { browser: './src/lib/shims/empty.ts' },
      child_process: { browser: './src/lib/shims/empty.ts' },
    },
  },
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        // A wallet must never be embedded or have its keys exfiltrated by a
        // third-party script. Keep this tight if you add analytics.
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    },
  ],
};

export default nextConfig;
