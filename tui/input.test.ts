import { describe, expect, test } from "bun:test";
import { TerminalInputDecoder } from "./input.ts";

describe("TerminalInputDecoder", () => {
  test("reassembles fragmented CSI and bracketed paste sequences", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push("\u001b[")).toEqual([]);
    expect(decoder.push("Ahello")).toEqual([
      "\u001b[A",
      "h",
      "e",
      "l",
      "l",
      "o",
    ]);
    expect(decoder.push("\u001b[200~multi\nline\u001b[2")).toEqual([]);
    expect(decoder.push("01~x")).toEqual([
      { type: "paste", text: "multi\nline" },
      "x",
    ]);
  });

  test("handles combined key events and flushes a lone escape", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push("ab\u001b[B\r")).toEqual(["a", "b", "\u001b[B", "\r"]);
    expect(decoder.push("\u001b")).toEqual([]);
    expect(decoder.flush()).toEqual(["\u001b"]);
  });
});
