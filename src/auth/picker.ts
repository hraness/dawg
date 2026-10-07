import { stdin, stdout } from "node:process";

/**
 * A small inline picker for the shell (`dawg login`, `dawg model`), in the
 * style of the Codex CLI sign-in: ↑/↓ or j/k move, Enter chooses, 1-9 jump
 * and choose, typing filters (when enabled), Esc or Ctrl-C cancels. It draws
 * below the cursor and erases itself afterwards, so the scrollback keeps only
 * the one-line result the caller prints.
 */
export type ChoiceItem = Readonly<{
  label: string;
  /** Right-hand muted text: a status, a price. */
  detail?: string;
  /** Section heading shown above the first row of each group. */
  group?: string;
  /** Rows that cannot be chosen still show (e.g. "not set up"). */
  disabled?: boolean;
  /** Marked with ● (the current model). */
  current?: boolean;
}>;

export type ChooseOptions = Readonly<{
  initial?: number;
  /** Type-to-filter on label and detail. */
  filter?: boolean;
  /** Footer hint override. */
  hint?: string;
}>;

export type PickerKey =
  | { type: "up" }
  | { type: "down" }
  | { type: "enter" }
  | { type: "cancel" }
  | { type: "digit"; value: number }
  | { type: "backspace" }
  | { type: "text"; text: string };

/** Split one raw stdin read into picker keys. */
export function parsePickerKeys(data: string): PickerKey[] {
  const keys: PickerKey[] = [];
  let rest = data.replace(/\u001b\[20[01]~/g, "");
  while (rest.length > 0) {
    if (rest.startsWith("\u001b[A") || rest.startsWith("\u001bOA")) {
      keys.push({ type: "up" });
      rest = rest.slice(3);
    } else if (rest.startsWith("\u001b[B") || rest.startsWith("\u001bOB")) {
      keys.push({ type: "down" });
      rest = rest.slice(3);
    } else if (rest.startsWith("\u001b[")) {
      // Other CSI sequences (left/right, home, …) are ignored.
      const match = /^\u001b\[[0-9;]*[A-Za-z~]/.exec(rest);
      rest = rest.slice(match ? match[0].length : 2);
    } else {
      const char = rest[0]!;
      rest = rest.slice(1);
      if (char === "\r" || char === "\n") keys.push({ type: "enter" });
      else if (char === "\u001b" || char === "\u0003")
        keys.push({ type: "cancel" });
      else if (char === "\u007f" || char === "\b")
        keys.push({ type: "backspace" });
      else if (char === "\u0010") keys.push({ type: "up" });
      else if (char === "\u000e") keys.push({ type: "down" });
      else if (char >= " ") keys.push({ type: "text", text: char });
    }
  }
  return keys;
}

/** The picker's pure state; `step` applies one key. */
export class PickerModel {
  index: number;
  query = "";
  constructor(
    readonly items: readonly ChoiceItem[],
    readonly options: ChooseOptions = {},
  ) {
    const visible = this.visible();
    const initial = options.initial ?? 0;
    const start = visible.indexOf(initial) >= 0 ? initial : (visible[0] ?? 0);
    this.index = start;
  }

  /** Indices of rows matching the filter, in order. */
  visible(): number[] {
    const query = this.query.toLowerCase();
    return this.items
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          !query ||
          item.label.toLowerCase().includes(query) ||
          (item.detail ?? "").toLowerCase().includes(query) ||
          (item.group ?? "").toLowerCase().includes(query),
      )
      .map(({ index }) => index);
  }

  /** `undefined` while picking, a row index when chosen, `null` on cancel. */
  step(key: PickerKey): number | null | undefined {
    const visible = this.visible();
    const position = Math.max(0, visible.indexOf(this.index));
    const move = (delta: number) => {
      if (visible.length === 0) return;
      for (let offset = 1; offset <= visible.length; offset += 1) {
        const n = visible.length;
        const next = visible[(((position + delta * offset) % n) + n) % n]!;
        if (!this.items[next]?.disabled) {
          this.index = next;
          return;
        }
      }
    };
    switch (key.type) {
      case "up":
        move(-1);
        return undefined;
      case "down":
        move(1);
        return undefined;
      case "enter":
        return visible.includes(this.index) && !this.items[this.index]?.disabled
          ? this.index
          : undefined;
      case "cancel":
        if (this.query) {
          this.query = "";
          this.refocus();
          return undefined;
        }
        return null;
      case "backspace":
        this.query = this.query.slice(0, -1);
        this.refocus();
        return undefined;
      case "digit": {
        const target = visible[key.value - 1];
        if (target !== undefined && !this.items[target]?.disabled)
          return target;
        return undefined;
      }
      case "text":
        if (/^[1-9]$/.test(key.text) && !this.query)
          return this.step({ type: "digit", value: Number(key.text) });
        if (!this.options.filter) {
          if (key.text === "k") move(-1);
          if (key.text === "j") move(1);
          return undefined;
        }
        if (this.query.length < 40) this.query += key.text;
        this.refocus();
        return undefined;
    }
  }

  private refocus(): void {
    const visible = this.visible().filter(
      (index) => !this.items[index]?.disabled,
    );
    if (!visible.includes(this.index) && visible.length > 0)
      this.index = visible[0]!;
  }

  /** Plain lines (no colour); the renderer styles them. */
  lines(
    title: string,
    maxRows = 14,
  ): {
    text: string;
    kind: "title" | "group" | "row" | "selected" | "muted" | "hint";
  }[] {
    const out: {
      text: string;
      kind: "title" | "group" | "row" | "selected" | "muted" | "hint";
    }[] = [
      {
        text: title + (this.query ? `  filter: ${this.query}` : ""),
        kind: "title",
      },
    ];
    const visible = this.visible();
    if (visible.length === 0) out.push({ text: "  no matches", kind: "muted" });
    const position = Math.max(0, visible.indexOf(this.index));
    const first = Math.max(
      0,
      Math.min(visible.length - maxRows, position - Math.floor(maxRows / 2)),
    );
    let lastGroup: string | undefined;
    visible.slice(first, first + maxRows).forEach((index, offset) => {
      const item = this.items[index]!;
      if (item.group && item.group !== lastGroup) {
        out.push({ text: `  ${item.group}`, kind: "group" });
      }
      lastGroup = item.group;
      const selected = index === this.index;
      const number =
        first + offset < 9 && !this.query ? `${first + offset + 1}.` : "  ";
      const mark = item.current ? "●" : " ";
      out.push({
        text: `${selected ? "›" : " "} ${number} ${mark} ${item.label}${item.detail ? `  ${item.detail}` : ""}`,
        kind: selected ? "selected" : item.disabled ? "muted" : "row",
      });
    });
    out.push({
      text:
        this.options.hint ??
        `  ↑/↓ move · enter choose · 1-9 pick${this.options.filter ? " · type to filter" : ""} · esc cancel`,
      kind: "hint",
    });
    return out;
  }
}

const ESC = "\u001b[";

function style(kind: string, text: string, color: boolean): string {
  if (!color) return text;
  if (kind === "title") return `${ESC}1m${text}${ESC}0m`;
  if (kind === "selected") return `${ESC}1;36m${text}${ESC}0m`;
  if (kind === "group") return `${ESC}2;4m${text}${ESC}0m`;
  if (kind === "muted" || kind === "hint") return `${ESC}2m${text}${ESC}0m`;
  return text;
}

/**
 * Run a picker on the real terminal. Resolves the chosen index, or
 * `undefined` on Esc / Ctrl-C. Requires a TTY on stdin and stdout.
 */
export function chooseOnTerminal(
  title: string,
  items: readonly ChoiceItem[],
  options: ChooseOptions = {},
): Promise<number | undefined> {
  const model = new PickerModel(items, options);
  const color = !process.env.NO_COLOR && process.env.TERM !== "dumb";
  const width = () => Math.max(20, (stdout.columns ?? 80) - 1);
  let drawn = 0;
  const draw = () => {
    const lines = model.lines(
      title,
      Math.max(4, Math.min(14, (stdout.rows ?? 24) - 6)),
    );
    let out = drawn > 0 ? `\r${ESC}${drawn - 1}A` : "\r";
    out += `${ESC}J`;
    out += lines
      .map((line) => style(line.kind, truncate(line.text, width()), color))
      .join("\r\n");
    drawn = lines.length;
    stdout.write(`${ESC}?25l${out}`);
  };
  const erase = () => {
    if (drawn > 0) stdout.write(`\r${ESC}${drawn - 1}A${ESC}J`);
    stdout.write(`${ESC}?25h`);
  };
  return new Promise((resolve) => {
    const wasRaw = stdin.isRaw;
    stdin.setRawMode?.(true);
    stdin.resume();
    const finish = (result: number | undefined) => {
      stdin.off("data", onData);
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
      erase();
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      for (const key of parsePickerKeys(chunk.toString("utf8"))) {
        const result = model.step(key);
        if (result === null) return finish(undefined);
        if (result !== undefined) return finish(result);
      }
      draw();
    };
    stdin.on("data", onData);
    draw();
  });
}

function truncate(text: string, width: number): string {
  const chars = [...text];
  return chars.length > width ? `${chars.slice(0, width - 1).join("")}…` : text;
}
