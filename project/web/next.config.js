/** @type {import('next').NextConfig} */
const isVercel = Boolean(process.env.VERCEL);

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Docker / self-hosting uses a standalone server. Vercel builds its own
  // serverless output, so don't emit standalone there.
  ...(isVercel ? {} : { output: "standalone" }),
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.googleusercontent.com" }],
  },
  async rewrites() {
    const etlUrl = process.env.ETL_SERVICE_URL;
    if (!etlUrl) return [];
    return [{ source: "/etl-api/:path*", destination: `${etlUrl}/:path*` }];
  },
};
module.exports = nextConfig;
