import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * dawg's product messaging. PRODUCT.md records the positioning these lines
 * carry; keep them in step. dawg is not in the portfolio registry yet, so the
 * lines live here instead of a generated snapshot.
 */
export const productName = "dawg";
export const productDomain = "dawg.sh";
export const productUrl = "https://dawg.sh";
export const repoUrl = "https://github.com/hraness/dawg";

export const productMessaging = {
  category: "Terminal music workstation",
  tagline: "A DAW in your terminal, dawg.",
  short:
    "Play it on your keyboard, type short commands, or ask an agent. Songs are typed TypeScript files in your folder.",
  meta: "dawg is a free, open-source DAW for the terminal. Play notes on your computer keyboard, type commands like tempo 96, or ask an agent; it all runs offline except the agent, and songs are TypeScript files you can edit.",
} as const;

const rootPackage: unknown = JSON.parse(
  readFileSync(join(process.cwd(), "..", "package.json"), "utf8"),
);

/** The CLI version on main, read from the repo's package.json at build time. */
export const cliVersion: string = (() => {
  const version = (rootPackage as { version?: unknown }).version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/u.test(version))
    throw new Error("../package.json has no version");
  return version;
})();

export const installCommand = "curl -fsSL https://dawg.sh/install | sh";
export const sourceInstallCommands = [
  `git clone ${repoUrl}.git`,
  "cd dawg",
  "bun install --frozen-lockfile",
  "bun run dawg",
] as const;
