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
import { SCENES, shoot, type Scene } from "./scenes.ts";

export const SCREENS_DIR = resolve(import.meta.dir, "../../docs/screens");

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

/** Captures `scenes` a few at a time; each scene is its own workspace. */
export async function captureAll(
  scenes: readonly Scene[],
  parallel = 3,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const queue = [...scenes];
  const worker = async () => {
    for (let scene = queue.shift(); scene; scene = queue.shift())
      out.set(scene.id, serialize(scene, await shoot(scene)));
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
    mkdirSync(SCREENS_DIR, { recursive: true });
    for (const [id, text] of captured) {
      writeFileSync(screenPath(id), text);
      const screen = JSON.parse(text) as ScreenFile;
      console.log(
        `${id} ${screen.cols}×${screen.rows} · ${screenText(screen).filter(Boolean).length} rows`,
      );
    }
  }
}
