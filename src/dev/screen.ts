/**
 * Dev-mode screen snapshots (design §5.4b): each pane writes its last
 * drawn frame as plain text to `.dawg/dev/screen-<letter>.txt`, at most
 * every 500 ms, so a coding agent in another terminal can read what the
 * TUI shows (`dawg dev screen`). Only in dev mode; never throws.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SCREEN_DIR = ".dawg/dev";
export const SCREEN_DEBOUNCE_MS = 500;
const MAX_BYTES = 64 * 1024;

/** `A` → `screen-A.txt`; anything but one letter is `screen.txt`. */
export function screenFile(letter: string | undefined): string {
  return letter !== undefined && /^[A-Z]$/.test(letter)
    ? `screen-${letter}.txt`
    : "screen.txt";
}

/** Plain text with any escape sequences and control bytes removed. */
export function plainScreen(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\][^\u0007]*(\u0007|\u001b\\)/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""))
      .join("\n")
      .slice(0, MAX_BYTES)
  );
}

export type ScreenSnapshots = Readonly<{
  /** A frame was drawn; written after the debounce. */
  drawn(text: () => string): void;
  /** Write any pending frame now (exit). */
  flush(): void;
  stop(): void;
}>;

/** One writer per pane. `letter` is read at write time (dawgd assigns it). */
export function screenSnapshots(
  project: string,
  letter: () => string | undefined,
  debounceMs = SCREEN_DEBOUNCE_MS,
): ScreenSnapshots {
  let pending: (() => string) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = "";
  const write = () => {
    timer = undefined;
    const source = pending;
    pending = undefined;
    if (!source) return;
    try {
      const text = plainScreen(source());
      if (text === last) return;
      last = text;
      const dir = join(project, SCREEN_DIR);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, screenFile(letter()));
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, `${text}\n`);
      renameSync(temp, path);
    } catch {
      // A read-only project or a full disk never disturbs the editor.
    }
  };
  return {
    drawn(text) {
      pending = text;
      if (timer === undefined) {
        timer = setTimeout(write, debounceMs);
        timer.unref?.();
      }
    },
    flush() {
      if (timer !== undefined) clearTimeout(timer);
      write();
    },
    stop() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}
