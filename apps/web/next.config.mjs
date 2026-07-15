/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma client is generated at the repo root; keep it external to the
  // server bundle so Next doesn't try to bundle its native engine.
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs", "node-cron"],
    // Enables instrumentation.ts (Next 14) — boots the in-process cron
    // scheduler once per server start.
    instrumentationHook: true,
  },
};

export default nextConfig;
