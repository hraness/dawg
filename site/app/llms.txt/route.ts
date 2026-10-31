import { docsHref, docsPages, docsTrail } from "../docs/pages";

function docsTrailDepth(id: string): number {
  return docsTrail(id).length - 1;
}
import {
  installCommand,
  productMessaging,
  productUrl,
  repoUrl,
  sourceInstallCommands,
} from "../messaging";
import { latestRelease, releaseTarballUrl } from "../release";

// A machine-readable summary of dawg.sh. The install line follows the real
// release state, so it never promises a tarball that is not published.
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const release = await latestRelease();
  const installLines = release.published
    ? `- \`${installCommand}\` installs Bun if missing, downloads v${release.version} with SHA256SUMS from GitHub Releases, verifies the checksum and runs \`bun add -g\`.\n- Or \`bun add -g ${releaseTarballUrl(release.version)}\`.`
    : `- The first GitHub Release is coming soon; until then \`${installCommand}\` exits with a notice. Run from source: \`${sourceInstallCommands.join(" && ")}\`.`;
  const docs = [
    `- [Install](${productUrl}/docs): Install dawg and start a session.`,
    ...docsPages.map((page) => {
      const indent = "  ".repeat(docsTrailDepth(page.id));
      const summary = page.description === "" ? "" : `: ${page.description}`;
      return `${indent}- [${page.title}](${productUrl}${docsHref(page.id)})${summary}`;
    }),
  ].join("\n");
  const body = `# dawg

> ${productMessaging.tagline} ${productMessaging.short}.

${productMessaging.long}

dawg is free and MIT licensed and runs on macOS and Linux on Bun (1.3.14 or newer). Its normal terminal surface is a player and chat. Describe the song or revision you want; the agent composes, arranges and generates vocals through checked tools. Musical progress and pending audio are shown separately. Saved songs play without an account, Python or network access. New generation and analysis use configured providers and optional local tools/models.

## Install

${installLines}
- npm: \`npm i -g @hraness/dawg\` or \`bun add -g @hraness/dawg\`.
- Source: ${repoUrl}

## What ships

- Tracks overview by default, with a horizontal piano roll following the track being written. Ctrl-P pins or unpins inspection; Ctrl-T returns to the overview. Page Up/Down inspect the horizontal range, and Follow returns to the writing cursor.
- Playback starts with the first ready musical draft. A person's later pause or seek remains in control while generation continues.
- Three bundled workflows: original-house, reference-study and recreate-source. House hyperpop originals use stock British bf_emma/Kokoro+WORLD singing. Reference work uses supplied or transcribed lyrics, retains the original vocal for comparison and reports timing, pitch, words and tone separately.
- Project-local songs, vocal takes and resumable progress. Accepted voice takes are reused; fresh voice inference is not promised to produce identical bytes.
- Nine complete editable original hyperpop demos, available offline through \`demo\`.
- Optional advanced commands and editors remain available, including \`/play\` for keyboard recording, \`/patch\` for sound design and \`/showme on\` for command receipts.
- Instruments: sine, piano, pluck, bass, saw, square, triangle, and a synthesized drum kit (kick, snare, clap, rim, tom, hat, openhat).
- Per-track volume, pan, mute, solo, low-pass filter, ping-pong stereo delay, Freeverb-style reverb, and automation lanes for volume, pan, filter cutoff, resonance, delay feedback and delay mix.
- Gapless playback through dawg's native audio sink (prebuilt for macOS and Linux, arm64 and x64; ffplay, SoX play or afplay as fallbacks); \`dawg render out.wav\` writes byte-identical stereo WAVs.
- dawgd, one local daemon per session: many terminal windows share one score and one transport; it recovers from crashes and falls back to a file lock if it cannot start.
- Each new window claims the next unclaimed instrument, so N windows on an N-track song each play a different track.
- Sessions name themselves from the music; /rename, /fork (numbered), /sessions and /resume.
- Providers: \`dawg model key\` picks one: a Vercel AI Gateway key, OpenRouter (browser sign-in), or a Claude or ChatGPT/Codex subscription through xcb (https://xcb.sh). \`dawg model\` picks the model; the default is opus-5.5.
- Patches (/patch): modular instruments and effects from nodes and cables, four macro knobs, eight built-ins, a user library and \`github:\` patches; \`patch()\` in song.ts.
- Optional TAPE editor (\`/tape\`): copy, move, loop and repeat ranges of bars.
- Panes: one song in several terminals, one transport, a letter per pane.
- Themes default, high-contrast and mono; reduced motion; NO_COLOR.

## Docs

${docs}
- [dawg vs Strudel](${productUrl}/vs/strudel): How dawg and Strudel differ and fit together.
- [Changelog](${productUrl}/changelog): Every release, from CHANGELOG.md.
- [DAWG.md](${repoUrl}/blob/main/DAWG.md): Architecture and protocol notes.
`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
