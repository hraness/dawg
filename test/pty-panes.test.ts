/**
 * Panes (design §12): two or three real terminals on one project, each a
 * pane over the same dawgd session. Covers `dawg pane <screen>`, the pane
 * letters in the header and `pane`, author cards when another pane edits
 * this pane's track, and the one audio engine per machine: every pane's
 * play-mode notes and the transport stream go through a single player.
 */
import { afterAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { VirtualTerminal } from "./vt.ts";

const MAIN = resolve(import.meta.dir, "../src/main.ts");
const FAKE_PLAYER = resolve(
  import.meta.dir,
  "../src/audio/fixtures/fake-player.ts",
);
const supported =
  process.platform !== "win32" &&
  typeof (Bun as unknown as { Terminal?: unknown }).Terminal === "function";

const COLS = 120;
const ROWS = 32;

interface PtyTerminal {
  write(data: string): void;
  close(): void;
}

type Pane = {
  name: string;
  proc: ReturnType<typeof Bun.spawn>;
  terminal: PtyTerminal;
  vt: VirtualTerminal;
};

const workspaces: string[] = [];
const panes = new Set<Pane>();

function env(
  workspace: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: workspace,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    NO_COLOR: "1",
    DAWG_AUDIO: "0",
    DAWG_AI: "0",
    DAWG_PROVIDER: "gateway",
    DAWG_CREDENTIAL_STORE: "file",
    DAWG_CONFIG_DIR: join(workspace, ".config"),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    ...extra,
  };
}

function open(
  workspace: string,
  name: string,
  argv: string[] = [],
  extra: Record<string, string> = {},
): Pane {
  const vt = new VirtualTerminal(COLS, ROWS);
  const decoder = new TextDecoder();
  const proc = Bun.spawn([process.execPath, MAIN, ...argv], {
    cwd: workspace,
    env: env(workspace, extra),
    terminal: {
      cols: COLS,
      rows: ROWS,
      data(_terminal: unknown, data: Uint8Array) {
        vt.write(decoder.decode(data, { stream: true }));
      },
    },
  } as Parameters<typeof Bun.spawn>[1]);
  const terminal = (proc as unknown as { terminal: PtyTerminal }).terminal;
  const pane = { name, proc, terminal, vt };
  panes.add(pane);
  return pane;
}

async function until(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  context: () => string = () => "",
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${label}\n${context()}`);
    await Bun.sleep(25);
  }
}

const header = (p: Pane) => p.vt.lines()[0] ?? "";
const screens = (ps: readonly Pane[]) =>
  ps.map((p) => `--- ${p.name}\n${p.vt.text()}`).join("\n");

async function ready(p: Pane): Promise<void> {
  await until(
    () => /rev \d+/.test(header(p)),
    `${p.name} ready`,
    () => p.vt.text(),
  );
}

async function send(p: Pane, line: string): Promise<void> {
  p.terminal.write(`${line}\r`);
  await Bun.sleep(40);
}

function revision(p: Pane): number {
  const match = header(p).match(/rev (\d+)/);
  return match ? Number(match[1]) : -1;
}

async function edit(p: Pane, line: string): Promise<number> {
  const before = revision(p);
  await send(p, line);
  await until(
    () => revision(p) > before,
    `${p.name}: ${line}`,
    () => p.vt.text(),
  );
  return revision(p);
}

async function close(p: Pane): Promise<void> {
  p.terminal.write("\u0003");
  const code = await Promise.race([
    p.proc.exited,
    Bun.sleep(5_000).then(() => "timeout" as const),
  ]);
  if (code === "timeout") p.proc.kill("SIGKILL");
  p.terminal.close();
  panes.delete(p);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function daemonPids(workspace: string): Promise<number[]> {
  const dir = join(workspace, ".dawg", "sessions");
  const names = await readdir(dir).catch(() => [] as string[]);
  const pids: number[] = [];
  for (const name of names.filter((n) => n.endsWith(".daemon.lock"))) {
    try {
      const owner = JSON.parse(
        await readFile(join(dir, name, "owner"), "utf8"),
      ) as { pid?: unknown };
      if (typeof owner.pid === "number" && alive(owner.pid))
        pids.push(owner.pid);
    } catch {
      // being rewritten
    }
  }
  return pids;
}

afterAll(async () => {
  for (const p of panes) {
    p.proc.kill("SIGKILL");
    p.terminal.close();
  }
  for (const workspace of workspaces) {
    for (const pid of await daemonPids(workspace)) process.kill(pid, "SIGKILL");
    await rm(workspace, { recursive: true, force: true });
  }
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-panes-"));
  workspaces.push(dir);
  return dir;
}

test.skipIf(!supported)(
  "panes: letters, `dawg pane <screen>`, `pane` list, author cards on a shared track",
  async () => {
    const dir = await workspace();
    const a = open(dir, "A", ["--new", "--track", "drums"]);
    await ready(a);
    await edit(a, "pattern kick every 1");
    // `dawg pane play drums`: a second pane on the same track, in PLAY.
    const b = open(dir, "B", ["pane", "play", "drums"]);
    await ready(b);
    await until(
      () => b.vt.text().includes("PLAY "),
      "B opens in play mode",
      () => b.vt.text(),
    );
    expect(header(b)).toContain("drums");
    // `dawg pane sound bass volume`: a third pane on another track's fader.
    const c = open(dir, "C", ["pane", "sound", "bass", "volume"]);
    await ready(c);
    await until(
      () => c.vt.text().includes("volume") && header(c).includes("bass"),
      "C opens the bass volume drawer",
      () => c.vt.text(),
    );
    const trio = [a, b, c];
    await until(
      () =>
        // B's PLAY header replaces the HOME header; `pane` names it below.
        header(a).includes("A ⧉3") && header(c).includes("C ⧉3"),
      "pane letters in every header",
      () => screens(trio),
    );

    // `pane` lists every pane with its screen and track.
    await send(a, "pane");
    await until(
      () =>
        /3 panes │ A home · drums · this pane │ B play · drums/.test(
          a.vt.text(),
        ) && /C sound · bass · volume/.test(a.vt.text()),
      "pane list",
      () => a.vt.text(),
    );

    // Two panes on drums: A's edit shows in B as `A ✓ Drums`; C, on bass,
    // gets no card for it.
    await edit(a, "pattern snare 1 3 vel 0.8");
    await until(
      () => /A ✓ drums/i.test(b.vt.text()),
      "author card in B",
      () => b.vt.text(),
    );
    expect(c.vt.text()).not.toMatch(/A ✓/);
    expect(c.vt.text()).not.toContain("synced ·");

    // `pane play keys` in a pane prints the shell line instead of opening.
    c.terminal.write("\r"); // enter keeps and closes the drawer
    await until(
      () => !c.vt.text().includes("menu › Mix"),
      "drawer closed",
      () => c.vt.text(),
    );
    await send(c, "pane play keys");
    await until(
      () => c.vt.text().includes("dawg pane play keys"),
      "pane line",
      () => c.vt.text(),
    );

    // Pin: a pinned pane refuses to change track; follow takes A's track.
    b.terminal.write("\u001b");
    await until(
      () => !b.vt.text().includes("PLAY "),
      "B leaves play",
      () => b.vt.text(),
    );
    await send(b, "pin");
    await send(b, "track bass");
    await until(
      () => b.vt.text().includes("pinned to drums"),
      "pinned refusal",
      () => b.vt.text(),
    );
    await send(c, "follow A");
    await until(
      () => header(c).includes("drums"),
      "C follows A onto drums",
      () => c.vt.text(),
    );
    await send(a, "track keys");
    await until(
      () => header(c).includes("keys"),
      "C follows A onto keys",
      () => screens([a, c]),
    );

    // Leaving frees the letter; the next pane reuses it.
    await close(b);
    await until(
      () => header(a).includes("A ⧉2"),
      "count drops",
      () => a.vt.text(),
    );
    const d = open(dir, "D", ["--track", "drums"]);
    await ready(d);
    await until(
      () => header(d).includes("B ⧉3"),
      "freed letter reused",
      () => d.vt.text(),
    );
    for (const p of [a, c, d]) await close(p);
  },
  60_000,
);

test.skipIf(!supported)(
  "panes: one audio engine per machine, whoever plays",
  async () => {
    const dir = await workspace();
    const out = join(dir, "player");
    const audio = {
      DAWG_AUDIO: "",
      DAWG_AUDIO_PLAYER: `${process.execPath} ${FAKE_PLAYER} ${out}`,
    };
    const a = open(dir, "A", ["--new", "--track", "drums"], audio);
    await ready(a);
    await edit(a, "pattern kick every 1");
    const b = open(dir, "B", ["pane", "play", "keys"], audio);
    await ready(b);
    await until(() => b.vt.text().includes("PLAY "), "B in play");
    const c = open(dir, "C", ["pane", "play", "drums"], audio);
    await ready(c);
    await until(() => c.vt.text().includes("PLAY "), "C in play");
    // Two panes play notes; A starts the transport.
    for (const key of "asdf") {
      b.terminal.write(key);
      c.terminal.write(key);
      await Bun.sleep(60);
    }
    await send(a, "play");
    await until(
      () => [a, b, c].every((p) => header(p).includes("▶")),
      "▶ everywhere",
      () => screens([a, b, c]),
    );
    await Bun.sleep(400);
    for (const key of "jkl") {
      b.terminal.write(key);
      await Bun.sleep(60);
    }
    await until(() => existsSync(`${out}.starts`), "a player started");
    const [daemon] = await daemonPids(dir);
    expect(daemon).toBeNumber();
    // Exactly one player process, and its stream is growing: dawgd's.
    const starts = (await readFile(`${out}.starts`, "utf8")).trim().split("\n");
    expect(starts).toHaveLength(1);
    const size = (await readFile(`${out}.pcm`)).byteLength;
    await until(
      async () => (await readFile(`${out}.pcm`)).byteLength > size,
      "stream grows",
    );
    for (const p of [a, b, c]) await close(p);
  },
  60_000,
);

/** Track volumes in the newest session record on disk (dawgd writes it). */
async function volumes(dir: string): Promise<Record<string, number>> {
  const root = join(dir, ".dawg", "sessions");
  const files = (await readdir(root)).filter((name) => name.endsWith(".json"));
  let newest = { at: 0, path: "" };
  for (const name of files) {
    const path = join(root, name);
    const at = (await Bun.file(path).stat()).mtimeMs;
    if (at > newest.at) newest = { at, path };
  }
  const record = JSON.parse(await readFile(newest.path, "utf8")) as {
    composition: { tracks: { id: string; volume?: number }[] };
  };
  return Object.fromEntries(
    record.composition.tracks.map((track) => [track.id, track.volume ?? 1]),
  );
}

test.skipIf(!supported)(
  "panes: per-pane undo, two panes on one track, undo all is global",
  async () => {
    const dir = await workspace();
    const a = open(dir, "A", ["--new", "--track", "drums"]);
    await ready(a);
    await edit(a, "pattern kick every 1");
    const b = open(dir, "B", ["--track", "bass"]);
    await ready(b);
    await edit(b, "add C2 at 0 for 1");
    const c = open(dir, "C", ["--track", "drums"]);
    await ready(c);
    await until(
      () => header(a).includes("⧉3"),
      "three panes",
      () => screens([a, b, c]),
    );

    /** Every pane has seen every edit, so the next step reads one history. */
    const settle = () =>
      until(
        () => {
          const r = [a, b, c].map(revision);
          return r.every((x) => x === r[0]);
        },
        "panes agree on the revision",
        () => screens([a, b, c]),
      );
    // A sets drums volume, then B sets bass volume. A's ctrl-z undoes only
    // A's edit; B's later, unrelated edit stays.
    await edit(a, "volume 0.4");
    await edit(b, "volume 0.6");
    await settle();
    let before = revision(a);
    a.terminal.write("\u001a");
    await until(
      () => revision(a) > before,
      "A ctrl-z",
      () => a.vt.text(),
    );
    await until(
      async () => {
        const v = await volumes(dir);
        return v.drums === 1 && v.bass === 0.6;
      },
      "A undid only its own edit",
      () => screens([a, b, c]),
    );

    // Two panes on one track: C pans drums (another property), A redoes
    // its volume, and both properties stand.
    await edit(c, "pan -0.3");
    await settle();
    await edit(a, "redo");
    await until(
      async () => (await volumes(dir)).drums === 0.4,
      "A redid volume over C's pan",
    );

    // Same property: C sets drums volume after A; A's undo refuses and
    // names pane C.
    await edit(c, "volume 0.2");
    await settle();
    before = revision(a);
    await send(a, "undo");
    await until(
      () => /pane C changed drums volume since/.test(a.vt.text()),
      "A refused, naming C",
      () => a.vt.text(),
    );
    expect(revision(a)).toBe(before);
    expect((await volumes(dir)).drums).toBe(0.2);

    // `undo all` steps the shared history whoever wrote it; the receipt
    // names the author pane.
    await settle();
    await edit(b, "undo all");
    await until(
      () => /\(pane C\)/.test(b.vt.text()),
      "undo all names pane C",
      () => b.vt.text(),
    );
    expect((await volumes(dir)).drums).toBe(0.4);
    for (const p of [a, b, c]) await close(p);
  },
  60_000,
);

test.skipIf(!supported)(
  "panes: presence markers on drawer rows and track rows",
  async () => {
    const dir = await workspace();
    const a = open(dir, "A", ["--new", "--track", "drums"]);
    await ready(a);
    await edit(a, "pattern kick every 1");
    const b = open(dir, "B", ["pane", "sound", "drums", "volume"]);
    await ready(b);
    const c = open(dir, "C", ["pane", "sound", "drums", "volume"]);
    await ready(c);
    const trio = [a, b, c];
    // B and C both have drums › volume open: each drawer's volume row shows
    // the other pane's letter at its right edge.
    // `volume` opens the knob front page: the orange knob's row.
    const row = (p: Pane) =>
      p.vt
        .lines()
        .find((line) => /^\s*│?\s*[◆*]?\s*[›>]\s*volume\b/.test(line)) ?? "";
    await until(
      () => / C\s*│?\s*$/.test(row(b)) && / B\s*│?\s*$/.test(row(c)),
      "drawer row markers",
      () => screens(trio),
    );
    // A's track list shows B and C beside drums.
    await send(a, "tracks");
    await until(
      () => /drums.*  B C/.test(a.vt.text()),
      "track row markers",
      () => a.vt.text(),
    );
    for (const p of trio) await close(p);
  },
  60_000,
);
