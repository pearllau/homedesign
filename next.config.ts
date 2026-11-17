import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Node.js host checks app sources without the separate Worker entrypoint.
  typescript: { tsconfigPath: "tsconfig.node.json" },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
