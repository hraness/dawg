/** Normal-default observer journeys, with real input/rendering and gated JSON tools. */
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScore } from "../core/score.ts";
import { ensureSession, loadSession } from "../src/session/store.ts";
import { launch, supported, type EditorState } from "./pty-harness.ts";

type Pty = Awaited<ReturnType<typeof launch>>;
type Observed = EditorState & {
  studio: { view: "overview" | "track"; track: string; pinned: boolean };
};
const state = (t: Pty) => t.state() as Observed | undefined;
const click = (x: number, y: number) =>
  `\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`;
const FAKE_PLAYER = join(
  import.meta.dir,
  "../src/audio/fixtures/fake-player.ts",
);

async function fixture(bars = 32) {
  const cwd = await mkdtemp(join(tmpdir(), "dawg-song-studio-"));
  const initial = createScore({
    bars,
    tracks: [
      { id: "bass", name: "Bass", instrument: "sine" },
      { id: "keys", name: "Keys", instrument: "sine" },
      { id: "voice", name: "Voice", instrument: "sine" },
    ],
    sections: [
      { name: "verse", startBar: 0, bars: bars / 2 },
      { name: "chorus", startBar: bars / 2, bars: bars / 2 },
    ],
  });
  const { paths } = await ensureSession(initial.toJSON(), { workspace: cwd });
  return { cwd, paths };
}

async function quit(t: Pty) {
  t.terminal.write("\x03");
  const exited = await Promise.race([
    t.proc.exited.then(() => true),
    Bun.sleep(5000).then(() => false),
  ]);
  if (!exited) {
    t.proc.kill("SIGTERM");
    await t.proc.exited;
  }
  t.terminal.close();
}

async function clickText(t: Pty, text: string) {
  const lines = t.vt.lines();
  const y = lines.findIndex((line) => line.includes(text));
  if (y < 0) throw new Error(`missing control ${text}\n${t.vt.text()}`);
  t.terminal.write(click(lines[y]!.indexOf(text) + 1, y));
}

type Call = { name: string; args: Record<string, unknown> };
type Gate = { ready: Promise<void>; release(): void; calls?: readonly Call[] };
class Gateway {
  private readonly gates: Gate[] = [];
  private readonly all: Gate[] = [];
  private readonly server: ReturnType<typeof Bun.serve>;
  readonly bodies: { tools?: { function: { name: string } }[] }[] = [];
  requests = 0;
  constructor() {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 0,
      fetch: async (request) => {
        if (!new URL(request.url).pathname.endsWith("/chat/completions"))
          return new Response("not found", { status: 404 });
        const body = (await request.json()) as {
          tools?: { function: { name: string } }[];
        };
        // Background naming/catalog work cannot consume a generation stage.
        if (!body.tools?.some((tool) => tool.function.name === "add_notes"))
          return this.reply(undefined, -1);
        this.bodies.push(body);
        const number = this.requests++;
        const gate = this.gates.shift();
        await gate?.ready;
        return this.reply(gate?.calls, number);
      },
    });
  }
  private reply(calls: readonly Call[] | undefined, number: number) {
    const delta = calls
      ? {
          tool_calls: calls.map((call, index) => ({
            index,
            id: `stage-${number}-${index}`,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          })),
        }
      : { content: "DONE: The draft is saved." };
    const chunks = [
      { choices: [{ index: 0, delta }] },
      {
        choices: [
          { index: 0, delta: {}, finish_reason: calls ? "tool_calls" : "stop" },
        ],
      },
    ];
    return new Response(
      chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
        "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
  }
  gate(calls?: readonly Call[]) {
    let release = () => {};
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gate = { ready, release, calls };
    this.gates.push(gate);
    this.all.push(gate);
    return release;
  }
  get env() {
    return {
      AI_GATEWAY_BASE_URL: `http://127.0.0.1:${this.server.port}/v1`,
      DAWG_MODELS_DEV_URL: `http://127.0.0.1:${this.server.port}/api.json`,
    };
  }
  stop() {
    for (const gate of this.all) gate.release();
    this.server.stop(true);
  }
}

const notes = (trackId: string, at: readonly number[]): Call => ({
  name: "add_notes",
  args: {
    trackId,
    notes: at.map((start, index) => ({
      pitch: trackId === "bass" ? 48 : 60 + index * 4,
      start,
      duration: 1,
      velocity: 0.7,
    })),
  },
});

test.skipIf(!supported)(
  "song studio default: overview row clicks, pin, ASCII and resize preserve a prompt draft",
  async () => {
    const { cwd, paths } = await fixture();
    const t = await launch(
      80,
      24,
      { TERM: "dumb", NO_COLOR: "1", DAWG_AI: "0" },
      ["--track", "bass"],
      cwd,
    );
    try {
      await t.until(
        () => state(t)?.studio.view === "overview",
        "default tracks overview",
      );
      expect(t.vt.text()).toContain("Bass");
      expect(t.vt.text()).toContain("Keys");
      expect(t.vt.text()).not.toMatch(/\bcut\b.*\bpaste\b/);
      expect(t.vt.text()).not.toContain("clipboard:");
      await clickText(t, "Keys");
      await t.until(
        () =>
          state(t)?.studio.track === "keys" && state(t)?.studio.pinned === true,
        "clicked track opens pinned piano roll",
      );
      expect(t.vt.text()).toContain("PINNED");
      await t.type(click(35, 9), "read-only piano-roll click");
      expect(
        (await loadSession<{ notes: unknown[] }>(paths)).composition.notes,
      ).toHaveLength(0);
      expect((await loadSession(paths)).revision).toBe(0);
      await t.type("/view tracks\r", "overview command");
      await t.type("\x10", "pin from overview");
      expect(state(t)?.studio).toMatchObject({
        view: "track",
        track: "keys",
        pinned: true,
      });
      await t.type("hold this lyric", "prompt draft");
      await clickText(t, "Tracks");
      await t.until(
        () => state(t)?.studio.view === "overview",
        "overview with draft intact",
      );
      expect(t.vt.text()).toContain("hold this lyric");
      t.vt.resize(120, 40);
      t.terminal.resize(120, 40);
      await t.until(
        () => t.vt.lines().length === 40 && t.vt.text().includes("Keys"),
        "120x40 overview",
      );
      expect(t.vt.text()).toContain("hold this lyric");
      expect(t.vt.lines().filter((line) => /[^\x20-\x7e]/.test(line))).toEqual(
        [],
      );
      t.vt.resize(80, 24);
      t.terminal.resize(80, 24);
      await t.until(
        () =>
          t.vt.lines().length === 24 && t.vt.text().includes("hold this lyric"),
        "80x24 restored",
      );
    } finally {
      await quit(t);
      await rm(cwd, { recursive: true, force: true });
    }
  },
  30000,
);

test.skipIf(!supported)(
  "song studio default: staged JSON writing follows tracks while mouse pin and drafts remain authoritative",
  async () => {
    const gateway = new Gateway();
    const first = gateway.gate([notes("bass", [0, 4])]);
    const second = gateway.gate([notes("voice", [8, 12])]);
    const third = gateway.gate([notes("keys", [84, 88])]);
    const finish = gateway.gate();
    const { cwd, paths } = await fixture();
    const t = await launch(
      80,
      24,
      { ...gateway.env, NO_COLOR: "1" },
      ["--track", "bass"],
      cwd,
    );
    try {
      await t.until(
        () => state(t)?.studio.view === "overview",
        "default overview",
      );
      t.terminal.write("write a bright song\r");
      await t.until(
        () => gateway.requests === 1,
        "normal JSON generation request",
      );
      first();
      await t.until(
        () =>
          gateway.requests === 2 &&
          state(t)?.studio.track === "bass" &&
          state(t)?.studio.view === "track",
        "bass written before generation finishes",
      );
      expect(state(t)?.busy).toBe(true);
      expect(
        (await loadSession<{ notes: unknown[] }>(paths)).composition.notes,
      ).toHaveLength(2);
      expect(
        gateway.bodies[0]?.tools?.some(
          (tool) => tool.function.name === "add_notes",
        ),
      ).toBe(true);
      t.terminal.write("\x14");
      await t.until(
        () => state(t)?.studio.view === "overview",
        "overview while gateway waits",
      );
      await clickText(t, "Keys");
      await t.until(
        () =>
          state(t)?.studio.track === "keys" && state(t)?.studio.pinned === true,
        "mouse focus during generation",
      );
      t.terminal.write("keep this draft");
      await t.until(
        () => t.vt.text().includes("keep this draft"),
        "draft typed during writing",
      );
      second();
      await t.until(
        () => gateway.requests === 3 && (state(t)?.rev ?? 0) > 1,
        "second musical batch committed",
      );
      expect(state(t)?.studio).toMatchObject({ track: "keys", pinned: true });
      await clickText(t, "Unpin");
      await t.until(
        () =>
          state(t)?.studio.track === "voice" &&
          state(t)?.studio.pinned === false,
        "mouse unpin resumes latest written track",
      );
      expect(t.vt.text()).toContain("keep this draft");
      third();
      await t.until(
        () => gateway.requests === 4 && state(t)?.studio.track === "keys",
        "next track follows automatically",
      );
      expect(state(t)?.busy).toBe(true);
      expect(
        t.vt
          .lines()
          .some(
            (line) => /^bar\s/.test(line) && /\b(?:1[89]|2[0-3])\b/.test(line),
          ),
      ).toBe(true);
      t.vt.resize(120, 40);
      t.terminal.resize(120, 40);
      await t.until(
        () =>
          t.vt.lines().length === 40 && t.vt.text().includes("keep this draft"),
        "writing survives large resize",
      );
      finish();
      await t.until(() => state(t)?.busy === false, "generation finishes");
      expect(t.vt.text()).toContain("keep this draft");
      await t.type(
        `\x05${"\x7f".repeat("keep this draft".length)}`,
        "clear completed draft",
      );
      await t.until(
        () => !t.vt.text().includes("keep this draft"),
        "prompt draft cleared",
      );
      await t.type("/view bass\r", "typed observer focus");
      await t.until(
        () =>
          state(t)?.studio.track === "bass" && state(t)?.studio.pinned === true,
        "typed focus opens pinned bass roll",
      );
      expect(state(t)?.studio).toMatchObject({ track: "bass", pinned: true });
    } finally {
      gateway.stop();
      await quit(t);
      await rm(cwd, { recursive: true, force: true });
    }
  },
  35000,
);

test.skipIf(!supported)(
  "song studio default: coherent draft autoplays, then pause and seek beat later ready updates",
  async () => {
    const gateway = new Gateway();
    const first = gateway.gate([notes("bass", [0, 4])]);
    const coherent = gateway.gate([notes("keys", [0, 4])]);
    const later = gateway.gate([notes("voice", [0, 4])]);
    const afterSeek = gateway.gate([notes("bass", [8, 12])]);
    const finish = gateway.gate();
    const edit = gateway.gate([notes("voice", [8, 12])]);
    const finishEdit = gateway.gate();
    const { cwd } = await fixture(4);
    const out = join(cwd, "studio-player");
    const t = await launch(
      80,
      24,
      {
        ...gateway.env,
        DAWG_AUDIO: "1",
        DAWG_AUDIO_PLAYER: `${process.execPath} ${FAKE_PLAYER} ${out}`,
      },
      ["--track", "bass"],
      cwd,
    );
    try {
      await t.until(() => state(t) !== undefined, "ready");
      t.terminal.write("write a song\r");
      await t.until(() => gateway.requests === 1, "first stage");
      first();
      await t.until(() => gateway.requests === 2, "one part saved");
      expect(existsSync(`${out}.starts`)).toBe(false);
      coherent();
      await t.until(
        () =>
          gateway.requests === 3 &&
          existsSync(`${out}.starts`) &&
          existsSync(`${out}.pcm`) &&
          statSync(`${out}.pcm`).size > 0 &&
          t.vt.text().includes("Pause"),
        "coherent draft starts real fake-player PCM",
      );
      await clickText(t, "Pause");
      await t.until(
        () => !t.vt.text().includes("Pause") && t.vt.text().includes("Play"),
        "manual pause while generator waits",
      );
      later();
      await t.until(
        () => gateway.requests === 4,
        "new ready music saved after pause",
      );
      expect(t.vt.text()).not.toContain("Pause");
      expect(
        (await readFile(`${out}.starts`, "utf8")).trim().split("\n"),
      ).toHaveLength(1);
      await clickText(t, "Next section");
      await t.until(
        () => t.vt.lines()[0]?.includes("3.1") === true,
        "seek runs during generation",
      );
      afterSeek();
      await t.until(() => gateway.requests === 5, "later update after seek");
      expect(t.vt.lines()[0]).toContain("3.1");
      expect(t.vt.text()).not.toContain("Pause");
      expect(
        (await readFile(`${out}.starts`, "utf8")).trim().split("\n"),
      ).toHaveLength(1);
      finish();
      await t.until(() => state(t)?.busy === false, "finished");
      t.terminal.write("make the chorus brighter\r");
      await t.until(() => gateway.requests === 6, "follow-up edit begins");
      edit();
      await t.until(() => gateway.requests === 7, "follow-up music accepted");
      expect(t.vt.lines()[0]).toContain("3.1");
      expect(t.vt.text()).not.toContain("Pause");
      expect(
        (await readFile(`${out}.starts`, "utf8")).trim().split("\n"),
      ).toHaveLength(1);
      finishEdit();
      await t.until(() => state(t)?.busy === false, "follow-up edit finishes");
    } finally {
      gateway.stop();
      await quit(t);
      await rm(cwd, { recursive: true, force: true });
    }
  },
  35000,
);

test.skipIf(!supported)(
  "song studio default: a seek before readiness suppresses delayed autoplay",
  async () => {
    const gateway = new Gateway();
    const first = gateway.gate([notes("bass", [0, 4])]);
    const coherent = gateway.gate([notes("keys", [0, 4])]);
    const finish = gateway.gate();
    const { cwd } = await fixture(4);
    const out = join(cwd, "studio-player");
    const t = await launch(
      120,
      40,
      {
        ...gateway.env,
        DAWG_AUDIO: "1",
        DAWG_AUDIO_PLAYER: `${process.execPath} ${FAKE_PLAYER} ${out}`,
      },
      ["--track", "bass"],
      cwd,
    );
    try {
      await t.until(() => state(t) !== undefined, "ready");
      t.terminal.write("write a song\r");
      await t.until(() => gateway.requests === 1, "first stage");
      first();
      await t.until(() => gateway.requests === 2, "first part saved");
      t.terminal.write("/view voice\r");
      await t.until(
        () =>
          state(t)?.studio.track === "voice" &&
          state(t)?.studio.pinned === true,
        "typed view command runs during generation",
      );
      await clickText(t, "Next section");
      await t.until(
        () => t.vt.lines()[0]?.includes("3.1") === true,
        "pre-ready seek",
      );
      coherent();
      await t.until(() => gateway.requests === 3, "coherent update after seek");
      expect(t.vt.lines()[0]).toContain("3.1");
      expect(t.vt.text()).not.toContain("Pause");
      expect(existsSync(`${out}.starts`)).toBe(false);
      expect(state(t)?.studio).toMatchObject({ track: "voice", pinned: true });
      finish();
      await t.until(() => state(t)?.busy === false, "finished");
    } finally {
      gateway.stop();
      await quit(t);
      await rm(cwd, { recursive: true, force: true });
    }
  },
  30000,
);

test.skipIf(!supported)(
  "song studio default: cancel preserves accepted music and ignores a late model stage",
  async () => {
    const gateway = new Gateway();
    const first = gateway.gate([notes("bass", [0, 4])]);
    const late = gateway.gate([notes("keys", [0, 4])]);
    const { cwd, paths } = await fixture(4);
    const t = await launch(80, 24, gateway.env, ["--track", "bass"], cwd);
    try {
      await t.until(() => state(t) !== undefined, "ready");
      t.terminal.write("write a song\r");
      await t.until(() => gateway.requests === 1, "first stage");
      first();
      await t.until(
        () => gateway.requests === 2 && state(t)?.studio.track === "bass",
        "accepted music before cancel",
      );
      t.terminal.write("\x1b");
      await t.until(() => state(t)?.busy === false, "generation canceled");
      expect(
        (await loadSession<{ notes: unknown[] }>(paths)).composition.notes,
      ).toHaveLength(2);
      expect(t.vt.text()).not.toContain("Pause");
      late();
      await t.type("keep the bass", "draft after cancellation");
      expect(t.vt.text()).toContain("keep the bass");
      expect(
        (await loadSession<{ notes: unknown[] }>(paths)).composition.notes,
      ).toHaveLength(2);
      expect(state(t)?.studio.track).toBe("bass");
    } finally {
      gateway.stop();
      await quit(t);
      await rm(cwd, { recursive: true, force: true });
    }
  },
  30000,
);
