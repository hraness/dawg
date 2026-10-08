import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

import { securityHeaders } from "./security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders] }];
  },
  // The site reads ../CHANGELOG.md, ../package.json and ../guides, so tracing starts at the repo.
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  // The home page, the docs and llms.txt regenerate hourly to pick up a new
  // release; those runtime renders read these files from disk.
  outputFileTracingIncludes: {
    "/": ["./public/demo/highway.cast", "../package.json"],
    "/docs": ["../package.json", "../guides/**/*.md"],
    "/docs/[slug]": ["../package.json", "../guides/**/*.md"],
    "/llms.txt": ["../package.json", "../guides/**/*.md"],
  },
};

export default nextConfig;
