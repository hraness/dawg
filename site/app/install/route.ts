import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Serves https://dawg.sh/install, the script behind `curl -fsSL https://dawg.sh/install | sh`.
 * It is site/install.sh verbatim; the script resolves the latest GitHub
 * Release itself, so a new release needs no site deploy.
 */
export const dynamic = "force-static";

const body = readFileSync(join(process.cwd(), "install.sh"), "utf8");

export function GET(): Response {
  return new Response(body, {
    headers: {
      // Plain text, so a browser shows the script for reading before you pipe it.
      "cache-control": "public, max-age=300",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
