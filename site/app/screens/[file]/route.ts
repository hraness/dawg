import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { screensDirectory } from "../screen";

/**
 * The animation frames for the home page's screens, from
 * ../docs/screens/frames, at /screens/<id>.json. Built once at deploy.
 */
export const dynamic = "force-static";
export const dynamicParams = false;

const framesDirectory = join(screensDirectory, "frames");

export function generateStaticParams(): { file: string }[] {
  return readdirSync(framesDirectory)
    .filter((name) => /^[a-z0-9-]+\.json$/u.test(name))
    .map((file) => ({ file }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  if (!/^[a-z0-9-]+\.json$/u.test(file))
    return new Response("not found", { status: 404 });
  // Re-serialized without the capture's indentation.
  const body = JSON.stringify(
    JSON.parse(readFileSync(join(framesDirectory, file), "utf8")),
  );
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
