import type { NextConfig } from 'next';

// The Myntra OMS data API (orders, detail, label/invoice PDFs, status actions) lives
// in the Express backend. Keep credentials server-side there and proxy to it.
const BACKEND = process.env.OMS_BACKEND || 'http://localhost:3100';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  // Inline the session secret at build time so the auth middleware (Edge runtime,
  // which doesn't read arbitrary runtime env) can verify the cookie. This lives
  // only in the server-side edge bundle — it is never sent to the browser.
  env: {
    OMS_SESSION_SECRET: process.env.OMS_SESSION_SECRET || '',
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/orders/api/:path*', destination: `${BACKEND}/orders/api/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
