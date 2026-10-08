import { describe, expect, test } from "bun:test";
import { TerminalInputDecoder } from "./input.ts";
import { isMouseSequence, MOUSE_OFF, MOUSE_ON, parseMouse } from "./keys.ts";

describe("parseMouse (SGR 1006)", () => {
  test("press, release and position are 0-based", () => {
    expect(parseMouse("\u001b[<0;10;5M")).toEqual({
      kind: "down",
      button: "left",
      x: 9,
      y: 4,
      delta: 0,
      shift: false,
      alt: false,
      ctrl: false,
    });
    expect(parseMouse("\u001b[<0;10;5m")?.kind).toBe("up");
    expect(parseMouse("\u001b[<2;1;1M")?.button).toBe("right");
    expect(parseMouse("\u001b[<1;1;1M")?.button).toBe("middle");
  });

  test("drag, move and modifiers", () => {
    const drag = parseMouse("\u001b[<32;40;12M");
    expect(drag?.kind).toBe("drag");
    expect(drag?.button).toBe("left");
    expect(parseMouse("\u001b[<35;3;3M")?.kind).toBe("move");
    const shifted = parseMouse("\u001b[<4;3;3M");
    expect(shifted?.shift).toBe(true);
    expect(parseMouse("\u001b[<16;3;3M")?.ctrl).toBe(true);
    expect(parseMouse("\u001b[<8;3;3M")?.alt).toBe(true);
  });

  test("wheel up and down; horizontal wheels are ignored", () => {
    expect(parseMouse("\u001b[<64;7;8M")).toMatchObject({
      kind: "wheel",
      delta: -1,
      x: 6,
      y: 7,
    });
    expect(parseMouse("\u001b[<65;7;8M")?.delta).toBe(1);
    expect(parseMouse("\u001b[<68;7;8M")).toMatchObject({
      kind: "wheel",
      shift: true,
    });
    expect(parseMouse("\u001b[<66;7;8M")).toBeUndefined();
  });

  test("columns past 223 (SGR has no limit)", () => {
    expect(parseMouse("\u001b[<0;300;100M")).toMatchObject({ x: 299, y: 99 });
  });

  test("anything else is not a mouse report", () => {
    expect(parseMouse("\u001b[A")).toBeUndefined();
    expect(parseMouse("\u001b[<0;0;5M")).toBeUndefined();
    expect(parseMouse("\u001b[<0;5M")).toBeUndefined();
    expect(parseMouse("a")).toBeUndefined();
  });

  test("isMouseSequence spots SGR and legacy X10 reports", () => {
    expect(isMouseSequence("\u001b[<0;1;1M")).toBe(true);
    expect(isMouseSequence("\u001b[M !!")).toBe(true);
    expect(isMouseSequence("\u001b[A")).toBe(false);
    expect(isMouseSequence("\u001b")).toBe(false);
  });

  test("mode strings enable 1000/1002/1006 and disable all three", () => {
    for (const mode of ["1000", "1002", "1006"]) {
      expect(MOUSE_ON).toContain(`\u001b[?${mode}h`);
      expect(MOUSE_OFF).toContain(`\u001b[?${mode}l`);
    }
  });
});

describe("TerminalInputDecoder with mouse reports", () => {
  test("an SGR report is one event, even split across reads", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push("\u001b[<0;1")).toEqual([]);
    expect(decoder.push("2;5Mx")).toEqual(["\u001b[<0;12;5M", "x"]);
    expect(decoder.push("\u001b[<64;1;1M\u001b[<0;3;4m")).toEqual([
      "\u001b[<64;1;1M",
      "\u001b[<0;3;4m",
    ]);
  });

  test("a legacy X10 report never types into the prompt", () => {
    const decoder = new TerminalInputDecoder();
    expect(decoder.push("\u001b[M !")).toEqual([]);
    expect(decoder.push("!a")).toEqual(["\u001b[M !!", "a"]);
  });
});
