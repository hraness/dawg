import score from "./score.json";

/**
 * The piano-roll highway as an SVG: the real notes of the song every captured
 * screen on dawg.sh plays (`style deep-house 8 3`), streaming down toward the
 * hit line the way the terminal draws them. `scripts/build-highway-score.ts`
 * writes score.json from the same style engine the app runs.
 *
 * No script: the roll is one group that CSS translates over the loop's
 * length in seconds, and `prefers-reduced-motion` holds it on one frame.
 */

const WIDTH = 800;
const LEGEND = 26;
const BEAT = 34;
const ABOVE = 9;
const BELOW = 2;
const HIT_Y = LEGEND + ABOVE * BEAT;
const HEIGHT = HIT_Y + BELOW * BEAT;
const TEXT = "rgb(225 231 239)";
const DIM = "rgb(130 143 164)";
const LINE = "rgb(58 64 80)";
const BAR = "rgb(78 87 104)";

const beats = score.bars * score.beatsPerBar;
const loopHeight = beats * BEAT;
const loopSeconds = (beats * 60) / score.tempoBpm;
const pitches = score.notes.map((note) => note.pitch);
const low = Math.min(...pitches);
const high = Math.max(...pitches);
const column = WIDTH / (high - low + 1);
const stillBeats = 5;

const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const octaves = Array.from({ length: 9 }, (_, octave) => (octave + 1) * 12)
  .filter((pitch) => pitch >= low && pitch <= high)
  .map((pitch) => ({ pitch, label: `${names[pitch % 12]}${pitch / 12 - 1}` }));

function x(pitch: number): number {
  return (pitch - low) * column;
}

export function Highway() {
  const focused = score.tracks.findIndex((track) => track.id === score.focused);
  // Other tracks draw dimmed first so the focused track stays on top.
  const order = [...score.notes.keys()].sort(
    (a, b) =>
      Number(score.notes[a]!.track === focused) -
      Number(score.notes[b]!.track === focused),
  );
  const title = `Piano roll: ${score.tracks.length} tracks of a ${score.style} song, ${score.bars} bars at ${score.tempoBpm} BPM in ${score.key}, streaming toward the hit line`;
  return (
    <figure
      className="dawg-highway"
      style={
        {
          "--dawg-highway-seconds": `${loopSeconds.toFixed(3)}s`,
          "--dawg-highway-loop": `${loopHeight}px`,
          "--dawg-highway-still": `${stillBeats * BEAT}px`,
        } as React.CSSProperties
      }
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={title}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <clipPath id="dawg-highway-clip">
            <rect x="0" y={LEGEND} width={WIDTH} height={HEIGHT - LEGEND} />
          </clipPath>
          <g id="dawg-highway-loop">
            {Array.from({ length: beats }, (_, beat) => (
              <line
                key={beat}
                x1="0"
                x2={WIDTH}
                y1={-beat * BEAT}
                y2={-beat * BEAT}
                stroke={beat % score.beatsPerBar === 0 ? BAR : LINE}
                strokeWidth={beat % score.beatsPerBar === 0 ? 1.5 : 1}
                strokeDasharray={beat % score.beatsPerBar === 0 ? "" : "2 6"}
              />
            ))}
            {order.map((index) => {
              const note = score.notes[index]!;
              const track = score.tracks[note.track]!;
              const bright = note.track === focused;
              const height = Math.max(6, note.length * BEAT - 2);
              return (
                <rect
                  key={index}
                  className="dawg-highway__note"
                  x={x(note.pitch) + 2}
                  y={-(note.start + note.length) * BEAT + 1}
                  width={column - 4}
                  height={height}
                  fill={bright ? track.color : track.dim}
                  fillOpacity={bright ? 0.55 + 0.45 * note.velocity : 0.9}
                />
              );
            })}
          </g>
        </defs>
        <rect width={WIDTH} height={HEIGHT} className="dawg-highway__bg" />
        <g clipPath="url(#dawg-highway-clip)">
          <g className="dawg-highway__roll">
            <use href="#dawg-highway-loop" y={HIT_Y - loopHeight} />
            <use href="#dawg-highway-loop" y={HIT_Y} />
            <use href="#dawg-highway-loop" y={HIT_Y + loopHeight} />
          </g>
          <rect
            className="dawg-highway__played"
            x="0"
            y={HIT_Y + 1}
            width={WIDTH}
            height={HEIGHT - HIT_Y}
            fillOpacity="0.55"
          />
        </g>
        <line
          className="dawg-highway__hit"
          x1="0"
          x2={WIDTH}
          y1={HIT_Y}
          y2={HIT_Y}
          stroke={TEXT}
          strokeWidth="2"
        />
        <text
          className="dawg-highway__text"
          x="8"
          y={HIT_Y - 6}
          fill={TEXT}
          fontWeight="700"
        >
          ▶
        </text>
        {octaves.map((octave) => (
          <text
            key={octave.pitch}
            className="dawg-highway__text"
            x={x(octave.pitch) + column / 2}
            y={HEIGHT - 8}
            fill={DIM}
            textAnchor="middle"
          >
            {octave.label}
          </text>
        ))}
        <text className="dawg-highway__text" x="8" y="17" fill={TEXT}>
          ▶ {score.tempoBpm} BPM · {score.key} · {score.style} · {score.bars}{" "}
          bars
        </text>
        <text
          className="dawg-highway__text"
          x={WIDTH - 8}
          y="17"
          textAnchor="end"
        >
          {score.tracks.map((track, index) => (
            <tspan
              key={track.id}
              fill={index === focused ? track.color : track.dim}
              fontWeight={index === focused ? 700 : 500}
            >
              {index === 0 ? "" : "  "}
              {track.name}
            </tspan>
          ))}
        </text>
      </svg>
    </figure>
  );
}

/** What the figure shows, for the caption beside it. */
export const highwayFacts = {
  style: score.style,
  seed: score.seed,
  tempoBpm: score.tempoBpm,
  key: score.key,
  bars: score.bars,
  tracks: score.tracks.map((track) => track.name),
  notes: score.notes.length,
  loopSeconds,
} as const;
