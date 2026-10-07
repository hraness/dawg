import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TERMINAL } from "./draw";
import { HighwayPlayer } from "./highway-player";
import { cellColors, parseCast, screenAt, type CellStyle } from "./vt";

export const DEMO_CAST_PATH = "/demo/highway.cast";

interface Run {
  text: string;
  style: CellStyle;
}

function styleKey(style: CellStyle): string {
  return JSON.stringify(style);
}

/** The recording's last frame, as runs of same-styled text per row. */
function posterRows(): Run[][] {
  const cast = parseCast(
    readFileSync(join(process.cwd(), "public", DEMO_CAST_PATH), "utf8"),
  );
  const screen = screenAt(cast, cast.frames.length - 1);
  return screen.cells.map((row) => {
    const runs: Run[] = [];
    for (const cell of row) {
      const last = runs.at(-1);
      if (last !== undefined && styleKey(last.style) === styleKey(cell.style))
        last.text += cell.ch;
      else runs.push({ text: cell.ch, style: cell.style });
    }
    return runs;
  });
}

const LABEL =
  "Recording of dawg in an 80 by 24 terminal. The prompt asks for a dusty minor groove at 96 BPM with drums and a bass line; the agent's tool calls add a kick, snare and hat pattern and a bass part, each shown as a revision, and the notes scroll down the highway toward the hit line. A second prompt brings in keys with a little reverb.";

export function HighwayDemo() {
  const rows = posterRows();
  return (
    <figure className="dawg-demo">
      <div className="dawg-demo__chrome" aria-hidden="true">
        <span className="dawg-demo__lights">
          <span />
          <span />
          <span />
        </span>
        <span className="dawg-demo__title">dawg — 80×24</span>
      </div>
      <HighwayPlayer castUrl={DEMO_CAST_PATH} label={LABEL}>
        <pre className="dawg-poster" role="img" aria-label={LABEL}>
          {rows.map((runs, y) => (
            <span key={y} className="dawg-poster__row">
              {runs.map((run, i) => {
                const { fg, bg } = cellColors(run.style, TERMINAL);
                return (
                  <span
                    key={i}
                    style={{
                      color: fg,
                      backgroundColor: bg === TERMINAL.bg ? undefined : bg,
                      fontWeight: run.style.bold ? 700 : undefined,
                      fontStyle: run.style.italic ? "italic" : undefined,
                      opacity: run.style.dim ? 0.6 : undefined,
                    }}
                  >
                    {run.text}
                  </span>
                );
              })}
            </span>
          ))}
        </pre>
      </HighwayPlayer>
      <figcaption className="dawg-demo__caption">
        Real frames from dawg&rsquo;s renderer, recorded with a fake clock by{" "}
        <code>site/scripts/record-demo.ts</code>. The agent turns are scripted;
        every tool call goes through dawg&rsquo;s own validation and score
        operations.
      </figcaption>
    </figure>
  );
}
