import type { NextConfig } from "next"
import path from "node:path"

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/db", "@repo/cron-auth", "@repo/crypto", "@repo/composio", "@repo/airbnb-parse", "@repo/lead-contact"],
  serverExternalPackages: ["@prisma/client"],
  turbopack: {
    root: path.join(import.meta.dirname, "../.."),
  },
  allowedDevOrigins: ['d216-190-25-118-217.ngrok-free.app'],
}

export default nextConfig
