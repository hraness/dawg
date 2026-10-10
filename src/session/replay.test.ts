/**
 * Lane N seams: the event log replays as operations, and two authorities
 * that exchange only accepted events (an in-memory relay, no network code)
 * converge on one composition digest.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyScoreOperation,
  createScore,
  type ScoreOperation,
  type TrackScore,
} from "../../core/score.ts";
import { DaemonClient } from "./client.ts";
import { compositionDigest } from "./protocol.ts";
import { ensureSession, loadSession, type SessionRecord } from "./store.ts";

process.env.DAWG_AUDIO = "0";
const DAEMON_ARGS = ["--grace-ms", "300"];
const SHA = "a".repeat(64);
const clients: DaemonClient[] = [];
const workspaces: string[] = [];

function initialScore(): TrackScore {
  return createScore({
    tracks: [
      { id: "main", name: "main", instrument: "sine" },
      { id: "bass", name: "bass", instrument: "saw" },
    ],
  });
}

async function daemonSession() {
  const workspace = await mkdtemp(join(tmpdir(), "dawg-replay-"));
  workspaces.push(workspace);
  const { paths, record } = await ensureSession(initialScore().toJSON(), {
    workspace,
  });
  return { workspace, paths, sessionId: record.sessionId };
}

async function connect(workspace: string, sessionId: string, label: string) {
  const client = await DaemonClient.connect({
    workspace,
    sessionId,
    label,
    daemonArgs: DAEMON_ARGS,
  });
  clients.push(client);
  return client;
}

async function until(check: () => boolean, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await Bun.sleep(20);
  }
}

function note(id: string, trackId: string, startTick: number) {
  return { id, trackId, startTick, durationTicks: 120, pitch: 60, velocity: 1 };
}

/** A small instrument patch: saw into an enveloped amp, one macro. */
const PATCH = {
  kind: "patch",
  role: "instrument",
  name: "pad",
  nodes: [
    { id: "osc1", type: "osc" },
    { id: "env", type: "adsr" },
    { id: "amp", type: "vca" },
  ],
  cables: [
    { id: "c1", from: "voice.pitch", to: "osc1.pitch" },
    { id: "c2", from: "osc1.out", to: "amp.in" },
    { id: "c3", from: "voice.gate", to: "env.gate" },
    { id: "c4", from: "env.out", to: "amp.gain" },
    { id: "c5", from: "amp.out", to: "out.audio" },
  ],
  macros: [
    { id: "level", min: 0, max: 1, default: 0.8, to: [{ port: "osc1.level" }] },
  ],
};

/** One operation of every kind, in an order the reducer accepts. */
const EVERY_OP: ScoreOperation[] = [
  { type: "addTrack", track: { id: "vox", name: "vox", instrument: "sine" } },
  { type: "addNote", note: note("n1", "main", 0) },
  { type: "addNote", note: note("n2", "main", 480) },
  { type: "addNote", note: note("n3", "bass", 0) },
  { type: "updateNote", noteId: "n1", patch: { pitch: 64 } },
  { type: "removeNote", noteId: "n2" },
  { type: "setTempo", tempoBpm: 96 },
  { type: "setBars", bars: 8 },
  { type: "updateTrack", trackId: "main", patch: { volume: 0.5 } },
  {
    type: "setAutomation",
    trackId: "main",
    parameter: "pan",
    points: [
      { tick: 0, value: -1 },
      { tick: 960, value: 1 },
    ],
  },
  { type: "moveTrack", trackId: "vox", index: 0 },
  { type: "setKey", key: "A minor" },
  { type: "setMeter", beatsPerBar: 3 },
  { type: "setTime", time: { fermatas: [{ tick: 0, beats: 2 }] } },
  { type: "setTuning", tuning: { edo: 19 } },
  { type: "setMaster", master: { target: -9 } },
  { type: "setCalibration", calibration: 1 },
  { type: "setStyle", style: { id: "deep-house", seed: 3, bars: 8 } },
  {
    type: "setClips",
    trackId: "vox",
    clips: [
      {
        id: "c1",
        src: "tracks/vox/samples/verse.wav",
        sha256: SHA,
        startTick: 0,
        offset: 0,
        dur: 1,
      },
    ],
  },
  {
    type: "setSections",
    sections: [{ name: "intro", startBar: 0, bars: 2 }],
    form: [{ section: "intro" }],
  },
  { type: "setLoop", loop: { startBar: 1, bars: 2 } },
  { type: "setPatch", target: { library: "pad" }, patch: PATCH },
  { type: "setPatch", target: { trackId: "main" }, patch: PATCH },
  {
    type: "setPatchNode",
    target: { trackId: "main" },
    nodeId: "vcf",
    node: { id: "vcf", type: "svf" },
  },
  {
    type: "setPatchCable",
    target: { trackId: "main" },
    cableId: "c2",
    cable: { id: "c2", from: "osc1.out", to: "vcf.in" },
  },
  {
    type: "setPatchMacro",
    target: { library: "pad" },
    macroId: "drive",
    macro: {
      id: "drive",
      min: 0,
      max: 4,
      default: 1,
      to: [{ port: "amp.gain" }],
    },
    index: 0,
  },
  { type: "clearTrack", trackId: "bass" },
  { type: "removeTrack", trackId: "bass" },
] as unknown as ScoreOperation[];

function fold(initial: TrackScore, record: SessionRecord<unknown>) {
  let score = initial;
  for (const event of record.events) {
    expect(event.ops).toBeDefined();
    for (const op of event.ops ?? [])
      score = applyScoreOperation(score, op as ScoreOperation);
  }
  return score;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const workspace of workspaces.splice(0)) {
    const sessions = join(workspace, ".dawg", "sessions");
    for await (const owner of new Bun.Glob("*.daemon.lock/owner").scan(
      sessions,
    )) {
      try {
        const { pid } = JSON.parse(
          await readFile(join(sessions, owner), "utf8"),
        ) as { pid: number };
        process.kill(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

describe("ops log", () => {
  test("covers every operation type", () => {
    const covered = new Set(EVERY_OP.map((op) => op.type));
    // Keep in step with ScoreOperation in core/score.ts.
    const all: ScoreOperation["type"][] = [
      "addTrack",
      "addNote",
      "removeNote",
      "updateNote",
      "setTempo",
      "setBars",
      "updateTrack",
      "setAutomation",
      "clearTrack",
      "removeTrack",
      "moveTrack",
      "setKey",
      "setMeter",
      "setTime",
      "setTuning",
      "setMaster",
      "setCalibration",
      "setStyle",
      "setClips",
      "setSections",
      "setLoop",
      "setPatch",
      "setPatchNode",
      "setPatchCable",
      "setPatchMacro",
    ];
    expect([...covered].sort()).toEqual([...all].sort());
  });

  test("folding the log from revision 0 reproduces the composition byte for byte", async () => {
    const { workspace, sessionId, paths } = await daemonSession();
    const pane = await connect(workspace, sessionId, "pane");
    // Every other edit goes as a full composition: the authority derives
    // its ops, so snapshot-style writers still produce a replayable log.
    let local = initialScore();
    for (const [index, op] of EVERY_OP.entries()) {
      local = applyScoreOperation(local, op);
      const result = await pane.apply({
        base: pane.record.revision,
        kind: "score.operation",
        payload: {},
        ...(index % 2 === 0
          ? { operations: [op] }
          : { composition: local.toJSON() }),
      });
      expect(result.status).toBe("accepted");
    }
    const stored = await loadSession(paths);
    expect(stored.events).toHaveLength(EVERY_OP.length);
    const replay = fold(initialScore(), stored);
    expect(JSON.stringify(replay.toJSON())).toBe(
      JSON.stringify(stored.composition),
    );
  });
});

/**
 * Forwards every event `from` accepts to `to` as an ops intent, keyed by the
 * source event id so an echo back is a duplicate, never a second write.
 */
function relay(from: DaemonClient, to: DaemonClient, seen: Set<string>) {
  let forwarded = from.record.revision;
  let chain = Promise.resolve();
  return from.subscribe((update) => {
    if (update.type !== "record") return;
    const fresh = update.record.events.filter(
      (event) => event.revision > forwarded,
    );
    forwarded = update.record.revision;
    for (const event of fresh) {
      if (seen.has(event.id) || !event.ops) continue;
      seen.add(event.id);
      chain = chain.then(async () => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const result = await to.apply({
            base: to.record.revision,
            kind: event.kind,
            payload: event.payload,
            key: event.id,
            operations: event.ops,
          });
          if (result.status !== "rebase") return;
          await to.sync();
        }
      });
    }
  });
}

describe("relay simulation", () => {
  test("two authorities that exchange accepted ops converge on one digest", async () => {
    const left = await daemonSession();
    const right = await daemonSession();
    const a = await connect(left.workspace, left.sessionId, "a");
    const b = await connect(right.workspace, right.sessionId, "b");
    const seen = new Set<string>();
    relay(a, b, seen);
    relay(b, a, seen);
    const edits: Promise<unknown>[] = [];
    for (let index = 0; index < 6; index += 1) {
      const side = index % 2 === 0 ? a : b;
      const track = index % 2 === 0 ? "main" : "bass";
      edits.push(
        side.apply({
          base: side.record.revision,
          kind: "score.operation",
          payload: {},
          operations: [
            { type: "addNote", note: note(`x${index}`, track, index * 240) },
          ],
        }),
      );
    }
    edits.push(
      a.apply({
        base: a.record.revision,
        kind: "score.operation",
        payload: {},
        operations: [{ type: "setTempo", tempoBpm: 100 }],
      }),
    );
    await Promise.all(edits);
    await until(
      () =>
        a.record.revision === 7 &&
        b.record.revision === 7 &&
        a.digest === b.digest,
      8_000,
    );
    expect(compositionDigest(a.record.composition)).toBe(
      compositionDigest(b.record.composition),
    );
  });
});
