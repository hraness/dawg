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
  category: "A music app for your terminal",
  tagline: "Make music in your terminal, dawg.",
  short:
    "Play it on your keyboard and shape it with four knobs. When you want more, it opens up into a modular patcher, an agent you can talk to, and songs saved as code.",
  meta: "dawg is a free, open-source music app for the terminal. Play notes on your computer keyboard, turn four knobs, patch your own sounds or ask an agent. It runs offline except the agent, and songs can be saved as TypeScript files.",
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
