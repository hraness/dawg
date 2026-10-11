/**
 * The project `AGENTS.md` block (design §5.4): what a coding agent in
 * another terminal needs to work on a dawg project. `dawg init` writes the
 * file when absent (plus `CLAUDE.md` = `@AGENTS.md`); `dawg docs --agent
 * --write` refreshes only the text between the markers.
 *
 * No imports beyond node: init.ts loads this, and it must stay light.
 */

export const AGENTS_BEGIN = "<!-- dawg:begin -->";
export const AGENTS_END = "<!-- dawg:end -->";
export const AGENTS_MD_MAX_BYTES = 6 * 1024;

const BLOCK = `# dawg project

This folder is a dawg song. dawg (the terminal DAW) and you edit the same
files; the open dawg window reloads when a file changes.

## Layout
- \`song.ts\`: tempo, meter, form and the track list (\`export default song({...})\`).
- \`tracks/<slug>/track.ts\`: one \`track({...})\` per track; samples in \`tracks/<slug>/samples/\`.
- Import the SDK as \`import { song, track } from "dawg"\` (vendored in \`.dawg/sdk/v1.ts\`).
- \`.dawg/\` is dawg's state (sessions, history.db, settings). Do not edit it by hand.

## Loop
1. Edit \`song.ts\` or \`tracks/<slug>/track.ts\`.
2. Run \`dawg check\`: typecheck and evaluate; exit 1 lists problems with file:line.
3. Watch \`dawg history --follow\` in another terminal to see each edit land as a revision.
   To be credited for an edit the open window already reloaded, name your files:
   \`dawg check --as <you> --files tracks/bass/track.ts\`.

## History and comments
- \`dawg history\`: newest edits, undo/redo, comments and agent turns, one line each.
- Filter: \`dawg history --track bass --kind comment\`, \`--bars 9-16\`, \`--param cutoff\`,
  \`--actor human\`, \`--tag love\`, \`--grep chorus\`, \`--since 1h\`; \`--json\` for one object per line.
- \`dawg history show <seq|id|rev:N>\`: one row in full (ops, context).
- Leave a note for the human and the in-app agent: \`dawg history comment "tightened the hats #groove"\`.
- Read the human's comments before editing a part: they mark what to keep (#love) or change.

## Audio
- \`dawg media chop --help\`: info, onsets, beats, cut, slice, stretch, pitch, fades and more.
- \`dawg media --help\`: download, stems, analyze, notes (audio to MIDI), sample.
- Outputs are new 24-bit WAVs with a .json sidecar; inputs are never overwritten.

## More
- \`dawg docs --agent\`: the agent docs index (tool reference, recipes, guide notes).
- \`dawg docs --agent <page>\`, e.g. \`dawg docs --agent recipe/chop-a-break\`.
- DAWG.md in the dawg package is the full human manual.`;

/** The dawg-owned block, markers included, ≤ 6 KiB. */
export function renderAgentsMd(): string {
  return `${AGENTS_BEGIN}\n${BLOCK}\n${AGENTS_END}\n`;
}

/** `CLAUDE.md` written next to a fresh AGENTS.md. */
export const CLAUDE_MD = "@AGENTS.md\n";

/**
 * Refreshes the dawg block in `existing` (undefined: a new file). Text
 * outside the markers is kept byte for byte; a file without markers gets the
 * block appended once. Returns the same string when nothing changes.
 */
export function upsertAgentsMd(existing: string | undefined): string {
  const block = renderAgentsMd();
  if (existing === undefined || existing.length === 0) return block;
  const begin = existing.indexOf(AGENTS_BEGIN);
  const end = existing.indexOf(AGENTS_END, begin + AGENTS_BEGIN.length);
  if (begin < 0 || end < 0) {
    const sep = existing.endsWith("\n\n")
      ? ""
      : existing.endsWith("\n")
        ? "\n"
        : "\n\n";
    return `${existing}${sep}${block}`;
  }
  let after = end + AGENTS_END.length;
  if (existing[after] === "\n") after += 1;
  return `${existing.slice(0, begin)}${block}${existing.slice(after)}`;
}
