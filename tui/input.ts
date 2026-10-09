/**
 * Incremental decoder for the small set of terminal sequences dawg accepts.
 * PTYs may split one CSI sequence across reads or combine several key events
 * into one read, so the main loop must consume framed events rather than raw
 * chunks.
 */
export type TerminalInputEvent =
  string | Readonly<{ type: "paste"; text: string }>;

/** A bracketed paste longer than this is emitted as it stands. */
export const MAX_PASTE_CHARS = 1 << 20;

/** A chunk marker the read loop yields when input went idle mid-sequence. */
export const INPUT_FLUSH = "\u0000flush";

/** Idle time after which a partial escape prefix is a key of its own. */
export const ESCAPE_FLUSH_MS = 50;
/** Idle time after which an unterminated bracketed paste is emitted. */
export const PASTE_FLUSH_MS = 1_000;

export class TerminalInputDecoder {
  private buffer = "";

  /**
   * What the decoder holds back: `escape` for a partial escape sequence,
   * `paste` for an unterminated bracketed paste. The caller flushes after
   * `ESCAPE_FLUSH_MS` or `PASTE_FLUSH_MS` with no further input.
   */
  pending(): "escape" | "paste" | undefined {
    if (this.buffer.length === 0) return undefined;
    return this.buffer.startsWith("\u001b[200~") ? "paste" : "escape";
  }

  push(chunk: string): TerminalInputEvent[] {
    this.buffer += chunk;
    const events: TerminalInputEvent[] = [];
    while (this.buffer.length > 0) {
      if (this.buffer.startsWith("\u001b[200~")) {
        const end = this.buffer.indexOf("\u001b[201~", 6);
        if (end < 0) {
          if (this.buffer.length - 6 < MAX_PASTE_CHARS) break;
          events.push({ type: "paste", text: this.buffer.slice(6) });
          this.buffer = "";
          break;
        }
        events.push({ type: "paste", text: this.buffer.slice(6, end) });
        this.buffer = this.buffer.slice(end + 6);
        continue;
      }

      if (this.buffer[0] === "\u001b") {
        const sequence = this.readEscapeSequence();
        if (sequence === undefined) break;
        events.push(sequence);
        this.buffer = this.buffer.slice(sequence.length);
        continue;
      }

      const codePoint = Array.from(this.buffer)[0];
      if (codePoint === undefined) break;
      events.push(codePoint);
      this.buffer = this.buffer.slice(codePoint.length);
    }
    return events;
  }

  /**
   * Emits whatever is held back, once no more input is coming: a cut-off
   * bracketed paste as a paste, a lone ESC as Esc, and a partial prefix such
   * as `ESC [` (Alt+[) or `ESC O` (Alt+O) as one Alt key, then decodes the
   * rest normally.
   */
  flush(): TerminalInputEvent[] {
    const events: TerminalInputEvent[] = [];
    while (this.buffer.length > 0) {
      if (this.buffer.startsWith("\u001b[200~")) {
        events.push({ type: "paste", text: this.buffer.slice(6) });
        this.buffer = "";
        break;
      }
      const head =
        this.buffer.length === 1 ? "\u001b" : this.buffer.slice(0, 2);
      const rest = this.buffer.slice(head.length);
      this.buffer = "";
      events.push(head, ...this.push(rest));
    }
    return events;
  }

  private readEscapeSequence(): string | undefined {
    if (this.buffer.length === 1) return undefined;
    if (this.buffer.startsWith("\u001b\r")) return "\u001b\r";
    // ESC followed by another control key (or ESC) is a lone Esc press that
    // shared a read with the next key, e.g. Esc then Ctrl+Z.
    const next = this.buffer.charCodeAt(1);
    if (next < 0x20 || next === 0x7f) return "\u001b";
    // A legacy X10 mouse report (a terminal without SGR 1006): CSI M and
    // three raw bytes. One event, so its bytes never type into the prompt.
    if (this.buffer.startsWith("\u001b[M"))
      return this.buffer.length >= 6 ? this.buffer.slice(0, 6) : undefined;
    const final = this.buffer.match(/^\u001b\[[\x20-?]*[\x40-~]/)?.[0];
    if (final !== undefined) return final;
    // A byte that cannot continue a CSI ends it: the `ESC [` was Alt+[.
    if (this.buffer.startsWith("\u001b[")) {
      const partial = this.buffer.match(/^\u001b\[[\x20-?]*/)![0];
      if (partial.length < this.buffer.length) return "\u001b[";
    }
    // SS3: arrows in application mode and F1-F4 (`ESC O P` is F1). A bare
    // `ESC O` waits for its final byte, which a PTY may deliver separately;
    // `flush` turns it into Alt+O if nothing follows.
    if (this.buffer.startsWith("\u001bO")) {
      if (this.buffer.length === 2) return undefined;
      const ss3 = this.buffer.match(/^\u001bO[A-DHFPQRS]/)?.[0];
      if (ss3 !== undefined) return ss3;
      return "\u001bO";
    }
    // An unrecognised Alt-prefixed character is still one complete event.
    if (this.buffer[1] !== "[") return this.buffer.slice(0, 2);
    return undefined;
  }
}
