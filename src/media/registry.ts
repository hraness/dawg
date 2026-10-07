/** Lookup over `MEDIA_TOOLS` shared by the CLI and tests. */
import type { AgentTool } from "../agent/tools.ts";
import { MEDIA_TOOLS } from "./tools.ts";

export function findMediaTool(name: string): AgentTool | undefined {
  return MEDIA_TOOLS.find((tool) => tool.name === name);
}

export { MEDIA_TOOLS };
