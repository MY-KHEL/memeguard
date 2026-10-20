import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; let Next compile them.
  transpilePackages: ["@meme-guard/shared-types", "@meme-guard/core", "@meme-guard/db", "@meme-guard/providers", "@meme-guard/trading"],
  // Node-only server packages: logger, Postgres driver, Redis client.
  serverExternalPackages: ["pino", "postgres", "ioredis"],
  poweredByHeader: false,
};

export default nextConfig;
