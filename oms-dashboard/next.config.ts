import type { NextConfig } from 'next';

// The Myntra OMS data API (orders, detail, label/invoice PDFs, status actions) lives
// in the Express backend. Keep credentials server-side there and proxy to it.
const BACKEND = process.env.OMS_BACKEND || 'http://localhost:3100';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
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
