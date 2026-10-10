import { expect, test } from "bun:test";
import { VirtualTerminal } from "./vt.ts";

const BEGIN = "\u001b[?2026h";
const END = "\u001b[?2026l";

test("a frame split across reads shows only once it is complete", () => {
  const vt = new VirtualTerminal(20, 3);
  vt.writeFrames(`${BEGIN}\u001b[1;1Hheader`);
  expect(vt.lines()[0]!.trim()).toBe("");
  vt.writeFrames(`\u001b[2;1Hbody${END}`);
  expect(
    vt
      .lines()
      .slice(0, 2)
      .map((line) => line.trim()),
  ).toEqual(["header", "body"]);
});

test("a begin marker cut mid-sequence waits for its rest", () => {
  const vt = new VirtualTerminal(20, 2);
  vt.writeFrames(`${BEGIN}\u001b[1;1Hone${END}\u001b[?20`);
  expect(vt.lines()[0]!.trim()).toBe("one");
  vt.writeFrames(`26h\u001b[1;1Htwo`);
  expect(vt.lines()[0]!.trim()).toBe("one");
  vt.writeFrames(END);
  expect(vt.lines()[0]!.trim()).toBe("two");
});

test("an OSC reaches onOsc, draws nothing, and may span reads", () => {
  const vt = new VirtualTerminal(20, 2);
  const seen: [number, string][] = [];
  vt.onOsc = (code, text) => seen.push([code, text]);
  vt.write('ab\u001b]7799;{"in":');
  vt.write("3}\u0007cd");
  expect(seen).toEqual([[7799, '{"in":3}']]);
  expect(vt.lines()[0]!.trim()).toBe("abcd");
});
