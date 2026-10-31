/**
 * The local study shelf: your own dawg projects, listed beside the demo
 * songs and loaded the same way, without shipping in the package.
 *
 * Each folder in the shelf directory that holds a dawg project (dawg.json and
 * song.ts) is one study. An optional `shelf.json` beside its dawg.json gives
 * `{ "title", "style", "description" }`. The shelf lives in
 * `$DAWG_SHELF`, else `$XDG_CONFIG_HOME/dawg/shelf` (default
 * `~/.config/dawg/shelf`); a symlinked study folder is followed.
 *
 * Loading evaluates the study's song.ts and copies the project samples it
 * plays into `tracks/<track>/shelf/<study>/…` here, so the loaded song plays
 * from this project and never overwrites a file it did not write.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { evaluateProject, formatDiagnostic } from "../../core/sdk/eval.ts";
import { TrackScore, type TrackScoreData } from "../../core/score.ts";

export type ShelfStudy = Readonly<{
  slug: string;
  dir: string;
  title: string;
  style: string;
  description: string;
}>;

export const SHELF_PREFIX = "local:";
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

export function shelfDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.DAWG_SHELF) return resolve(env.DAWG_SHELF);
  const config = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(config, "dawg", "shelf");
}

/** Studies in the shelf, by title. A missing or unreadable shelf is empty. */
export function listShelf(dir = shelfDir()): readonly ShelfStudy[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const studies: ShelfStudy[] = [];
  for (const name of names) {
    const slug = name.toLowerCase();
    if (!SLUG.test(slug) || name !== slug) continue;
    const path = join(dir, name);
    try {
      if (!statSync(path).isDirectory()) continue;
      if (!existsSync(join(path, "dawg.json"))) continue;
      if (!existsSync(join(path, "song.ts"))) continue;
    } catch {
      continue;
    }
    let meta: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readFileSync(join(path, "shelf.json"), "utf8"));
      if (parsed && typeof parsed === "object") meta = parsed;
    } catch {
      // No metadata: the folder name stands in.
    }
    const text = (key: string, fallback: string) =>
      typeof meta[key] === "string" && meta[key]
        ? (meta[key] as string).slice(0, 200)
        : fallback;
    studies.push({
      slug,
      dir: path,
      title: text("title", name),
      style: text("style", "local study"),
      description: text("description", `your project in ${path}`),
    });
  }
  return studies.sort((a, b) => a.title.localeCompare(b.title));
}

/** `local:<slug>` or a bare slug that names no shelf demo. */
export function findShelfStudy(
  value: string,
  dir = shelfDir(),
): ShelfStudy | undefined {
  const raw = value.trim().toLowerCase();
  const slug = raw.startsWith(SHELF_PREFIX)
    ? raw.slice(SHELF_PREFIX.length)
    : raw;
  return listShelf(dir).find((study) => study.slug === slug);
}

export function shelfInfoLines(study: ShelfStudy): string[] {
  return [
    `${study.title} · ${study.style} · local study`,
    study.description,
    "",
    `Folder · ${study.dir}`,
    `demo ${SHELF_PREFIX}${study.slug} loads it here · its samples copy into tracks/<track>/shelf/${study.slug}/`,
    "Local studies stay on this machine; they are not part of dawg.",
  ];
}

const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Evaluate a study and bring its project samples into `workspace`. Every
 * `tracks/…` sample path is rewritten under the track's shelf folder; an
 * existing file there with different bytes stops the load untouched.
 */
export async function loadShelfStudy(
  study: ShelfStudy,
  workspace: string,
  evaluate: typeof evaluateProject = evaluateProject,
): Promise<TrackScore> {
  const evaluated = await evaluate(study.dir);
  if (!evaluated.ok)
    throw new Error(
      `${study.title}: ${evaluated.diagnostics.map(formatDiagnostic).join("; ").slice(0, 300)}`,
    );
  const json = structuredClone(evaluated.score.toJSON()) as TrackScoreData;
  const copies = new Map<string, string>();
  const place = (trackId: string, src: string) => {
    if (!src.startsWith("tracks/")) return src;
    const from = resolve(study.dir, src);
    if (relative(study.dir, from).startsWith(".."))
      throw new Error(`${study.title}: ${src} leaves the study folder`);
    const rest = src.split("/").slice(2).join("/");
    const to = `tracks/${trackId}/shelf/${study.slug}/${rest}`;
    copies.set(to, from);
    return to;
  };
  for (const track of json.tracks ?? []) {
    const voices = track.sampler?.voices;
    if (voices)
      for (const ref of Object.values(voices))
        (ref as { src: string }).src = place(track.id, ref.src);
    const ir = (track.reverb as { ir?: { src?: string } } | undefined)?.ir;
    if (ir?.src) ir.src = place(track.id, ir.src);
  }
  // Check every destination before writing any, so a refusal changes nothing.
  const writes: [from: string, target: string][] = [];
  for (const [to, from] of copies) {
    const target = join(workspace, to);
    if (existsSync(target)) {
      const [have, want] = await Promise.all([
        readFile(target),
        readFile(from),
      ]);
      if (sha256(have) === sha256(want)) continue;
      throw new Error(
        `${to} already exists with other audio · move it, then load again`,
      );
    }
    writes.push([from, target]);
  }
  for (const [from, target] of writes) {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(from, target);
  }
  return new TrackScore(json);
}
