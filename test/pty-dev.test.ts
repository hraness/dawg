/**
 * Dev mode and hot reload end to end at 80x24 (design §5): a second
 * process (a coding agent in another terminal) edits a track file and runs
 * `dawg check --as claude-code`; the running editor hot-reloads it as one
 * revision, the card names the coding agent, and history holds the edit
 * credited to it. Under `dawg dev` the sync also writes `log` rows; a
 * plain launch never does.
 */
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initProject } from "../src/project/init.ts";
import { launch, MAIN, supported } from "./pty-harness.ts";

type Row = {
  kind: string;
  sub: string | null;
  actor_kind: string;
  actor_id: string | null;
  summary: string;
};

function rows(dir: string): Row[] {
  const path = join(dir, ".dawg", "history.db");
  if (!existsSync(path)) return [];
  const db = new Database(path, { readonly: true });
  try {
    return db
      .query(
        "SELECT kind, sub, actor_kind, actor_id, summary FROM events ORDER BY seq",
      )
      .all() as Row[];
  } finally {
    db.close();
  }
}

async function walk(env: Record<string, string>, argv: string[], dev: boolean) {
  const dir = await mkdtemp(join(tmpdir(), "dawg-pty-dev-"));
  await initProject(dir);
  const t = await launch(80, 24, env, argv, dir);
  const file = join(dir, "tracks", "bass", "track.ts");
  try {
    await t.until(() => t.vt.text().includes(" NOW "), "prompt");
    // The sync prints the session's bass track into the project.
    await t.until(() => existsSync(file), "bass file printed");
    if (dev) expect(t.vt.text()).toContain("dev");
    await t.settle("printed");
    const revBefore = t.state()?.rev ?? 0;
    const before = await readFile(file, "utf8");
    // The other terminal: edit the file, then check it as a named agent.
    await writeFile(
      file,
      `import { track, note } from "dawg";\n\nexport default track({\n  id: "bass",\n  name: "bass",\n  instrument: "bass",\n  notes: [note("C2", 0), note("G2", 2)],\n});\n`,
    );
    expect(before).not.toContain(`note("G2", 2)`);
    const check = Bun.spawn(
      [process.execPath, MAIN, "check", "--as", "claude-code"],
      {
        cwd: dir,
        env: { PATH: process.env.PATH ?? "", HOME: dir, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(await check.exited).toBe(0);
    await t.until(
      () =>
        rows(dir).some(
          (row) => row.kind === "edit" && row.actor_id === "claude-code",
        ),
      "edit credited to claude-code",
    );
    await t.settle("credited");
    expect(t.vt.text()).toMatch(/applied from files|by claude-code/);
    // One revision for the whole reload.
    expect(t.state()?.rev).toBe(revBefore + 1);
    expect(t.vt.wrapsSinceClear).toBe(0);
    expect(t.proc.exitCode).toBeNull();
  } finally {
    t.proc.kill();
    await t.proc.exited;
  }
  const all = rows(dir);
  const edit = all.find(
    (row) => row.kind === "edit" && row.actor_id === "claude-code",
  );
  expect(edit).toMatchObject({ actor_kind: "external" });
  expect(edit?.summary).toContain("note");
  const logs = all.filter((row) => row.kind === "log" && row.sub !== "error");
  return { logs, dir };
}

test.skipIf(!supported)(
  "real PTY 80x24 NO_COLOR: dawg dev hot-reloads another process's edit, credited, with log rows",
  async () => {
    const { logs } = await walk(
      { NO_COLOR: "1" },
      ["dev", "--track", "bass"],
      true,
    );
    expect(logs.some((row) => row.summary.startsWith("sync · eval ok"))).toBe(
      true,
    );
  },
  60_000,
);

test.skipIf(!supported)(
  "real PTY 80x24 color: without dev mode the reload is credited but no log rows appear",
  async () => {
    const { logs } = await walk({}, ["--track", "bass"], false);
    expect(logs).toEqual([]);
  },
  60_000,
);
