/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    // Skip type checking during `next build` (faster builds, useful for Docker)
    ignoreBuildErrors: true,
  },
  eslint: {
    // Skip ESLint during `next build`
    ignoreDuringBuilds: true,
  },
};
module.exports = nextConfig;
