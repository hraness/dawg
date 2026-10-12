/**
 * Writes `app/highway/score.json`: the notes of the song every captured
 * screen plays (`style deep-house 8 3`, see test/screens/scenes.ts), so the
 * landing page's piano-roll highway draws a real score rather than a mock.
 *
 *   bun run scripts/build-highway-score.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateStyle, styleScore } from "../../core/styles/generate.ts";
import { resolveStyle } from "../../core/styles/index.ts";
import { accompanimentStyle } from "../../core/styles/starters.ts";
import { accentStyle, getTheme, shade } from "../../tui/theme.ts";

const style = resolveStyle("deep-house");
let generated = generateStyle(accompanimentStyle(style), { bars: 8, seed: 3 });
if ((generated.data.notes ?? []).length === 0)
  generated = generateStyle(style, { bars: 8, seed: 3 });
const score = styleScore(generated);

// The default theme's stable accent per track, as the TUI's highway draws it.
// The captures focus the bass track, so the page does too.
const theme = getTheme("default");
const css = (color: { r: number; g: number; b: number }) =>
  `rgb(${color.r} ${color.g} ${color.b})`;
const tracks = score.tracks.map((track) => {
  const accent = accentStyle(theme, track.id);
  const fg = accent.fg;
  if (fg === undefined) throw new Error(`no accent for track ${track.id}`);
  return {
    id: track.id,
    name: track.name,
    instrument: track.instrument,
    color: css(fg),
    // Unfocused tracks draw dimmed under the focused one (tui/highway.ts).
    dim: css(shade(accent, -0.5).fg ?? fg),
  };
});
const notes = score.notes
  .map((note) => ({
    track: score.tracks.findIndex((track) => track.id === note.trackId),
    pitch: note.pitch,
    start: Number((note.startTick / score.ticksPerBeat).toFixed(3)),
    length: Number((note.durationTicks / score.ticksPerBeat).toFixed(3)),
    velocity: Number(note.velocity.toFixed(2)),
  }))
  .sort((a, b) => a.start - b.start || a.track - b.track || a.pitch - b.pitch);

const out = {
  style: "deep-house",
  seed: 3,
  tempoBpm: score.tempoBpm,
  beatsPerBar: score.beatsPerBar,
  bars: score.bars,
  key: score.key,
  focused: "bass",
  tracks,
  notes,
};
const file = join(import.meta.dir, "..", "app", "highway", "score.json");
writeFileSync(file, `${JSON.stringify(out)}\n`);
console.log(
  `wrote ${file}: ${tracks.length} tracks, ${notes.length} notes, ${score.bars} bars at ${score.tempoBpm} BPM`,
);
