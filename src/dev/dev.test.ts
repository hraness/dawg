import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyScoreOperations } from "../../core/diff.ts";
import { createScore, type TrackScore } from "../../core/score.ts";
import { initProject, writeAtomic } from "../project/init.ts";
import {
  startProjectSync,
  type FilesApplyMeta,
  type FilesApplyPlan,
  type SyncHost,
} from "../project/sync.ts";
import { checkActor, runCheckCommand } from "../project/check.ts";
import { DEV_LOG_RATE, devLog, resetDevLog } from "../history/devlog.ts";
import { setHistorySink } from "../history/sink.ts";
import type { HistoryAppend, HistoryHandle } from "../history/types.ts";
import { actorKindOf, sessionEventRow } from "../history/record.ts";
import {
  attributionLabel,
  Attributor,
  FILE_ATTRIBUTION,
  HEARTBEAT_MS,
  LATE_MS,
  PENDING_MS,
  readHeartbeat,
  sha256,
  writeHeartbeat,
} from "./attribution.ts";
import {
  startSupervisor,
  STARTUP_CRASH_MS,
  triggersReload,
  type ChildHandle,
} from "./reload.ts";
import { screenSnapshots } from "./screen.ts";
import { runDevCommand } from "./cli.ts";

const dirs: string[] = [];
async function temp(prefix = "dawg-dev-"): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  setHistorySink(undefined);
  resetDevLog();
  delete process.env.DAWG_DEV;
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});

function capture() {
  let text = "";
  return {
    write(chunk: string) {
      text += chunk;
    },
    get text() {
      return text;
    },
  };
}

/** A history handle that keeps appended rows in memory. */
function memorySink(): { rows: HistoryAppend[]; handle: HistoryHandle } {
  const rows: HistoryAppend[] = [];
  const handle = {
    append(event: HistoryAppend) {
      rows.push(event);
      return {
        id: event.id ?? `ev${rows.length}`,
        done: Promise.resolve(undefined),
      };
    },
    query: () => ({ rows: [] }),
    context: () => ({}),
  } as unknown as HistoryHandle;
  return { rows, handle };
}

describe("attribution", () => {
  test("dawg's agent write credits the agent; a later human save does not", async () => {
    let clock = 1_000;
    const attributor = new Attributor(await temp(), { now: () => clock });
    attributor.noteAgentWrite("tracks/bass/track.ts", "agent text");
    const changed = new Map([["tracks/bass/track.ts", sha256("agent text")]]);
    expect(await attributor.attribute(changed)).toEqual({
      kind: "agent",
      id: "agent",
    });
    // Consumed: the same contents again (a human re-save) is a plain save.
    expect(await attributor.attribute(changed)).toEqual(FILE_ATTRIBUTION);
    attributor.noteAgentWrite("tracks/bass/track.ts", "agent text", "drums");
    clock += PENDING_MS + 1;
    expect(await attributor.attribute(changed)).toEqual(FILE_ATTRIBUTION);
  });

  test("a subagent's two-file write matches as a whole and is labelled", async () => {
    const attributor = new Attributor(await temp());
    attributor.noteAgentWrite("tracks/a/track.ts", "a", "sub-1");
    attributor.noteAgentWrite("./tracks/b/track.ts", "b", "sub-1");
    const who = await attributor.attribute(
      new Map([
        ["tracks/a/track.ts", sha256("a")],
        ["tracks/b/track.ts", sha256("b")],
      ]),
    );
    expect(who).toEqual({ kind: "subagent", id: "sub-1" });
    expect(attributionLabel(who)).toBe("by sub:sub-1");
  });

  test("the dawg check heartbeat credits a coding agent only for the hashes it checked", async () => {
    const project = await temp();
    let clock = Date.parse("2026-10-09T10:00:00Z");
    await writeHeartbeat(
      project,
      "claude code\n",
      new Map([["song.ts", sha256("checked")]]),
      new Date(clock),
    );
    const beat = await readHeartbeat(project);
    expect(beat?.actor).toBe("claude-code");
    const attributor = new Attributor(project, { now: () => clock });
    expect(
      await attributor.attribute(new Map([["song.ts", sha256("checked")]])),
    ).toEqual({ kind: "external", id: "claude-code" });
    // The human edited after the check: different hash, plain save.
    expect(
      await attributor.attribute(new Map([["song.ts", sha256("human")]])),
    ).toEqual(FILE_ATTRIBUTION);
    // A deleted file never matches.
    expect(
      await attributor.attribute(new Map([["song.ts", undefined]])),
    ).toEqual(FILE_ATTRIBUTION);
    clock += HEARTBEAT_MS + 1;
    expect(
      await attributor.attribute(new Map([["song.ts", sha256("checked")]])),
    ).toEqual(FILE_ATTRIBUTION);
    expect(attributionLabel(FILE_ATTRIBUTION)).toBe("");
  });

  test("a heartbeat trailing a plain-save apply credits that revision late, once", async () => {
    const project = await temp();
    let clock = Date.parse("2026-10-09T10:00:00Z");
    const attributor = new Attributor(project, { now: () => clock });
    expect(attributor.claimable).toBe(false);
    attributor.noteUnattributed(7, new Map([["song.ts", sha256("agent")]]));
    attributor.noteUnattributed(8, new Map([["song.ts", sha256("human")]]));
    expect(await attributor.claimLate()).toEqual([]);
    clock += 1_000;
    await writeHeartbeat(
      project,
      "claude-code",
      new Map([["song.ts", sha256("agent")]]),
      new Date(clock),
    );
    expect(await attributor.claimLate()).toEqual([
      { rev: 7, actor: "claude-code" },
    ]);
    expect(await attributor.claimLate()).toEqual([]);
    clock += LATE_MS + 1;
    expect(attributor.claimable).toBe(false);
  });

  test("a malformed heartbeat is ignored", async () => {
    const project = await temp();
    await writeAtomic(join(project, ".dawg/external.json"), "{nope");
    expect(await readHeartbeat(project)).toBeUndefined();
  });

  test("dawg check --as writes the heartbeat with the project's source hashes", async () => {
    const project = await temp();
    await initProject(project);
    const out = capture();
    const err = capture();
    const code = await runCheckCommand(
      ["check", "--as", "codex"],
      project,
      out,
      err,
    );
    expect(err.text).toBe("");
    expect(code).toBe(0);
    const beat = await readHeartbeat(project);
    expect(beat?.actor).toBe("codex");
    const song = await readFile(join(project, "song.ts"), "utf8");
    expect(beat?.files.get("song.ts")).toBe(sha256(song));
    // Nobody named: no heartbeat is claimed.
    expect(checkActor(undefined, {})).toBeUndefined();
    expect(checkActor(undefined, { DAWG_ACTOR: "pi" })).toBe("pi");
    expect(checkActor(undefined, { CLAUDECODE: "1" })).toBe("claude-code");
  });

  test("files.apply rows carry the attributed writer", () => {
    const event = {
      id: "e1",
      kind: "files.apply",
      revision: 3,
      at: "2026-10-09T10:00:00.000Z",
      payload: {
        summary: "1 note",
        by: { kind: "external", id: "claude-code" },
      },
    };
    expect(actorKindOf(event as never)).toBe("external");
    const row = sessionEventRow("s1", event as never, null, null, "local");
    expect(row.actor).toMatchObject({
      kind: "external",
      actorId: "claude-code",
    });
    expect(
      actorKindOf({
        ...event,
        payload: { by: { kind: "agent", id: "agent" } },
      } as never),
    ).toBe("agent");
  });
});

describe("hot reload of external edits", () => {
  const base = createScore({
    tracks: [{ id: "main", name: "main", instrument: "sine" }],
    notes: [],
  });
  const typecheck = async () => ({ ok: true, diagnostics: [], ms: 0 });

  function host(project: string, attributor: Attributor) {
    let score: TrackScore = base;
    const commits: { plan: FilesApplyPlan; meta?: FilesApplyMeta }[] = [];
    const cards: string[] = [];
    const logs: string[] = [];
    const api: SyncHost = {
      project,
      current: () => score,
      async commit(plan, _summary, meta) {
        commits.push({ plan, ...(meta ? { meta } : {}) });
        score = applyScoreOperations(score, plan.operations);
        return score;
      },
      card: (text) => void cards.push(text),
      types: () => undefined,
      attribute: (changed) => attributor.attribute(changed),
      log: (sub, summary) => void logs.push(`${sub} ${summary}`),
    };
    return { api, commits, cards, logs };
  }

  const edit = (notes: string) =>
    `import { track, note } from "dawg";\nexport default track({ id: "main", name: "main", notes: [${notes}] });\n`;

  test("a coding agent's checked edit applies as one attributed revision with a card", async () => {
    const project = await temp();
    await initProject(project);
    const h = host(project, new Attributor(project));
    const sync = startProjectSync(h.api, { watch: false, typecheck });
    try {
      await sync.checkFiles();
      const text = edit(`note("C4", 0), note("E4", 1)`);
      await writeAtomic(join(project, "tracks/main/track.ts"), text);
      await writeHeartbeat(
        project,
        "claude-code",
        new Map([["tracks/main/track.ts", sha256(text)]]),
      );
      expect(await sync.checkFiles()).toBe(
        "applied from files · 2 notes · by claude-code",
      );
      expect(h.commits).toHaveLength(1);
      expect(h.commits[0]!.meta).toEqual({
        attribution: { kind: "external", id: "claude-code" },
        files: ["tracks/main/track.ts"],
        hashes: new Map([["tracks/main/track.ts", sha256(text)]]),
      });
      expect(h.cards.at(-1)).toBe(
        "applied from files · 2 notes · by claude-code",
      );
      expect(h.logs.some((line) => line.startsWith("sync.eval eval ok"))).toBe(
        true,
      );
    } finally {
      await sync.stop();
    }
  });

  test("a burst of saves lands as one revision; a broken save is rejected and logged", async () => {
    const project = await temp();
    await initProject(project);
    const h = host(project, new Attributor(project));
    const sync = startProjectSync(h.api, {
      typecheck,
      debounceMs: 60,
      pollMs: 60_000,
    });
    try {
      await sync.checkFiles();
      for (let index = 0; index < 20; index += 1)
        await writeAtomic(
          join(project, "tracks/main/track.ts"),
          edit(`note("C4", 0), note("D4", ${index % 4})`),
        );
      const deadline = Date.now() + 5_000;
      while (h.commits.length === 0 && Date.now() < deadline)
        await Bun.sleep(25);
      await sync.checkFiles();
      expect(h.commits).toHaveLength(1);
      expect(h.commits[0]!.meta?.attribution).toEqual(FILE_ATTRIBUTION);
      await writeAtomic(
        join(project, "tracks/main/track.ts"),
        "export default {",
      );
      await sync.checkFiles();
      expect(h.commits).toHaveLength(1);
      expect(h.logs.some((line) => line.startsWith("sync.rejected"))).toBe(
        true,
      );
    } finally {
      await sync.stop();
    }
  });
});

describe("dev logs", () => {
  test("never written without dev mode, except errors", () => {
    const sink = memorySink();
    setHistorySink(sink.handle);
    resetDevLog();
    delete process.env.DAWG_DEV;
    devLog("sync", "info", "eval ok");
    devLog("tool", "debug", "args");
    expect(sink.rows).toHaveLength(0);
    devLog("error", "error", "uncaught · boom");
    expect(sink.rows).toHaveLength(1);
    expect(sink.rows[0]).toMatchObject({ kind: "log", sub: "error" });
    expect(sink.rows[0]!.summary).toBe("error · uncaught · boom");
  });

  test("dev mode writes log rows, rate-limited with a dropped count", () => {
    const sink = memorySink();
    setHistorySink(sink.handle);
    let clock = 10_000;
    resetDevLog(() => clock);
    process.env.DAWG_DEV = "1";
    for (let index = 0; index < DEV_LOG_RATE + 5; index += 1)
      devLog("sync", "info", `eval ${index}`);
    expect(sink.rows).toHaveLength(DEV_LOG_RATE);
    clock += 1_500;
    devLog("sync", "info", "next window");
    const summaries = sink.rows.map((row) => row.summary);
    expect(summaries.some((text) => /dropped 5/.test(text ?? ""))).toBe(true);
    expect(summaries.at(-1)).toBe("sync · next window");
  });

  test("devLog never throws when the sink does", () => {
    process.env.DAWG_DEV = "1";
    setHistorySink({
      append() {
        throw new Error("disk full");
      },
    } as unknown as HistoryHandle);
    expect(() => devLog("sync", "info", "x")).not.toThrow();
  });
});

describe("dev screen snapshots", () => {
  test("debounced plain-text frames per pane, read back by dawg dev screen", async () => {
    const project = await temp();
    const snaps = screenSnapshots(project, () => "B", 10_000);
    snaps.drawn(() => "first");
    snaps.drawn(() => "\u001b[1mhead\u001b[0m line   ");
    snaps.flush();
    snaps.stop();
    const out = capture();
    const err = capture();
    expect(await runDevCommand(["screen", "B"], project, out, err)).toBe(0);
    expect(out.text).toBe("head line\n");
    const newest = capture();
    expect(await runDevCommand(["screen"], project, newest, err)).toBe(0);
    expect(newest.text).toBe("head line\n");
    expect(await runDevCommand(["screen", "Z"], project, capture(), err)).toBe(
      1,
    );
    expect(
      await runDevCommand(["screen", "--bogus"], project, capture(), capture()),
    ).toBe(2);
  });
});

describe("dawg dev --reload supervisor", () => {
  function fakeChild() {
    let exit: (code: number) => void = () => undefined;
    const exited = new Promise<number>((resolve) => {
      exit = resolve;
    });
    const signals: string[] = [];
    const child: ChildHandle = {
      exited,
      kill(signal) {
        signals.push(signal);
        exit(143);
      },
    };
    return { child, signals, exit: (code: number) => exit(code) };
  }

  function harness(smokeResult: () => string | undefined) {
    const children: ReturnType<typeof fakeChild>[] = [];
    const notices: string[] = [];
    let restored = 0;
    let changed: (path: string) => void = () => undefined;
    let clock = 0;
    const supervisor = startSupervisor({
      spawnEditor() {
        const next = fakeChild();
        children.push(next);
        return next.child;
      },
      smoke: async () => smokeResult(),
      watch(callback) {
        changed = callback;
        return () => undefined;
      },
      restoreTerminal: () => void (restored += 1),
      notice: (text) => void notices.push(text),
      now: () => clock,
      debounceMs: 5,
    });
    return {
      supervisor,
      children,
      notices,
      get restored() {
        return restored;
      },
      change: (path: string) => changed(path),
      advance: (ms: number) => void (clock += ms),
    };
  }

  test("only TypeScript sources outside tests and dotfiles trigger", () => {
    expect(triggersReload("src/main.ts")).toBe(true);
    expect(triggersReload("tui/app.ts")).toBe(true);
    expect(triggersReload("src/main.test.ts")).toBe(false);
    expect(triggersReload("src/.cache/x.ts")).toBe(false);
    expect(triggersReload("src/notes.md")).toBe(false);
  });

  test("a failing smoke import keeps the running editor", async () => {
    const h = harness(() => "SyntaxError: Unexpected }");
    h.change("src/main.ts");
    await h.supervisor.idle();
    expect(h.children).toHaveLength(1);
    expect(h.children[0]!.signals).toEqual([]);
    h.supervisor.stop("SIGTERM");
    expect(await h.supervisor.done).toBe(143);
  });

  test("a passing smoke import restarts the editor once per burst", async () => {
    const h = harness(() => undefined);
    h.change("src/a.ts");
    h.change("core/b.ts");
    await h.supervisor.idle();
    expect(h.children).toHaveLength(2);
    expect(h.children[0]!.signals).toEqual(["SIGTERM"]);
    expect(h.notices).toEqual([]);
    h.children[1]!.exit(0);
    expect(await h.supervisor.done).toBe(0);
  });

  test("a startup crash restores the terminal and waits for the next change", async () => {
    const h = harness(() => undefined);
    h.children[0]!.exit(1);
    await Bun.sleep(0);
    expect(h.restored).toBe(1);
    expect(h.notices.at(-1)).toContain("crashed on startup");
    expect(h.children).toHaveLength(1);
    h.change("src/main.ts");
    await h.supervisor.idle();
    expect(h.children).toHaveLength(2);
    h.advance(STARTUP_CRASH_MS + 1);
    h.children[1]!.exit(3);
    await Bun.sleep(0);
    expect(h.notices.at(-1)).toContain("exited (code 3)");
    h.supervisor.stop("SIGHUP");
    expect(await h.supervisor.done).toBe(129);
  });
});

describe("dawg history --follow for a coding agent", () => {
  test("waits for a session, prints a short oldest-first backlog, then streams new rows", async () => {
    const { ensureSession } = await import("../session/store.ts");
    const { emptyScore } = await import("../../core/score.ts");
    const { HistoryDb } = await import("../history/db.ts");
    const { runHistoryCommand } = await import("../history/cli.ts");
    const { closeHistories } = await import("../history/open.ts");
    const workspace = await temp("dawg-follow-");
    const out = capture();
    const err = capture();
    const abort = new AbortController();
    // Started before the editor ever ran in this folder.
    const running = runHistoryCommand(
      ["history", "--follow", "--json", "--kind", "log"],
      workspace,
      out,
      err,
      abort.signal,
    );
    await Bun.sleep(300);
    expect(err.text).toContain("waiting for a dawg session");
    const { record } = await ensureSession(emptyScore().toJSON(), {
      workspace,
      sessionId: "s1",
    });
    const db = HistoryDb.open(workspace);
    const log = (summary: string) =>
      db.append({
        sessionId: record.sessionId,
        kind: "log",
        sub: "info",
        atRev: 0,
        actor: { kind: "system" },
        summary,
      });
    for (let index = 0; index < 14; index += 1) log(`old ${index}`);
    const waitFor = async (pattern: RegExp) => {
      const deadline = Date.now() + 5_000;
      while (!pattern.test(out.text) && Date.now() < deadline)
        await Bun.sleep(20);
    };
    await waitFor(/old 13/);
    let summaries = out.text
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { summary: string }).summary);
    // Rows that land while it waits for the database are all new: none lost.
    expect(summaries.length).toBeGreaterThanOrEqual(10);
    expect(summaries.at(-1)).toBe("old 13");
    log("fresh");
    db.append({
      sessionId: record.sessionId,
      kind: "comment",
      atRev: 0,
      actor: { kind: "human" },
      summary: "not a log",
    });
    await waitFor(/fresh/);
    abort.abort();
    expect(await running).toBe(0);
    db.close();
    closeHistories();
    summaries = out.text
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { summary: string }).summary);
    expect(summaries.at(-1)).toBe("fresh");
    expect(summaries).not.toContain("not a log");
    // Ascending order throughout.
    const olds = summaries
      .filter((s) => s.startsWith("old "))
      .map((s) => Number(s.slice(4)));
    expect(olds).toEqual([...olds].sort((a, b) => a - b));
  });
});
