import { socialImageFor } from "../social";

export { contentType, size } from "../social";
export const alt =
  "dawg docs: quickstart, commands, keys, sessions and providers";

export default function DocsOpengraphImage() {
  return socialImageFor({
    path: "/docs",
    eyebrow: "Docs",
    headline: "Make your first loop",
    description:
      "Install dawg, open a session, ask the agent for a groove and open more windows.",
  });
}
