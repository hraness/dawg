/**
 * End-to-end latencies through the real `dawg` TUI in a pseudo-terminal:
 * what a person feels, from a keystroke to the screen or to audio.
 *
 * Audio goes to bench/perf/sink.ts through DAWG_AUDIO_PLAYER. The sink logs
 * each silence→sound edge with the wall time its bytes arrived and the wall
 * time the engine scheduled them for (the device then adds its own output
 * buffer, which no PTY measurement can see). "Audible" below means the
 * scheduled time.
 *
 * Each scenario runs in its own temp directory with a temp HOME.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { VirtualTerminal } from "../../test/vt.ts";
import { epoch, metric, type Metric } from "./stats.ts";

const MAIN = resolve(import.meta.dir, "../../src/main.ts");
const SINK = resolve(import.meta.dir, "sink.ts");
const RATE = 44_100;

interface PtyTerminal {
  write(data: string): void;
  close(): void;
}

type Edge = { arrival: number; scheduled: number; on: boolean };

export type Session = Awaited<ReturnType<typeof open>>;

/** Launch the TUI; `audio` routes PCM to the sink. */
export async function open(
  options: {
    cols?: number;
    rows?: number;
    argv?: string[];
    env?: Record<string, string>;
    audio?: boolean;
    dir?: string;
  } = {},
) {
  const cwd = options.dir ?? (await mkdtemp(join(tmpdir(), "dawg-perf-")));
  const log = join(cwd, "sink.log");
  const cols = options.cols ?? 110;
  const rows = options.rows ?? 32;
  const vt = new VirtualTerminal(cols, rows);
  const decoder = new TextDecoder();
  let waiter: (() => void) | undefined;
  const spawnedAt = epoch();
  const proc = Bun.spawn(
    [process.execPath, MAIN, ...(options.argv ?? ["--track", "lead"])],
    {
      cwd,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: cwd,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        DAWG_DAEMON: "0",
        AI_GATEWAY_API_KEY: "vck_perfbench000000000000000",
        DAWG_CREDENTIAL_STORE: "file",
        DAWG_CONFIG_DIR: join(cwd, ".config", "dawg"),
        DAWG_MODELS_DEV_URL: "http://127.0.0.1:9/api.json",
        ...(options.audio
          ? {
              DAWG_AUDIO: "1",
              DAWG_AUDIO_PLAYER: `${process.execPath} ${SINK} ${log} {rate}`,
            }
          : { DAWG_AUDIO: "0" }),
        ...options.env,
      },
      terminal: {
        cols,
        rows,
        data(_terminal: unknown, data: Uint8Array) {
          vt.write(decoder.decode(data, { stream: true }));
          waiter?.();
        },
      },
    } as Parameters<typeof Bun.spawn>[1],
  );
  const terminal = (proc as unknown as { terminal: PtyTerminal }).terminal;
  const text = () => vt.text();
  /** Resolve with the epoch ms of the first screen update that satisfies it. */
  const until = (
    predicate: (screen: string) => boolean,
    label: string,
    timeoutMs = 10_000,
  ): Promise<number> =>
    new Promise((resolvePromise, reject) => {
      if (predicate(text())) return resolvePromise(epoch());
      const timer = setTimeout(() => {
        waiter = undefined;
        reject(new Error(`timed out waiting for ${label}\n${text()}`));
      }, timeoutMs);
      waiter = () => {
        if (!predicate(text())) return;
        waiter = undefined;
        clearTimeout(timer);
        resolvePromise(epoch());
      };
    });
  const send = (data: string): number => {
    const at = epoch();
    terminal.write(data);
    return at;
  };
  const edges = async (): Promise<Edge[]> => {
    const raw = await readFile(log, "utf8").catch(() => "");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [arrival, scheduled, state] = line.split(" ");
        return {
          arrival: Number(arrival),
          scheduled: Number(scheduled),
          on: state === "on",
        };
      });
  };
  /** The first sound edge that arrived after `since`. */
  const soundAfter = async (
    since: number,
    timeoutMs = 5_000,
  ): Promise<Edge | undefined> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = (await edges()).find((e) => e.on && e.arrival >= since);
      if (hit) return hit;
      await Bun.sleep(5);
    }
    return undefined;
  };
  const close = async () => {
    terminal.write("\u0003");
    await Promise.race([proc.exited, Bun.sleep(3000)]);
    proc.kill();
    terminal.close();
    if (!options.dir) await rm(cwd, { recursive: true, force: true });
  };
  return {
    cwd,
    vt,
    proc,
    spawnedAt,
    text,
    until,
    send,
    edges,
    soundAfter,
    close,
  };
}

const ready = (s: Session) => s.until((t) => t.includes(" NOW "), "prompt");

/** Spawn to the first full frame, and to the first note heard. */
export async function startup(runs: number): Promise<Metric[]> {
  const frame: number[] = [];
  const note: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const s = await open({ audio: true });
    try {
      const at = await ready(s);
      frame.push(at - s.spawnedAt);
      // As fast as a person can: `/play`, then a key once play mode shows.
      s.send("/play\r");
      await s.until((t) => t.includes("PLAY MODE"), "play mode");
      const pressed = s.send("a");
      const edge = await s.soundAfter(pressed);
      if (edge) note.push(edge.scheduled - s.spawnedAt);
    } finally {
      await s.close();
    }
  }
  return [
    metric("startup.frame", "startup → first frame", frame),
    metric("startup.note", "startup → first playable note heard", note),
  ];
}

/** Per instrument: key → audible, first press (cold) and later presses. */
export const KEY_INSTRUMENTS: ReadonlyArray<[id: string, command: string]> = [
  ["sine", ""],
  ["saw", "instrument saw"],
  ["grand", "instrument grand"],
  ["tonewheel", "instrument tonewheel"],
  ["bowed-cello", "instrument bowed-cello"],
  ["sing-choir", "sing choir"],
  ["granular-swarm", "granular swarm"],
];
const KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "w", "e"];

export async function keys(presses: number): Promise<Metric[]> {
  const out: Metric[] = [];
  for (const [id, command] of KEY_INSTRUMENTS) {
    const s = await open({ audio: true });
    try {
      await ready(s);
      if (command) {
        s.send(`${command}\r`);
        await s.until((t) => t.includes("rev 0→1"), `${id} set`);
      }
      s.send("/play\r");
      await s.until((t) => t.includes("PLAY MODE"), "play mode");
      await Bun.sleep(400);
      const cold: number[] = [];
      const warm: number[] = [];
      const bytesCold: number[] = [];
      const bytesWarm: number[] = [];
      for (let i = 0; i <= presses; i += 1) {
        const pressed = s.send(KEYS[i % KEYS.length]!);
        const edge = await s.soundAfter(pressed);
        if (edge) {
          (i === 0 ? cold : warm).push(edge.scheduled - pressed);
          (i === 0 ? bytesCold : bytesWarm).push(edge.arrival - pressed);
        }
        // Let the note (one grid step) and its tail clear the sink.
        await Bun.sleep(i < KEYS.length ? 700 : 450);
      }
      out.push(
        metric(
          `key.bytes.cold.${id}`,
          `key → audio bytes, first press, ${id}`,
          bytesCold,
        ),
        metric(
          `key.bytes.warm.${id}`,
          `key → audio bytes, later, ${id}`,
          bytesWarm,
        ),
        metric(`key.cold.${id}`, `key → audible, first press, ${id}`, cold),
        metric(`key.warm.${id}`, `key → audible, later, ${id}`, warm),
      );
    } finally {
      await s.close();
    }
  }
  return out;
}

/** A typed command: Enter → receipt on screen → audible change. */
export async function command(cycles: number): Promise<Metric[]> {
  const s = await open({ audio: true });
  const receipt: number[] = [];
  const audible: number[] = [];
  const bytes: number[] = [];
  try {
    await ready(s);
    s.send("add C4 at 0 for 16\r");
    await s.until((t) => t.includes("rev 0→1"), "note");
    s.send("volume 0\r");
    await s.until((t) => t.includes("rev 1→2"), "silent");
    s.send("play\r");
    await Bun.sleep(1200);
    let rev = 2;
    for (let i = 0; i < cycles; i += 1) {
      const sent = s.send("volume 1\r");
      const shown = await s.until(
        (t) => t.includes(`rev ${rev}→${rev + 1}`),
        "receipt",
      );
      rev += 1;
      receipt.push(shown - sent);
      const edge = await s.soundAfter(sent);
      if (edge) {
        audible.push(edge.scheduled - sent);
        bytes.push(edge.arrival - sent);
      }
      await Bun.sleep(300);
      s.send("volume 0\r");
      await s.until((t) => t.includes(`rev ${rev}→${rev + 1}`), "silence");
      rev += 1;
      await Bun.sleep(500);
    }
  } finally {
    await s.close();
  }
  return [
    metric("command.receipt", "typed command → receipt", receipt),
    metric("command.bytes", "typed command → new audio bytes", bytes),
    metric("command.audible", "typed command → audible change", audible),
  ];
}

/** Menu fader (volume row, auditioning): arrow → audible change. */
export async function fader(cycles: number): Promise<Metric[]> {
  const s = await open({ audio: true });
  const audible: number[] = [];
  try {
    await ready(s);
    s.send("add C4 at 0 for 16\r");
    await s.until((t) => t.includes("rev 0→1"), "note");
    s.send("volume 0\r");
    await s.until((t) => t.includes("rev 1→2"), "silent");
    s.send("/menu mix\r");
    await s.until((t) => t.includes("menu › Mix"), "mix menu");
    s.send("jjj");
    await s.until((t) => t.includes("› volume"), "volume row");
    s.send(" ");
    await s.until((t) => t.includes("♪ solo"), "audition");
    await Bun.sleep(1000);
    for (let i = 0; i < cycles; i += 1) {
      const sent = s.send("\u001b[C");
      const edge = await s.soundAfter(sent);
      if (edge) audible.push(edge.scheduled - sent);
      await Bun.sleep(400);
      s.send("\u001b[D");
      await Bun.sleep(600);
    }
  } finally {
    await s.close();
  }
  return [metric("fader.audible", "fader step → audible change", audible)];
}

/** Two-way sync: song.ts saved in an editor → the TUI shows it. */
export async function sync(cycles: number): Promise<Metric[]> {
  const dir = await mkdtemp(join(tmpdir(), "dawg-perf-sync-"));
  const init = Bun.spawn([process.execPath, MAIN, "init"], {
    cwd: dir,
    env: { PATH: process.env.PATH ?? "", HOME: dir, DAWG_DAEMON: "0" },
    stdout: "ignore",
    stderr: "ignore",
  });
  await init.exited;
  const s = await open({ argv: [], dir });
  const shown: number[] = [];
  try {
    await ready(s);
    await Bun.sleep(1500);
    for (let i = 0; i < cycles; i += 1) {
      const tempo = 90 + i;
      const saved = epoch();
      await writeFile(
        join(dir, "song.ts"),
        `import { song } from "dawg";\n\nexport default song({\n  tempo: ${tempo},\n  meter: [4, 4],\n  bars: 4,\n  tracks: [],\n  calibration: 1,\n});\n`,
      );
      const at = await s.until(
        (t) => t.includes(`${tempo} BPM`),
        `tempo ${tempo}`,
      );
      shown.push(at - saved);
      await Bun.sleep(400);
    }
  } finally {
    await s.close();
    await rm(dir, { recursive: true, force: true });
  }
  return [metric("sync.file", "song.ts saved → TUI updated", shown)];
}

/** A streaming provider: Enter → the first streamed token on screen. */
export async function agent(cycles: number): Promise<Metric[]> {
  const encoder = new TextEncoder();
  let reply = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      if (!new URL(request.url).pathname.endsWith("/chat/completions"))
        return new Response("nope", { status: 404 });
      await request.json();
      const word = `zebra${reply++}`;
      const chunks = [
        `Okay ${word}, `,
        "thinking about the groove. ",
        "Nothing to change.",
      ];
      let sent = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (sent > 0) await Bun.sleep(150);
            if (sent >= chunks.length) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
                ),
              );
              controller.close();
              return;
            }
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: chunks[sent++] } }] })}\n\n`,
              ),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const s = await open({
    env: {
      AI_GATEWAY_BASE_URL: `${origin}/v1`,
      DAWG_MODELS_DEV_URL: `${origin}/api.json`,
    },
  });
  const first: number[] = [];
  try {
    await ready(s);
    await Bun.sleep(800);
    for (let i = 0; i < cycles; i += 1) {
      const word = `zebra${i}`;
      const sent = s.send(`make the groove looser please ${i}\r`);
      const at = await s.until((t) => t.includes(word), `token ${word}`);
      first.push(at - sent);
      await s
        .until(
          (t) => t.includes(" NOW ") && !t.includes("esc stop"),
          "idle",
          10_000,
        )
        .catch(() => 0);
      await Bun.sleep(600);
    }
  } finally {
    await s.close();
    server.stop(true);
  }
  return [
    metric("agent.first-token", "agent: Enter → first token shown", first),
  ];
}
