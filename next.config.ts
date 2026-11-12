import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every screen is per-user and behind login, so pages render on request.
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
