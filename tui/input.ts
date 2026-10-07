/**
 * Incremental decoder for the small set of terminal sequences dawg accepts.
 * PTYs may split one CSI sequence across reads or combine several key events
 * into one read, so the main loop must consume framed events rather than raw
 * chunks.
 */
export type TerminalInputEvent =
  string | Readonly<{ type: "paste"; text: string }>;

export class TerminalInputDecoder {
  private buffer = "";

  push(chunk: string): TerminalInputEvent[] {
    this.buffer += chunk;
    const events: TerminalInputEvent[] = [];
    while (this.buffer.length > 0) {
      if (this.buffer.startsWith("\u001b[200~")) {
        const end = this.buffer.indexOf("\u001b[201~", 6);
        if (end < 0) break;
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

  flush(): TerminalInputEvent[] {
    if (this.buffer === "\u001b") {
      this.buffer = "";
      return ["\u001b"];
    }
    return [];
  }

  private readEscapeSequence(): string | undefined {
    if (this.buffer.length === 1) return undefined;
    if (this.buffer.startsWith("\u001b\r")) return "\u001b\r";
    // ESC followed by another control key (or ESC) is a lone Esc press that
    // shared a read with the next key, e.g. Esc then Ctrl+Z.
    const next = this.buffer.charCodeAt(1);
    if (next < 0x20 || next === 0x7f) return "\u001b";
    const final = this.buffer.match(/^\u001b\[[\x20-?]*[\x40-~]/)?.[0];
    if (final !== undefined) return final;
    // An unrecognised Alt-prefixed character is still one complete event.
    if (this.buffer.length >= 2 && this.buffer[1] !== "[")
      return this.buffer.slice(0, 2);
    return undefined;
  }
}
