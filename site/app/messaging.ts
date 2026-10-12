import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * dawg's product messaging, word for word from the Hraness portfolio registry
 * (jungle/portfolio-projects.json, id `dawg`). The site has no generated
 * snapshot, so the registry's strings live here; change them there first.
 */
export const productName = "dawg";
export const productDomain = "dawg.sh";
export const productUrl = "https://dawg.sh";
export const repoUrl = "https://github.com/hraness/dawg";

export const productMessaging = {
  category: "Terminal music workstation",
  tagline: "Make music in your terminal, dawg.",
  short:
    "Terminal music workstation where you and an agent shape loops on a piano roll",
  meta: "dawg is a terminal music workstation. Open windows on one local session, play notes through a streaming piano roll, and ask your agent to shape the next loop.",
  medium:
    "dawg is a terminal music workstation. Open several windows on one local session, keep a track in each, and ask your agent to shape the next loop while notes stream through the piano roll.",
  long: "dawg is a music workstation that runs in your terminal. Notes stream down a piano roll toward the hit line as they play, every window you open shares one local session, and a prompt at the bottom lets you add notes, extend loops, move the transport, or ask an agent to write the next change. It brings the coding-agent loop to music: describe the groove you want, hear it, and refine it. Sessions stay on your machine, the score is a file you can read, and playback needs no account.",
  hero: {
    heading: "Make music in your terminal, dawg.",
    summary:
      "dawg is a music workstation that runs in your terminal, with no account and no cloud, just sound. Notes stream down a piano roll as they play, every window shares one local session, and your agent writes the next loop beside you.",
    primaryAction: "Install dawg",
    secondaryAction: "Watch it play",
  },
  blurb: {
    emoji: "🎵",
    text: "dawg is a terminal music workstation. Open several windows on one local session, keep a track in each, ask your agent to shape the next loop, and watch the notes stream through the piano roll as they play. Sessions stay on your machine and playback needs no account.",
    cta: { label: "Ask your agent to set it up", url: "https://dawg.sh" },
  },
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
