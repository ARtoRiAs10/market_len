/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
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
