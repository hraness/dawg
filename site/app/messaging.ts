import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Site messaging follows the approved product record and README. Metadata,
 * machine-readable summaries and visible copy share these strings.
 */
export const productName = "dawg";
export const productDomain = "dawg.sh";
export const productUrl = "https://dawg.sh";
export const repoUrl = "https://github.com/hraness/dawg";

export const productMessaging = {
  category: "Song studio for your terminal",
  tagline: "Make music in your terminal, dawg.",
  short:
    "Generate songs with an agent, then listen and steer from a terminal player and chat",
  meta: "dawg generates songs with an agent. Follow the tracks, listen to ready drafts and steer revisions from a local terminal player and chat.",
  medium:
    "dawg generates songs with an agent and renders them locally. Describe a song, watch its tracks take shape, and listen while the agent keeps working.",
  long: "dawg is a song studio with a terminal player and chat. Describe an original song or bring a reference; bundled workflows guide house hyperpop writing, reference study and stock bf_emma singing. The tracks overview opens first, and a horizontal piano roll follows the track being written. Ctrl-P pins the inspected track. The first ready musical draft starts automatically, while pause and seek stay under your control. Songs, vocal takes and workflow progress stay in your project. Saved songs play without an account, Python or network access; new generation and analysis use configured providers and local tools.",
  hero: {
    heading: "Make music in your terminal, dawg.",
    summary:
      "Describe a song, watch its tracks take shape, and hear the first ready draft. A horizontal piano roll follows the track being written; Ctrl-P pins it. Pause, seek and steer revisions from the player and chat.",
    primaryAction: "Install dawg",
    secondaryAction: "Watch it play",
  },
  blurb: {
    emoji: "🎵",
    text: "dawg generates songs with an agent in a terminal player and chat. Follow the tracks, hear a ready draft and steer the next revision. Bundled workflows write house hyperpop and study references with stock bf_emma vocals. Saved songs stay local and play without an account.",
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
