import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

import { securityHeaders } from "./security-headers";

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: [...securityHeaders] }];
  },
  // The site reads ../CHANGELOG.md, ../package.json, ../guides and ../docs/screens, so tracing starts at the repo.
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  // The home page, the docs and llms.txt regenerate hourly to pick up a new
  // release; those runtime renders read these files from disk.
  outputFileTracingIncludes: {
    // Every page's metadata loads the share-card module (app/social.ts), which
    // reads public/marks/dawg.svg and ../package.json. Vercel serves public/
    // from the CDN and leaves it out of functions, so without this every
    // hourly regeneration throws ENOENT and the stale page is kept for good.
    "/**": ["./public/marks/dawg.svg", "../package.json"],
    "/": [
      "../package.json",
      "../docs/screens/*.json",
      "../docs/screens/frames/*.json",
    ],
    "/screens/[file]": ["../docs/screens/frames/*.json"],
    "/docs": ["../package.json", "../guides/**/*.md"],
    "/docs/[slug]": [
      "../package.json",
      "../guides/**/*.md",
      "../docs/screens/*.json",
    ],
    "/llms.txt": ["../package.json", "../guides/**/*.md"],
  },
};

export default nextConfig;
