/**
 * Drives the real `dawg` in a pseudo-terminal under the screens preload
 * (test/screens/preload.ts): one process per scene, a frozen clock the
 * scene advances step by step, and a capture of the virtual terminal's
 * cells with their colours.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { VirtualTerminal, type VtStyle } from "../vt.ts";

export const MAIN = resolve(import.meta.dir, "../../src/main.ts");
const PRELOAD = resolve(import.meta.dir, "preload.ts");

export const supported =
  process.platform !== "win32" &&
  typeof (Bun as unknown as { Terminal?: unknown }).Terminal === "function";

interface PtyTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  close(): void;
}

/** One cell style as stored in a screen file (only set fields). */
export type ScreenStyle = {
  fg?: string;
  bg?: string;
  bold?: true;
  dim?: true;
  italic?: true;
  underline?: true;
  reverse?: true;
};

/** A captured screen: rows of [text, style index] runs. */
export interface ScreenFile {
  id: string;
  cols: number;
  rows: number;
  styles: ScreenStyle[];
  lines: [string, number][][];
}

export interface Pty {
  vt: VirtualTerminal;
  proc: ReturnType<typeof Bun.spawn>;
  terminal: PtyTerminal;
  cwd: string;
}

export class Stage {
  readonly cwd: string;
  private readonly clockFile: string;
  private ms = 0;
  private readonly ptys: Pty[] = [];
  private readonly cleanups: (() => void | Promise<void>)[] = [];

  constructor(
    readonly env: Record<string, string> = {},
    /** Extra preloads (a fake native sink) after the clock. */
    readonly preloads: string[] = [],
  ) {
    this.cwd = mkdtempSync(join(tmpdir(), "dawg-screen-"));
    this.clockFile = join(this.cwd, ".screen-clock");
    writeFileSync(this.clockFile, "0");
  }

  /** Something to undo when the scene ends (a fake server). */
  onClose(cleanup: () => void | Promise<void>): void {
    this.cleanups.push(cleanup);
  }

  /** Starts `dawg argv…` in a cols×rows PTY in the stage's workspace. */
  open(
    cols: number,
    rows: number,
    argv: string[] = [],
    env: Record<string, string> = {},
  ): Pty {
    const vt = new VirtualTerminal(cols, rows);
    const decoder = new TextDecoder();
    const proc = Bun.spawn([process.execPath, MAIN, ...argv], {
      cwd: this.cwd,
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        HOME: this.cwd,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        LANG: "en_US.UTF-8",
        TZ: "UTC",
        DAWG_DAEMON: "0",
        DAWG_AUDIO: "0",
        AI_GATEWAY_API_KEY: "vck_screens000000000000000000",
        DAWG_CREDENTIAL_STORE: "file",
        DAWG_CONFIG_DIR: join(this.cwd, ".config", "dawg"),
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        BUN_OPTIONS: [PRELOAD, ...this.preloads]
          .map((file) => `--preload ${file}`)
          .join(" "),
        DAWG_SCREEN_CLOCK: this.clockFile,
        ...this.env,
        ...env,
      },
      terminal: {
        cols,
        rows,
        data(_terminal: unknown, data: Uint8Array) {
          vt.write(decoder.decode(data, { stream: true }));
        },
      },
    } as Parameters<typeof Bun.spawn>[1]);
    const terminal = (proc as unknown as { terminal: PtyTerminal }).terminal;
    const pty = { vt, proc, terminal, cwd: this.cwd };
    this.ptys.push(pty);
    return pty;
  }

  /** Advances the frozen clock `n` steps of `stepMs`, letting each land. */
  async step(n = 1, stepMs = 50): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      this.ms += stepMs;
      writeFileSync(this.clockFile, String(this.ms));
      await Bun.sleep(30);
    }
  }

  /**
   * Waits in real time, with the clock held, until `predicate` holds. The
   * clock never moves here, so how long the wait takes cannot change what
   * the screen shows.
   */
  async until(
    predicate: () => boolean,
    label: string,
    pty?: Pty,
    timeoutMs = 20_000,
  ): Promise<void> {
    const deadline = performance.now() + timeoutMs;
    while (!predicate()) {
      if (performance.now() > deadline)
        throw new Error(
          `screens: timed out waiting for ${label}\n${(pty ?? this.ptys[0])?.vt.text() ?? ""}`,
        );
      await Bun.sleep(20);
    }
  }

  /** Types into a PTY, then lets the frame land. */
  async type(pty: Pty, data: string, settle = 4): Promise<void> {
    pty.terminal.write(data);
    // Let the keys land at the held time: a key handled one step later
    // would start the transport (or a typing animation) 10 ms off.
    await Bun.sleep(200);
    await this.step(settle, 10);
  }

  /**
   * Waits until the screen stops changing between clock steps of zero
   * length (only real-time work left), then returns its cells.
   */
  async capture(pty: Pty, id: string): Promise<ScreenFile> {
    // One step past the renderer's minimum frame gap (33 ms), so the last
    // frame is built at exactly this clock time however the real-time
    // ticks fell during the steps before it.
    this.ms += 50;
    writeFileSync(this.clockFile, String(this.ms));
    await Bun.sleep(150);
    let last = "";
    for (let i = 0; i < 40; i += 1) {
      await Bun.sleep(60);
      const now = snapshotKey(pty.vt);
      if (now === last) break;
      last = now;
    }
    return toScreen(pty.vt, id);
  }

  async close(): Promise<void> {
    for (const pty of this.ptys) {
      try {
        pty.terminal.write("\u0003");
      } catch {
        // already gone
      }
    }
    await Promise.all(
      this.ptys.map((pty) => Promise.race([pty.proc.exited, Bun.sleep(3000)])),
    );
    for (const pty of this.ptys) {
      pty.proc.kill("SIGKILL");
      try {
        pty.terminal.close();
      } catch {
        // already closed
      }
    }
    for (const cleanup of this.cleanups) await cleanup();
    rmSync(this.cwd, { recursive: true, force: true });
  }
}

function snapshotKey(vt: VirtualTerminal): string {
  const parts: string[] = [];
  for (let y = 0; y < vt.rows; y += 1)
    for (let x = 0; x < vt.cols; x += 1) {
      const cell = vt.cell(x, y);
      parts.push(cell.ch, JSON.stringify(cell.style));
    }
  return parts.join("");
}

/**
 * A blank shows only its background: the renderer writes spaces under
 * whatever pen it last used, which says nothing about the picture.
 */
function visibleStyle(ch: string, style: ScreenStyle): ScreenStyle {
  if (ch !== " ") return style;
  const out: ScreenStyle = {};
  if (style.bg) out.bg = style.bg;
  if (style.reverse) {
    if (style.fg) out.fg = style.fg;
    out.reverse = true;
  }
  if (style.underline) out.underline = true;
  return out;
}

function cleanStyle(style: VtStyle): ScreenStyle {
  const out: ScreenStyle = {};
  if (style.fg) out.fg = style.fg;
  if (style.bg) out.bg = style.bg;
  if (style.bold) out.bold = true;
  if (style.dim) out.dim = true;
  if (style.italic) out.italic = true;
  if (style.underline) out.underline = true;
  if (style.reverse) out.reverse = true;
  return out;
}

/** The terminal's cells as runs of same-styled text, styles interned. */
export function toScreen(vt: VirtualTerminal, id: string): ScreenFile {
  const styles: ScreenStyle[] = [];
  const index = new Map<string, number>();
  const intern = (style: ScreenStyle): number => {
    const key = JSON.stringify(style);
    let found = index.get(key);
    if (found === undefined) {
      found = styles.length;
      styles.push(style);
      index.set(key, found);
    }
    return found;
  };
  const lines: [string, number][][] = [];
  for (let y = 0; y < vt.rows; y += 1) {
    const runs: [string, number][] = [];
    for (let x = 0; x < vt.cols; x += 1) {
      const cell = vt.cell(x, y);
      const style = intern(visibleStyle(cell.ch, cleanStyle(cell.style)));
      const last = runs.at(-1);
      if (last && last[1] === style) last[0] += cell.ch;
      else runs.push([cell.ch, style]);
    }
    lines.push(runs);
  }
  return { id, cols: vt.cols, rows: vt.rows, styles, lines };
}

/** The screen's plain text, one string per row (trailing spaces trimmed). */
export function screenText(screen: ScreenFile): string[] {
  return screen.lines.map((runs) =>
    runs
      .map((run) => run[0])
      .join("")
      .trimEnd(),
  );
}

/** Two screens next to each other with a one-column gap (two terminals). */
export function sideBySide(
  id: string,
  left: ScreenFile,
  right: ScreenFile,
): ScreenFile {
  const styles = [...left.styles];
  const index = new Map(styles.map((style, i) => [JSON.stringify(style), i]));
  const remap = (style: ScreenStyle): number => {
    const key = JSON.stringify(style);
    let found = index.get(key);
    if (found === undefined) {
      found = styles.length;
      styles.push(style);
      index.set(key, found);
    }
    return found;
  };
  const blank = remap({});
  const rows = Math.max(left.rows, right.rows);
  const lines: [string, number][][] = [];
  for (let y = 0; y < rows; y += 1) {
    const row: [string, number][] = [
      ...(left.lines[y] ?? [[" ".repeat(left.cols), blank]]),
    ].map(([text, style]) => [text, style] as [string, number]);
    row.push([" ", blank]);
    for (const [text, style] of right.lines[y] ?? [[" ".repeat(right.cols), 0]])
      row.push([text, remap(right.styles[style] ?? {})]);
    lines.push(row);
  }
  return { id, cols: left.cols + 1 + right.cols, rows, styles, lines };
}
