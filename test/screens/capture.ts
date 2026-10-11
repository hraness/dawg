/**
 * Writes the docs screens to docs/screens/<id>.json from the real TUI.
 *
 *   bun test/screens/capture.ts            capture every scene
 *   bun test/screens/capture.ts tape help  capture only these
 *   bun test/screens/capture.ts --check    exit 1 when a committed screen is stale
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { screenText, type ScreenFile } from "./driver.ts";
import { SCENES, shoot, type Scene, type Shot } from "./scenes.ts";

export const SCREENS_DIR = resolve(import.meta.dir, "../../docs/screens");
/** Animated screens: the frames dawg drew on the way to the still. */
export const FRAMES_DIR = join(SCREENS_DIR, "frames");

/** The committed form: one JSON document per screen, rows one per line. */
export function serialize(scene: Scene, screen: ScreenFile): string {
  const head = {
    id: screen.id,
    title: scene.title,
    cols: screen.cols,
    rows: screen.rows,
    styles: screen.styles,
  };
  const body = JSON.stringify(head, null, 2).replace(/\n}$/, "");
  const rows = screen.lines
    .map((runs) => `    ${JSON.stringify(runs)}`)
    .join(",\n");
  return `${body},\n  "lines": [\n${rows}\n  ]\n}\n`;
}

export function screenPath(id: string): string {
  return join(SCREENS_DIR, `${id}.json`);
}

export function framesPath(id: string): string {
  return join(FRAMES_DIR, `${id}.json`);
}

/**
 * The committed animation: styles shared by every frame, then each frame's
 * clock time (ms from the first) and only the rows that changed since the
 * frame before, one row per line. The last frame is the still.
 */
export function serializeFrames(shot: Shot): string | undefined {
  if (shot.frames.length === 0) return undefined;
  const styles: ScreenFile["styles"] = [];
  const index = new Map<string, number>();
  const intern = (style: ScreenFile["styles"][number]): number => {
    const key = JSON.stringify(style);
    let found = index.get(key);
    if (found === undefined) {
      found = styles.length;
      styles.push(style);
      index.set(key, found);
    }
    return found;
  };
  const t0 = shot.frames[0]!.t;
  let previous: string[] = [];
  const frames = shot.frames.map(({ t, screen }) => {
    const rows: string[] = [];
    screen.lines.forEach((runs, y) => {
      const row = JSON.stringify(
        runs.map(([text, style]) => [text, intern(screen.styles[style] ?? {})]),
      );
      if (row !== previous[y]) rows.push(`      [${y}, ${row}]`);
      previous[y] = row;
    });
    return `    { "t": ${t - t0}, "rows": [\n${rows.join(",\n")}\n    ] }`;
  });
  const head = JSON.stringify(
    {
      id: shot.screen.id,
      cols: shot.screen.cols,
      rows: shot.screen.rows,
      styles,
    },
    null,
    2,
  ).replace(/\n}$/, "");
  previous = [];
  return `${head},\n  "frames": [\n${frames.join(",\n")}\n  ]\n}\n`;
}

/**
 * Captures `scenes` a few at a time; each scene is its own workspace. Keys
 * are screen ids, plus `frames/<id>` for an animated screen.
 */
export async function captureAll(
  scenes: readonly Scene[],
  parallel = 3,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const queue = [...scenes];
  const worker = async () => {
    for (let scene = queue.shift(); scene; scene = queue.shift()) {
      const shot = await shoot(scene);
      out.set(scene.id, serialize(scene, shot.screen));
      const frames = serializeFrames(shot);
      if (frames !== undefined) out.set(`frames/${scene.id}`, frames);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return out;
}

/** The ids whose committed screen differs from a fresh capture. */
export function stale(captured: Map<string, string>): string[] {
  return [...captured]
    .filter(
      ([id, text]) =>
        !existsSync(screenPath(id)) ||
        readFileSync(screenPath(id), "utf8") !== text,
    )
    .map(([id]) => id);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const only = args.filter((arg) => !arg.startsWith("--"));
  const scenes = only.length
    ? SCENES.filter((scene) => only.includes(scene.id))
    : SCENES;
  const captured = await captureAll(scenes);
  if (check) {
    const ids = stale(captured);
    if (ids.length) {
      console.error(`stale screens: ${ids.join(", ")} · run bun run screens`);
      process.exit(1);
    }
    console.log(`${captured.size} screens up to date`);
  } else {
    mkdirSync(FRAMES_DIR, { recursive: true });
    for (const [id, text] of captured) {
      writeFileSync(screenPath(id), text);
      if (id.startsWith("frames/")) continue;
      const screen = JSON.parse(text) as ScreenFile;
      console.log(
        `${id} ${screen.cols}×${screen.rows} · ${screenText(screen).filter(Boolean).length} rows`,
      );
    }
  }
}
