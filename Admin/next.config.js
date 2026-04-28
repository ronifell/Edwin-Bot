/** @type {import('next').NextConfig} */
const backendBase =
  (process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_INTERNAL_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backendBase}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
