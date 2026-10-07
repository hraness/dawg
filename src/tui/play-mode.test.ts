import { describe, expect, test } from "bun:test";
import {
  BLACK_KEYS,
  DEFAULT_BASE,
  MAX_BASE,
  MAX_VELOCITY,
  MIN_VELOCITY,
  NOTE_KEYS,
  PlayKeyboard,
  RELEASE_MS,
  WHITE_KEYS,
  defaultBaseFor,
  rangeLabel,
  stripCells,
} from "./play-mode.ts";

const GATE = 125;

describe("musical typing layout", () => {
  test("white keys A..' play C D E F G A B C D E F from the base", () => {
    const keyboard = new PlayKeyboard();
    const expected: [string, number][] = [
      ["a", 48],
      ["s", 50],
      ["d", 52],
      ["f", 53],
      ["g", 55],
      ["h", 57],
      ["j", 59],
      ["k", 60],
      ["l", 62],
      [";", 64],
      ["'", 65],
    ];
    expect(Object.keys(WHITE_KEYS).sort()).toEqual(
      expected.map(([key]) => key).sort(),
    );
    for (const [key, pitch] of expected)
      expect(keyboard.pitchFor(key)).toBe(pitch);
  });

  test("black keys W E T Y U O P play the sharps; R and I are silent", () => {
    const keyboard = new PlayKeyboard();
    const expected: [string, number][] = [
      ["w", 49],
      ["e", 51],
      ["t", 54],
      ["y", 56],
      ["u", 58],
      ["o", 61],
      ["p", 63],
    ];
    expect(Object.keys(BLACK_KEYS).sort()).toEqual(
      expected.map(([key]) => key).sort(),
    );
    for (const [key, pitch] of expected)
      expect(keyboard.pitchFor(key)).toBe(pitch);
    expect(keyboard.pitchFor("i")).toBeUndefined();
    expect(keyboard.press("i", 0, GATE)).toEqual({ type: "unmapped" });
    expect(keyboard.press("r", 0, GATE)).toEqual({
      type: "command",
      command: "record",
    });
  });

  test("every note key produces a note action with the current velocity", () => {
    const keyboard = new PlayKeyboard({ velocity: 90 });
    let now = 0;
    for (const key of Object.keys(NOTE_KEYS)) {
      now += 1_000;
      const action = keyboard.press(key, now, GATE);
      expect(action.type).toBe("note");
      if (action.type !== "note") continue;
      expect(action.note.pitch).toBe(DEFAULT_BASE + NOTE_KEYS[key]!);
      expect(action.note.velocity).toBe(90);
      expect(action.note.releaseAtMs).toBe(now + GATE);
    }
  });

  test("unmapped keys fall through", () => {
    const keyboard = new PlayKeyboard();
    for (const key of ["b", "n", "1", "q", "\u001b[A", "\r", "/", "?"])
      expect(keyboard.press(key, 0, GATE)).toEqual({ type: "unmapped" });
  });

  test("mode keys map to commands", () => {
    const keyboard = new PlayKeyboard();
    const command = (key: string) => keyboard.press(key, 0, GATE);
    expect(command("\u001b")).toEqual({ type: "command", command: "exit" });
    expect(command("R")).toEqual({ type: "command", command: "replace" });
    expect(command("m")).toEqual({ type: "command", command: "click" });
    expect(command(" ")).toEqual({ type: "command", command: "transport" });
    expect(command("\u000b")).toEqual({ type: "command", command: "menu" });
  });
});

describe("octave and velocity", () => {
  test("Z and X move an octave and clamp to the MIDI range", () => {
    const keyboard = new PlayKeyboard();
    expect(keyboard.press("x", 0, GATE)).toEqual({
      type: "octave",
      base: 60,
      clamped: false,
    });
    expect(keyboard.range).toBe("C4–F5");
    for (let index = 0; index < 20; index += 1) keyboard.press("x", 0, GATE);
    expect(keyboard.base).toBe(MAX_BASE);
    expect(keyboard.press("x", 0, GATE)).toMatchObject({ clamped: true });
    expect(MAX_BASE + 17).toBeLessThanOrEqual(127);
    for (let index = 0; index < 20; index += 1) keyboard.press("z", 0, GATE);
    expect(keyboard.base).toBe(0);
    expect(keyboard.press("Z", 0, GATE)).toEqual({
      type: "octave",
      base: 0,
      clamped: true,
    });
    expect(keyboard.pitchFor("a")).toBe(0);
  });

  test("C and V step velocity by 16 inside 1..127", () => {
    const keyboard = new PlayKeyboard();
    expect(keyboard.press("v", 0, GATE)).toEqual({
      type: "velocity",
      velocity: 116,
      clamped: false,
    });
    expect(keyboard.press("v", 0, GATE)).toMatchObject({ velocity: 127 });
    expect(keyboard.press("v", 0, GATE)).toMatchObject({
      velocity: MAX_VELOCITY,
      clamped: true,
    });
    for (let index = 0; index < 12; index += 1) keyboard.press("c", 0, GATE);
    expect(keyboard.velocity).toBe(MIN_VELOCITY);
  });

  test("the default octave follows the instrument", () => {
    expect(defaultBaseFor("sine")).toBe(48);
    expect(defaultBaseFor("bass")).toBe(36);
    expect(defaultBaseFor("saw")).toBe(60);
    expect(defaultBaseFor("kit")).toBe(36);
    expect(defaultBaseFor(undefined)).toBe(48);
    expect(rangeLabel(48)).toBe("C3–F4");
  });
});

describe("held keys and sustain", () => {
  test("auto-repeat extends one note instead of retriggering", () => {
    const keyboard = new PlayKeyboard();
    const first = keyboard.press("a", 0, GATE);
    expect(first.type).toBe("note");
    // The OS repeat delay: the first repeat looks like a fresh press.
    const second = keyboard.press("a", 400, GATE);
    expect(second.type).toBe("note");
    // The next fast repeat confirms the hold and absorbs the tentative note.
    const third = keyboard.press("a", 480, GATE);
    expect(third.type).toBe("extend");
    if (first.type !== "note" || second.type !== "note") return;
    expect(third).toEqual({
      type: "extend",
      id: first.note.id,
      key: "a",
      releaseAtMs: 480 + RELEASE_MS,
      absorbed: second.note.id,
    });
    const fourth = keyboard.press("a", 560, GATE);
    expect(fourth).toEqual({
      type: "extend",
      id: first.note.id,
      key: "a",
      releaseAtMs: 560 + RELEASE_MS,
    });
    expect(keyboard.litKeys(600)).toEqual(new Set(["a"]));
    expect(keyboard.litKeys(700)).toEqual(new Set());
  });

  test("deliberate re-presses retrigger", () => {
    const keyboard = new PlayKeyboard();
    expect(keyboard.press("a", 0, GATE).type).toBe("note");
    expect(keyboard.press("a", 900, GATE).type).toBe("note");
    expect(keyboard.press("s", 950, GATE).type).toBe("note");
    expect(keyboard.press("a", 1_000, GATE).type).toBe("note");
  });

  test("Shift (uppercase) sustains until a plain key lifts it", () => {
    const keyboard = new PlayKeyboard();
    const held = keyboard.press("A", 0, GATE);
    expect(held).toMatchObject({
      type: "note",
      note: { pitch: 48, sustain: true, releaseAtMs: Infinity },
    });
    expect(keyboard.sustain).toBe(true);
    const colon = keyboard.press(":", 10, GATE);
    expect(colon).toMatchObject({ note: { pitch: 64, sustain: true } });
    const plain = keyboard.press("d", 500, GATE);
    expect(plain.type).toBe("note");
    if (plain.type !== "note" || held.type !== "note") return;
    expect(plain.released).toContain(held.note.id);
    expect(keyboard.releaseOf(held.note.id)).toBe(500);
    expect(plain.note.sustain).toBe(false);
  });

  test("Tab latches sustain and releases on the second press", () => {
    const keyboard = new PlayKeyboard();
    expect(keyboard.press("\t", 0, GATE)).toEqual({
      type: "sustain",
      on: true,
      released: [],
      atMs: 0,
    });
    const note = keyboard.press("g", 10, GATE);
    expect(note).toMatchObject({ note: { sustain: true } });
    if (note.type !== "note") return;
    expect(keyboard.press("\t", 300, GATE)).toEqual({
      type: "sustain",
      on: false,
      released: [note.note.id],
      atMs: 300,
    });
  });

  test("the strip lists keys in physical order with pressed keys lit", () => {
    const keyboard = new PlayKeyboard();
    keyboard.press("e", 0, GATE);
    const cells = stripCells(keyboard, keyboard.litKeys(10));
    expect(cells.map((cell) => cell.key).join("")).toBe("awsedftgyhujkolp;'");
    expect(cells.find((cell) => cell.lit)).toMatchObject({
      key: "e",
      label: "D#3",
      black: true,
    });
  });
});
